// Real Windows MF source tests. Load the shipped DLL through its actual COM factory, without installing a device.
#ifndef NOMINMAX
#define NOMINMAX
#endif
#include <windows.h>
#include <mfapi.h>
#include <mfidl.h>
#include <mfobjects.h>
#include <mferror.h>
#include <ks.h>
#include <ksmedia.h>
#include <propvarutil.h>
#include <wil/result.h>
#include <wil/com.h>
#include <wil/resource.h>
#include "FrameProtocol.h"
#include "MeetingLensProvider.h"
#include <iostream>
#include <stdexcept>

static int checks = 0;
static void Check(bool value, const char* message)
{
    if (!value) throw std::runtime_error(message);
    ++checks;
}
static void Hr(HRESULT value, const char* message)
{
    if (FAILED(value)) { std::cerr << message << ": HRESULT 0x" << std::hex << uint32_t(value) << std::dec << '\n'; throw std::runtime_error(message); }
    ++checks;
}
static wil::com_ptr_nothrow<IMFMediaEvent> AwaitEvent(IMFMediaEventGenerator* queue, MediaEventType desired)
{
    const ULONGLONG deadline = GetTickCount64() + 5000;
    do
    {
        wil::com_ptr_nothrow<IMFMediaEvent> event;
        const HRESULT hr = queue->GetEvent(MF_EVENT_FLAG_NO_WAIT, &event);
        if (hr == MF_E_NO_EVENTS_AVAILABLE) { Sleep(2); continue; }
        Hr(hr, "retrieve asynchronous event");
        HRESULT status; Hr(event->GetStatus(&status), "read event status"); Hr(status, "successful event status");
        MediaEventType kind; Hr(event->GetType(&kind), "read event type");
        if (kind == desired) return event;
        Check(kind != MEError, "no asynchronous media error");
    } while (GetTickCount64() < deadline);
    throw std::runtime_error("timed out waiting for MF event");
}
static void TestFormat(IMFMediaSourceEx* source, IMFSampleAllocatorControl* control,
    IMFVideoSampleAllocator* allocator, REFGUID subtype, int frameCount)
{
    wil::com_ptr_nothrow<IMFPresentationDescriptor> presentation;
    wil::com_ptr_nothrow<IMFStreamDescriptor> descriptor;
    wil::com_ptr_nothrow<IMFMediaTypeHandler> handler;
    Hr(source->CreatePresentationDescriptor(&presentation), "create presentation");
    BOOL selected = FALSE; Hr(presentation->GetStreamDescriptorByIndex(0, &selected, &descriptor), "get descriptor");
    Hr(descriptor->GetMediaTypeHandler(&handler), "get type handler");
    DWORD count = 0; Hr(handler->GetMediaTypeCount(&count), "get format count"); Check(count == 2, "two negotiated formats");
    wil::com_ptr_nothrow<IMFMediaType> type;
    for (DWORD index = 0; index < count; ++index)
    {
        wil::com_ptr_nothrow<IMFMediaType> candidate; Hr(handler->GetMediaTypeByIndex(index, &candidate), "get supported format");
        GUID candidateSubtype; Hr(candidate->GetGUID(MF_MT_SUBTYPE, &candidateSubtype), "get supported subtype");
        if (candidateSubtype == subtype) type = candidate;
    }
    Check(bool(type), "requested subtype exists");
    Hr(handler->SetCurrentMediaType(type.get()), "select output format"); Hr(presentation->SelectStream(0), "select capture stream");
    Hr(control->SetDefaultAllocator(0, allocator), "provide sample allocator");
    PROPVARIANT start = {}; PropVariantInit(&start);
    Hr(source->Start(presentation.get(), nullptr, &start), "start actual source");
    auto sourceEvent = AwaitEvent(source, MENewStream);
    wil::unique_prop_variant value; Hr(sourceEvent->GetValue(&value), "read stream event payload");
    Check(value.vt == VT_UNKNOWN && value.punkVal != nullptr, "event includes media stream");
    wil::com_ptr_nothrow<IMFMediaStream> stream;
    Hr(value.punkVal->QueryInterface(IID_PPV_ARGS(&stream)), "get actual stream");
    wil::com_ptr_nothrow<IMFAttributes> token; Hr(MFCreateAttributes(&token, 1), "create sample token");
    wil::com_ptr_nothrow<IUnknown> identity; Hr(token->QueryInterface(IID_PPV_ARGS(&identity)), "canonical token identity");
    const ULONGLONG began = GetTickCount64();
    LONGLONG lastTime = 0;
    for (int frame = 0; frame < frameCount; ++frame)
    {
        Hr(stream->RequestSample(token.get()), "request real source sample");
        auto event = AwaitEvent(stream.get(), MEMediaSample);
        wil::unique_prop_variant sampleValue; Hr(event->GetValue(&sampleValue), "read sample payload");
        Check(sampleValue.vt == VT_UNKNOWN && sampleValue.punkVal, "media event includes sample");
        wil::com_ptr_nothrow<IMFSample> sample; Hr(sampleValue.punkVal->QueryInterface(IID_PPV_ARGS(&sample)), "get actual sample");
        LONGLONG timestamp = 0, duration = 0;
        Hr(sample->GetSampleTime(&timestamp), "get sample time"); Check(timestamp > lastTime, "sample times increase"); lastTime = timestamp;
        Hr(sample->GetSampleDuration(&duration), "get sample duration"); Check(duration == 333333, "30 fps sample duration");
        wil::com_ptr_nothrow<IUnknown> returnedToken;
        Hr(sample->GetUnknown(MFSampleExtension_Token, IID_PPV_ARGS(&returnedToken)), "sample retains request token");
        Check(returnedToken.get() == identity.get(), "same request token returned");
        DWORD length = 0; Hr(sample->GetTotalLength(&length), "get sample size");
        const bool nv12 = subtype == MFVideoFormat_NV12;
        Check(length == MeetingLens::Width * MeetingLens::Height * (nv12 ? 3 : 8) / 2, "negotiated sample byte length");
        wil::com_ptr_nothrow<IMFMediaBuffer> buffer; Hr(sample->ConvertToContiguousBuffer(&buffer), "read sample pixels");
        BYTE* pixels = nullptr; DWORD actual = 0;
        Hr(buffer->Lock(&pixels, nullptr, &actual), "lock sample pixels");
        const bool black = actual == length && pixels[0] == (nv12 ? 16 : 0) &&
            pixels[MeetingLens::Width * MeetingLens::Height] == (nv12 ? 128 : 0);
        Hr(buffer->Unlock(), "unlock sample pixels"); Check(black, "missing host produces safe black pixels");
    }
    const ULONGLONG elapsed = GetTickCount64() - began;
    if (frameCount >= 20) Check(elapsed >= 500, "samples are paced rather than emitted in a busy loop");
    const ULONGLONG stopBegan = GetTickCount64(); Hr(source->Stop(), "stop source");
    Check(GetTickCount64() - stopBegan < 2000, "stop cancels disconnected pipe reader promptly");
    Check(stream->RequestSample(nullptr) == MF_E_INVALIDREQUEST, "stopped stream rejects samples");
    AwaitEvent(source, MESourceStopped);
}
int wmain(int argc, wchar_t** argv) try
{
    Check(argc == 2, "pass provider DLL path");
    Hr(CoInitializeEx(nullptr, COINIT_MULTITHREADED), "initialize COM MTA");
    auto uninitialize = wil::scope_exit([] { CoUninitialize(); });
    Hr(MFStartup(MF_VERSION, MFSTARTUP_FULL), "initialize Media Foundation");
    auto mfShutdown = wil::scope_exit([] { MFShutdown(); });
    wil::unique_hmodule module(LoadLibraryExW(argv[1], nullptr, LOAD_LIBRARY_SEARCH_DLL_LOAD_DIR | LOAD_LIBRARY_SEARCH_DEFAULT_DIRS));
    Check(bool(module), "load built provider DLL");
    using GetFactory = HRESULT(__stdcall*)(REFCLSID, REFIID, void**);
    auto getFactory = reinterpret_cast<GetFactory>(GetProcAddress(module.get(), "DllGetClassObject"));
    Check(getFactory != nullptr, "exported COM factory exists");
    wil::com_ptr_nothrow<IClassFactory> factory;
    Hr(getFactory(CLSID_MeetingLensProvider, IID_PPV_ARGS(&factory)), "get MeetingLens class factory");
    wil::com_ptr_nothrow<IMFActivate> activation;
    Hr(factory->CreateInstance(nullptr, IID_PPV_ARGS(&activation)), "create actual IMFActivate");
    const std::wstring pipe = L"MeetingLens.Camera." + std::wstring(64, L'b');
    Hr(activation->SetString(MEETINGLENS_PIPE_NAME, pipe.c_str()), "set session pipe attribute");
    wil::com_ptr_nothrow<IMFMediaSourceEx> source;
    Hr(activation->ActivateObject(IID_PPV_ARGS(&source)), "activate actual media source");
    auto shutdownSource = wil::scope_exit([&] { if (source) source->Shutdown(); activation->ShutdownObject(); });
    wil::com_ptr_nothrow<IMFAttributes> attributes; Hr(source->GetSourceAttributes(&attributes), "source retains activation attributes");
    wil::unique_cotaskmem_string copiedPipe; UINT32 copiedLength = 0;
    Hr(attributes->GetAllocatedString(MEETINGLENS_PIPE_NAME, &copiedPipe, &copiedLength), "custom attribute propagated");
    Check(pipe == copiedPipe.get(), "session pipe preserved through activation");
    Hr(source->GetStreamAttributes(0, &attributes), "get stream attributes");
    GUID category; Hr(attributes->GetGUID(MF_DEVICESTREAM_STREAM_CATEGORY, &category), "get capture category");
    Check(category == PINNAME_VIDEO_CAPTURE, "video capture stream category");
    wil::com_ptr_nothrow<IMFSampleAllocatorControl> control; Hr(source->QueryInterface(IID_PPV_ARGS(&control)), "query allocator interface");
    Check(control->SetDefaultAllocator(0, nullptr) == E_POINTER, "null allocator rejected");
    wil::com_ptr_nothrow<IMFVideoSampleAllocator> allocator; Hr(MFCreateVideoSampleAllocatorEx(IID_PPV_ARGS(&allocator)), "create real video allocator");
    TestFormat(source.get(), control.get(), allocator.get(), MFVideoFormat_NV12, 20);
    TestFormat(source.get(), control.get(), allocator.get(), MFVideoFormat_RGB32, 20);
    TestFormat(source.get(), control.get(), allocator.get(), MFVideoFormat_NV12, 1);
    Hr(source->Shutdown(), "shutdown source");
    Check(source->GetSourceAttributes(&attributes) == MF_E_SHUTDOWN, "shutdown source rejects later calls");
    Check(source->Pause() == MF_E_SHUTDOWN, "shutdown source rejects pause");
    std::cout << "PASS " << checks << " Windows provider runtime checks\n";
    return 0;
}
catch (const std::exception& error) { std::cerr << "FAIL " << error.what() << '\n'; return 1; }
