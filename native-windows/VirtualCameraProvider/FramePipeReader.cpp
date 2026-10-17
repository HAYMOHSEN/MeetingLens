#include "pch.h"

HRESULT MeetingLens::FramePipeReader::Configure(const wchar_t* pipeName) noexcept try
{
    Stop();
    RETURN_HR_IF(E_INVALIDARG, !IsValidPipeName(pipeName));
    m_pipePath = L"\\\\.\\pipe\\" + std::wstring(pipeName);
    m_latest.assign(PayloadBytes, 0);
    m_stopEvent.reset(CreateEventW(nullptr, TRUE, FALSE, nullptr));
    RETURN_LAST_ERROR_IF_NULL(m_stopEvent.get());
    return S_OK;
} CATCH_RETURN()

HRESULT MeetingLens::FramePipeReader::Start() noexcept try
{
    RETURN_HR_IF(E_UNEXPECTED, !m_stopEvent || m_pipePath.empty());
    if (m_thread.joinable()) return S_OK;
    ResetEvent(m_stopEvent.get());
    m_thread = std::thread([this] { ReadLoop(); });
    return S_OK;
} CATCH_RETURN()

void MeetingLens::FramePipeReader::Stop() noexcept
{
    if (m_stopEvent) SetEvent(m_stopEvent.get());
    if (m_thread.joinable()) m_thread.join();
    std::lock_guard<std::mutex> lock(m_frameLock);
    std::fill(m_latest.begin(), m_latest.end(), 0);
    m_captureTick = m_sequence = 0;
}

bool MeetingLens::FramePipeReader::CopyLatest(uint8_t* destination, size_t length) noexcept
{
    if (!destination || length != PayloadBytes) return false;
    std::lock_guard<std::mutex> lock(m_frameLock);
    if (m_sequence == 0 || !IsFresh(m_captureTick, GetTickCount64()) || m_latest.size() != length)
    {
        std::memset(destination, 0, length);
        return false;
    }
    std::memcpy(destination, m_latest.data(), length);
    return true;
}

bool MeetingLens::FramePipeReader::Transfer(HANDLE pipe, void* bytes, DWORD length, bool write) noexcept
{
    wil::unique_handle completed(CreateEventW(nullptr, TRUE, FALSE, nullptr));
    if (!completed) return false;
    auto* cursor = static_cast<uint8_t*>(bytes);
    const uint64_t deadline = GetTickCount64() + 1000;
    while (length)
    {
        if (WaitForSingleObject(m_stopEvent.get(), 0) != WAIT_TIMEOUT) return false;
        ResetEvent(completed.get());
        OVERLAPPED operation = {}; operation.hEvent = completed.get();
        DWORD transferred = 0;
        const BOOL immediate = write ? WriteFile(pipe, cursor, length, &transferred, &operation) :
            ReadFile(pipe, cursor, length, &transferred, &operation);
        if (!immediate)
        {
            if (GetLastError() != ERROR_IO_PENDING) return false;
            HANDLE events[] = { m_stopEvent.get(), completed.get() };
            const uint64_t now = GetTickCount64();
            const DWORD wait = WaitForMultipleObjects(2, events, FALSE, now >= deadline ? 0 : DWORD(deadline - now));
            if (wait != WAIT_OBJECT_0 + 1)
            {
                // The OVERLAPPED storage must stay alive until cancellation is completed.
                CancelIoEx(pipe, &operation);
                GetOverlappedResult(pipe, &operation, &transferred, TRUE);
                return false;
            }
            if (!GetOverlappedResult(pipe, &operation, &transferred, FALSE)) return false;
        }
        if (transferred == 0 || transferred > length) return false;
        cursor += transferred; length -= transferred;
        if (length && GetTickCount64() >= deadline) return false;
    }
    return true;
}

void MeetingLens::FramePipeReader::ReadLoop() noexcept try
{
    std::vector<uint8_t> incoming(PayloadBytes);
    while (WaitForSingleObject(m_stopEvent.get(), 0) == WAIT_TIMEOUT)
    {
        // SecurityIdentification prevents the user-mode host impersonating the LocalService frame server.
        wil::unique_hfile pipe(CreateFileW(m_pipePath.c_str(), FILE_READ_DATA | FILE_WRITE_DATA | FILE_READ_ATTRIBUTES | SYNCHRONIZE | READ_CONTROL, 0, nullptr,
            OPEN_EXISTING, FILE_FLAG_OVERLAPPED | SECURITY_SQOS_PRESENT | SECURITY_IDENTIFICATION, nullptr));
        if (!pipe)
        {
            if (WaitForSingleObject(m_stopEvent.get(), 250) != WAIT_TIMEOUT) return;
            continue;
        }
        while (WaitForSingleObject(m_stopEvent.get(), 0) == WAIT_TIMEOUT)
        {
            uint8_t request[4]; std::memcpy(request, NextRequest, sizeof(request));
            std::array<uint8_t, HeaderBytes> rawHeader = {};
            FrameHeader header;
            if (!Transfer(pipe.get(), request, sizeof(request), true) ||
                !Transfer(pipe.get(), rawHeader.data(), DWORD(rawHeader.size()), false) ||
                !ParseHeader(rawHeader.data(), rawHeader.size(), header) ||
                !Transfer(pipe.get(), incoming.data(), DWORD(incoming.size()), false)) break;
            {
                std::lock_guard<std::mutex> lock(m_frameLock);
                if (header.sequence != 0 && IsFresh(header.captureTickMs, GetTickCount64()))
                {
                    m_latest.swap(incoming);
                    m_captureTick = header.captureTickMs;
                    m_sequence = header.sequence;
                }
                else { m_captureTick = m_sequence = 0; }
            }
            if (WaitForSingleObject(m_stopEvent.get(), 33) != WAIT_TIMEOUT) return;
        }
        // Drop stale/pending data on a broken or malformed connection immediately.
        { std::lock_guard<std::mutex> lock(m_frameLock); m_captureTick = m_sequence = 0; }
        if (WaitForSingleObject(m_stopEvent.get(), 100) != WAIT_TIMEOUT) return;
    }
}
catch (...)
{
    std::lock_guard<std::mutex> lock(m_frameLock);
    m_captureTick = m_sequence = 0;
}
