// Adapted from Microsoft Windows-Camera VirtualCamera sample, MIT license in LICENSE-Microsoft.txt.
#pragma once
#ifndef NOMINMAX
#define NOMINMAX
#endif
#include <windows.h>
#include <unknwn.h>
#include <propvarutil.h>
#include <devpropdef.h>
#include <devpkey.h>
#include <cfgmgr32.h>
#include <ole2.h>
#include <Ks.h>
#include <ksproxy.h>
#include <ksmedia.h>
#include <mfapi.h>
#include <mfidl.h>
#include <mfobjects.h>
#include <mferror.h>
#include <mfreadwrite.h>
#include <mfvirtualcamera.h>
#include <nserror.h>
#include <strsafe.h>
#include <algorithm>
#include <array>
#include <atomic>
#include <chrono>
#include <condition_variable>
#include <deque>
#include <cstdint>
#include <climits>
#include <cstdlib>
#include <cwchar>
#include <mutex>
#include <string>
#include <thread>
#include <vector>
#define RESULT_DIAGNOSTICS_LEVEL 4
#include <wil/cppwinrt.h>
#include <wil/result.h>
#include <wil/com.h>
#include <wil/resource.h>
#include "FrameProtocol.h"
#include "MeetingLensProvider.h"
#include "FramePipeReader.h"
#include "MeetingLensFrameGenerator.h"
#include "MeetingLensMediaSource.h"
#include "MeetingLensMediaStream.h"
#include "MeetingLensActivate.h"

#pragma comment(lib, "mfuuid")
#pragma comment(lib, "mf")
#pragma comment(lib, "mfplat")
#pragma comment(lib, "Mfsensorgroup")
#pragma comment(lib, "windowsapp")
#pragma comment(lib, "advapi32")

inline void DebugPrint(LPCWSTR format, ...)
{
    wchar_t buffer[512] = {};
    va_list args; va_start(args, format);
    StringCchVPrintfW(buffer, ARRAYSIZE(buffer), format, args);
    va_end(args); OutputDebugStringW(buffer);
}
#define DEBUG_MSG(msg,...) DebugPrint(msg, __VA_ARGS__)
namespace wilEx
{
    template<typename T> wil::unique_cotaskmem_array_ptr<T> make_unique_cotaskmem_array(size_t count)
    {
        wil::unique_cotaskmem_array_ptr<T> result;
        const size_t bytes = sizeof(typename wil::details::element_traits<T>::type) * count;
        void* data = CoTaskMemAlloc(bytes);
        if (data) { ZeroMemory(data, bytes); result.reset(reinterpret_cast<typename wil::details::element_traits<T>::type*>(data), count); }
        return result;
    }
}
namespace winrt
{
    template<> bool is_guid_of<IMFMediaSourceEx>(guid const& id) noexcept;
    template<> bool is_guid_of<IMFMediaStream2>(guid const& id) noexcept;
    template<> bool is_guid_of<IMFActivate>(guid const& id) noexcept;
}
