#pragma once
namespace MeetingLens
{
    class FramePipeReader final
    {
    public:
        FramePipeReader() = default;
        ~FramePipeReader() { Stop(); }
        FramePipeReader(const FramePipeReader&) = delete;
        FramePipeReader& operator=(const FramePipeReader&) = delete;
        HRESULT Configure(const wchar_t* pipeName) noexcept;
        HRESULT Start() noexcept;
        void Stop() noexcept;
        bool CopyLatest(uint8_t* destination, size_t length) noexcept;
    private:
        void ReadLoop() noexcept;
        bool Transfer(HANDLE pipe, void* bytes, DWORD length, bool write) noexcept;
        std::wstring m_pipePath;
        wil::unique_handle m_stopEvent;
        std::thread m_thread;
        std::mutex m_frameLock;
        std::vector<uint8_t> m_latest;
        uint64_t m_captureTick = 0;
        uint64_t m_sequence = 0;
    };
}
