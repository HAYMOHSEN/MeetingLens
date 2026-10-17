#pragma once
class MeetingLensFrameGenerator final
{
public:
    static HRESULT ValidateMediaType(IMFMediaType* type) noexcept;
    HRESULT Initialize(IMFMediaType* type, const wchar_t* pipeName) noexcept;
    HRESULT Start() noexcept { return m_reader.Start(); }
    void Stop() noexcept { m_reader.Stop(); std::fill(m_rgb.begin(), m_rgb.end(), 0); }
    HRESULT CreateFrame(BYTE* firstRow, LONG pitch, BYTE* allocation, DWORD allocationLength) noexcept;
private:
    GUID m_subtype = GUID_NULL;
    MeetingLens::FramePipeReader m_reader;
    std::vector<uint8_t> m_rgb;
};
