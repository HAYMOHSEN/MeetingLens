// MeetingLens DirectShow diagnostic path. No registry edits or driver bypasses.
#include <windows.h>
#include <dshow.h>
#include <wrl/client.h>
#include <iostream>
#include <stdexcept>
#include <string>
#include <vector>
#include <memory>

using Microsoft::WRL::ComPtr;

namespace {
void Require(HRESULT result, const char* operation) {
    if (FAILED(result)) {
        std::cerr << operation << " failed: HRESULT 0x" << std::hex << static_cast<unsigned long>(result) << std::dec << "\n";
        throw std::runtime_error(operation);
    }
}
struct Apartment {
    Apartment() { Require(CoInitializeEx(nullptr, COINIT_APARTMENTTHREADED), "COM initialization"); }
    ~Apartment() { CoUninitialize(); }
};
struct MediaTypeDeleter {
    void operator()(AM_MEDIA_TYPE* type) const {
        if (!type) return;
        if (type->cbFormat != 0) CoTaskMemFree(type->pbFormat);
        if (type->pUnk) type->pUnk->Release();
        CoTaskMemFree(type);
    }
};
using MediaType = std::unique_ptr<AM_MEDIA_TYPE, MediaTypeDeleter>;

std::vector<ComPtr<IMoniker>> Cameras() {
    ComPtr<ICreateDevEnum> devices;
    Require(CoCreateInstance(CLSID_SystemDeviceEnum, nullptr, CLSCTX_INPROC_SERVER, IID_PPV_ARGS(&devices)), "Create device enumerator");
    ComPtr<IEnumMoniker> enumerator;
    const auto result = devices->CreateClassEnumerator(CLSID_VideoInputDeviceCategory, &enumerator, 0);
    Require(result, "Enumerate cameras");
    std::vector<ComPtr<IMoniker>> cameras;
    if (result == S_FALSE) return cameras;
    ComPtr<IMoniker> moniker;
    while (enumerator->Next(1, &moniker, nullptr) == S_OK) {
        ComPtr<IPropertyBag> bag;
        std::wstring name = L"Unnamed camera";
        if (SUCCEEDED(moniker->BindToStorage(nullptr, nullptr, IID_PPV_ARGS(&bag)))) {
            VARIANT value;
            VariantInit(&value);
            if (SUCCEEDED(bag->Read(L"FriendlyName", &value, nullptr)) && value.vt == VT_BSTR) name = value.bstrVal;
            VariantClear(&value);
        }
        std::wcout << cameras.size() << L": " << name << L"\n";
        cameras.push_back(moniker);
        moniker.Reset();
    }
    return cameras;
}

void PrintFormat(int index, const AM_MEDIA_TYPE* type) {
    LONG width = 0, height = 0;
    REFERENCE_TIME interval = 0;
    if (type->pbFormat && type->formattype == FORMAT_VideoInfo && type->cbFormat >= sizeof(VIDEOINFOHEADER)) {
        const auto header = reinterpret_cast<const VIDEOINFOHEADER*>(type->pbFormat);
        width = header->bmiHeader.biWidth;
        height = header->bmiHeader.biHeight;
        interval = header->AvgTimePerFrame;
    } else if (type->pbFormat && type->formattype == FORMAT_VideoInfo2 && type->cbFormat >= sizeof(VIDEOINFOHEADER2)) {
        const auto header = reinterpret_cast<const VIDEOINFOHEADER2*>(type->pbFormat);
        width = header->bmiHeader.biWidth;
        height = header->bmiHeader.biHeight;
        interval = header->AvgTimePerFrame;
    }
    wchar_t subtype[40]{};
    StringFromGUID2(type->subtype, subtype, 40);
    std::wcout << L"Mode " << index << L": " << width << L" x " << height << L", "
               << (interval > 0 ? 10000000.0 / static_cast<double>(interval) : 0.0) << L" fps, " << subtype << L"\n";
}
}

