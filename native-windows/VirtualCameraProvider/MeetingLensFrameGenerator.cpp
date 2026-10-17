#include "pch.h"

HRESULT MeetingLensFrameGenerator::ValidateMediaType(IMFMediaType* type) noexcept
{
    RETURN_HR_IF_NULL(E_POINTER, type);
    GUID major, subtype;
    UINT32 width = 0, height = 0, rateNumerator = 0, rateDenominator = 0, interlace = 0;
    RETURN_IF_FAILED(type->GetGUID(MF_MT_MAJOR_TYPE, &major));
    RETURN_IF_FAILED(type->GetGUID(MF_MT_SUBTYPE, &subtype));
    RETURN_IF_FAILED(MFGetAttributeSize(type, MF_MT_FRAME_SIZE, &width, &height));
    RETURN_IF_FAILED(MFGetAttributeRatio(type, MF_MT_FRAME_RATE, &rateNumerator, &rateDenominator));
    RETURN_IF_FAILED(type->GetUINT32(MF_MT_INTERLACE_MODE, &interlace));
    RETURN_HR_IF(MF_E_INVALIDMEDIATYPE, major != MFMediaType_Video ||
        (subtype != MFVideoFormat_RGB32 && subtype != MFVideoFormat_NV12) || width != MeetingLens::Width ||
        height != MeetingLens::Height || rateNumerator != 30 || rateDenominator != 1 || interlace != MFVideoInterlace_Progressive);
    return S_OK;
}

HRESULT MeetingLensFrameGenerator::Initialize(IMFMediaType* type, const wchar_t* pipeName) noexcept try
{
    RETURN_IF_FAILED(ValidateMediaType(type));
    RETURN_IF_FAILED(type->GetGUID(MF_MT_SUBTYPE, &m_subtype));
    m_rgb.assign(MeetingLens::PayloadBytes, 0);
    return m_reader.Configure(pipeName);
} CATCH_RETURN()

HRESULT MeetingLensFrameGenerator::CreateFrame(BYTE* firstRow, LONG pitch, BYTE* allocation, DWORD length) noexcept
{
    RETURN_HR_IF_NULL(E_POINTER, firstRow);
    RETURN_HR_IF_NULL(E_POINTER, allocation);
    RETURN_HR_IF(E_INVALIDARG, pitch == 0 || pitch == LONG_MIN || m_rgb.size() != MeetingLens::PayloadBytes);
    // The row pointer returned by Lock2DSize can differ from the allocation start for negative strides.
    const uintptr_t begin = reinterpret_cast<uintptr_t>(allocation);
    const uintptr_t end = begin + length;
    const uintptr_t row = reinterpret_cast<uintptr_t>(firstRow);
    RETURN_HR_IF(E_INVALIDARG, end < begin || row < begin || row >= end);
    m_reader.CopyLatest(m_rgb.data(), m_rgb.size()); // Fail closed to black on stale or disconnected input.
    if (m_subtype == MFVideoFormat_RGB32)
    {
        const int64_t lastOffset = int64_t(pitch) * (MeetingLens::Height - 1);
        const int64_t firstOffset = int64_t(row - begin);
        RETURN_HR_IF(HRESULT_FROM_WIN32(ERROR_INSUFFICIENT_BUFFER), std::abs(int64_t(pitch)) < MeetingLens::Stride ||
            firstOffset + (std::min)(int64_t(0), lastOffset) < 0 ||
            uint64_t(firstOffset + (std::max)(int64_t(0), lastOffset)) + MeetingLens::Stride > length);
        for (uint32_t y = 0; y < MeetingLens::Height; ++y)
            std::memcpy(firstRow + int64_t(y)*pitch, m_rgb.data()+size_t(y)*MeetingLens::Stride, MeetingLens::Stride);
        return S_OK;
    }
    RETURN_HR_IF(MF_E_UNSUPPORTED_FORMAT, m_subtype != MFVideoFormat_NV12 || pitch < 0);
    return MeetingLens::BgraToNv12(m_rgb.data(), m_rgb.size(), firstRow, end-row,
        MeetingLens::Width, MeetingLens::Height, size_t(pitch)) ? S_OK : HRESULT_FROM_WIN32(ERROR_INSUFFICIENT_BUFFER);
}
