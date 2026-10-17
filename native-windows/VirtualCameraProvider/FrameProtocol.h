// MeetingLens frame transport v1. This header is platform independent and tested on Linux and Windows.
#pragma once
#include <algorithm>
#include <cstddef>
#include <cstdint>
#include <cstring>
#include <cwchar>
#include <string>

namespace MeetingLens
{
    constexpr uint32_t Width = 1280, Height = 720, Stride = Width * 4;
    constexpr uint32_t PayloadBytes = Stride * Height;
    constexpr uint32_t Magic = 0x31464c4d; // LE bytes "MLF1"
    constexpr uint16_t ProtocolVersion = 1, HeaderBytes = 40;
    constexpr uint64_t StaleAfterMs = 750;
    constexpr uint8_t NextRequest[4] = { 'N', 'E', 'X', 'T' };

    inline uint16_t Read16(const uint8_t* p) noexcept { return uint16_t(p[0]) | uint16_t(p[1]) << 8; }
    inline uint32_t Read32(const uint8_t* p) noexcept
    {
        return uint32_t(p[0]) | uint32_t(p[1]) << 8 | uint32_t(p[2]) << 16 | uint32_t(p[3]) << 24;
    }
    inline uint64_t Read64(const uint8_t* p) noexcept { return Read32(p) | uint64_t(Read32(p + 4)) << 32; }

    struct FrameHeader { uint64_t sequence = 0; uint64_t captureTickMs = 0; };
    inline bool ParseHeader(const uint8_t* bytes, size_t length, FrameHeader& result) noexcept
    {
        if (!bytes || length != HeaderBytes || Read32(bytes) != Magic || Read16(bytes + 4) != ProtocolVersion ||
            Read16(bytes + 6) != HeaderBytes || Read32(bytes + 8) != Width || Read32(bytes + 12) != Height ||
            Read32(bytes + 16) != Stride || Read32(bytes + 20) != PayloadBytes) return false;
        result.sequence = Read64(bytes + 24);
        result.captureTickMs = Read64(bytes + 32);
        return true;
    }
    inline bool IsFresh(uint64_t capture, uint64_t now) noexcept
    {
        // Both processes use the Windows boot monotonic clock. Future dates cannot extend frame life.
        return capture <= now && now - capture < StaleAfterMs;
    }
    inline bool IsValidPipeName(const wchar_t* value) noexcept
    {
        if (!value) return false;
        constexpr wchar_t prefix[] = L"MeetingLens.Camera.";
        constexpr size_t prefixChars = sizeof(prefix) / sizeof(wchar_t) - 1;
        if (std::wcslen(value) != prefixChars + 64 || std::wcsncmp(value, prefix, prefixChars) != 0) return false;
        for (size_t i = prefixChars; i < prefixChars + 64; ++i)
            if (!((value[i] >= L'0' && value[i] <= L'9') || (value[i] >= L'a' && value[i] <= L'f') ||
                (value[i] >= L'A' && value[i] <= L'F'))) return false;
        return true;
    }
    inline uint8_t Clamp(int value) noexcept { return uint8_t((std::max)(0, (std::min)(255, value))); }
    inline uint8_t Luma(const uint8_t* p) noexcept { return Clamp(((66*p[2] + 129*p[1] + 25*p[0] + 128) >> 8) + 16); }

    // RGB32 is top-down BGRA; NV12 uses limited range BT.601, with chroma averaged over all four pixels.
    inline bool BgraToNv12(const uint8_t* src, size_t srcBytes, uint8_t* dst, size_t dstBytes,
        uint32_t width, uint32_t height, size_t pitch) noexcept
    {
        if (!src || !dst || width == 0 || height == 0 || width > Width || height > Height || width % 2 || height % 2 || pitch < width || pitch > uint32_t(INT32_MAX) ||
            uint64_t(width) * height * 4 > srcBytes || uint64_t(pitch) * (height + height/2) > dstBytes) return false;
        for (uint32_t y = 0; y < height; y += 2)
        {
            for (uint32_t x = 0; x < width; x += 2)
            {
                const auto* a = src + (size_t(y) * width + x) * 4;
                const auto* b = a + width * 4;
                dst[size_t(y)*pitch+x] = Luma(a);
                dst[size_t(y)*pitch+x+1] = Luma(a+4);
                dst[size_t(y+1)*pitch+x] = Luma(b);
                dst[size_t(y+1)*pitch+x+1] = Luma(b+4);
                const int r = (int(a[2])+a[6]+b[2]+b[6]+2)/4;
                const int g = (int(a[1])+a[5]+b[1]+b[5]+2)/4;
                const int blue = (int(a[0])+a[4]+b[0]+b[4]+2)/4;
                auto* uv = dst + size_t(height+y/2)*pitch+x;
                uv[0] = Clamp(((-38*r-74*g+112*blue+128)>>8)+128);
                uv[1] = Clamp(((112*r-94*g-18*blue+128)>>8)+128);
            }
        }
        return true;
    }
}