int wmain(int argc, wchar_t** argv) {
    try {
        int deviceIndex = 0;
        int modeIndex = -1;
        bool preview = false;
        bool list = false;
        bool interactive = false;
        for (int i = 1; i < argc; ++i) {
            const std::wstring argument = argv[i];
            if (argument == L"--camera" && i + 1 < argc) {
                deviceIndex = std::stoi(argv[++i]);
                if (deviceIndex < 0) throw std::runtime_error("Camera index must be nonnegative.");
            }
            else if (argument == L"--mode" && i + 1 < argc) {
                modeIndex = std::stoi(argv[++i]);
                if (modeIndex < 0) throw std::runtime_error("Video mode index must be nonnegative.");
            }
            else if (argument == L"--preview") preview = true;
            else if (argument == L"--list") list = true;
            else if (argument == L"--interactive") interactive = true;
            else throw std::runtime_error("Usage: MeetingLens.BasicCamera [--interactive] [--list] [--camera N] [--mode N] [--preview]");
        }
        Apartment apartment;
        const auto cameras = Cameras();
        if (cameras.empty()) { std::wcout << L"No DirectShow video-input device found.\n"; return 0; }
        if (list || argc == 1) return 0;
        if (interactive) {
            std::wcout << L"Select camera index: ";
            if (!(std::wcin >> deviceIndex)) throw std::runtime_error("Invalid camera index.");
            preview = true;
        }
        if (deviceIndex < 0 || static_cast<size_t>(deviceIndex) >= cameras.size()) throw std::runtime_error("Camera index out of range.");
        ComPtr<IBaseFilter> camera;
        Require(cameras[static_cast<size_t>(deviceIndex)]->BindToObject(nullptr, nullptr, IID_PPV_ARGS(&camera)), "Open camera");
        ComPtr<IGraphBuilder> graph;
        Require(CoCreateInstance(CLSID_FilterGraph, nullptr, CLSCTX_INPROC_SERVER, IID_PPV_ARGS(&graph)), "Create filter graph");
        ComPtr<ICaptureGraphBuilder2> builder;
        Require(CoCreateInstance(CLSID_CaptureGraphBuilder2, nullptr, CLSCTX_INPROC_SERVER, IID_PPV_ARGS(&builder)), "Create capture builder");
        Require(builder->SetFiltergraph(graph.Get()), "Attach graph");
        Require(graph->AddFilter(camera.Get(), L"Selected camera"), "Add camera");
        ComPtr<IAMStreamConfig> configuration;
        const auto found = builder->FindInterface(&PIN_CATEGORY_CAPTURE, &MEDIATYPE_Video, camera.Get(), IID_IAMStreamConfig,
            reinterpret_cast<void**>(configuration.GetAddressOf()));
        if (SUCCEEDED(found)) {
            int count = 0, size = 0;
            Require(configuration->GetNumberOfCapabilities(&count, &size), "Read video-mode count");
            if (size <= 0 || size > 1024 * 1024 || count < 0 || count > 10000) throw std::runtime_error("Invalid driver capability size/count.");
            std::vector<BYTE> capabilityBytes(static_cast<size_t>(size));
            bool modeApplied = modeIndex < 0;
            for (int i = 0; i < count; ++i) {
                AM_MEDIA_TYPE* raw = nullptr;
                const auto read = configuration->GetStreamCaps(i, &raw, capabilityBytes.data());
                MediaType type(raw);
                if (FAILED(read) || !type) continue;
                PrintFormat(i, type.get());
                if (i == modeIndex) {
                    Require(configuration->SetFormat(type.get()), "Apply advertised camera mode");
                    modeApplied = true;
                }
            }
            if (modeIndex >= count) throw std::runtime_error("Video mode index out of range.");
            if (!modeApplied) throw std::runtime_error("The selected video mode could not be read; preview was not started.");
        } else if (modeIndex >= 0) throw std::runtime_error("This camera does not expose DirectShow mode control.");
        if (!preview) return 0;
        std::wcout << L"Basic DirectShow preview. Hardware, driver and system effects may still be present.\n"
                      L"This path does not guarantee raw pixels or bypass Windows Studio Effects.\n"
                      L"Close the preview window to stop.\n";
        Require(builder->RenderStream(&PIN_CATEGORY_PREVIEW, &MEDIATYPE_Video, camera.Get(), nullptr, nullptr), "Render preview");
        ComPtr<IMediaControl> control;
        Require(graph.As(&control), "Get media control");
        ComPtr<IVideoWindow> window;
        Require(graph.As(&window), "Get video window");
        const BSTR caption = SysAllocString(L"MeetingLens · Basic DirectShow preview");
        if (!caption) throw std::bad_alloc();
        const auto captionResult = window->put_Caption(caption);
        SysFreeString(caption);
        Require(captionResult, "Set preview caption");
        Require(window->put_Visible(OATRUE), "Show preview");
        Require(control->Run(), "Start preview");
        ComPtr<IMediaEvent> events;
        Require(graph.As(&events), "Get media events");
        // Poll the renderer visibility while pumping STA messages; no hidden capture remains.
        bool running = true;
        while (running) {
            MsgWaitForMultipleObjects(0, nullptr, FALSE, 100, QS_ALLINPUT);
            MSG message{};
            while (PeekMessageW(&message, nullptr, 0, 0, PM_REMOVE)) {
                if (message.message == WM_QUIT) { running = false; break; }
                TranslateMessage(&message);
                DispatchMessageW(&message);
            }
            long code = 0;
            LONG_PTR first = 0, second = 0;
            while (events->GetEvent(&code, &first, &second, 0) == S_OK) {
                events->FreeEventParams(code, first, second);
                if (code == EC_USERABORT || code == EC_ERRORABORT || code == EC_DEVICE_LOST) running = false;
            }
            long visible = OAFALSE;
            if (FAILED(window->get_Visible(&visible)) || visible == OAFALSE) running = false;
        }
        Require(control->Stop(), "Stop preview");
        return 0;
    } catch (const std::exception& error) {
        std::cerr << error.what() << "\n";
        return 1;
    }
}
