//
// Copyright (C) Microsoft Corporation. All rights reserved.
//

#ifndef SIMPLEMEDIASTREAM_H
#define SIMPLEMEDIASTREAM_H

#include "MeetingLensMediaSource.h"
#include "MeetingLensProvider.h"

namespace winrt::MeetingLens::implementation
{
    struct MeetingLensMediaStream : winrt::implements<MeetingLensMediaStream, IMFMediaStream2>
    {
        friend struct MeetingLensMediaSource;

    public:
        ~MeetingLensMediaStream() { Shutdown(); }

        // IMFMediaEventGenerator
        IFACEMETHODIMP BeginGetEvent(IMFAsyncCallback* pCallback, IUnknown* punkState) override;
        IFACEMETHODIMP EndGetEvent(IMFAsyncResult* pResult, IMFMediaEvent** ppEvent) override;
        IFACEMETHODIMP GetEvent(DWORD dwFlags, IMFMediaEvent** ppEvent) override;
        IFACEMETHODIMP QueueEvent(MediaEventType met, REFGUID guidExtendedType, HRESULT hrStatus, const PROPVARIANT* pvValue) override;

        // IMFMediaStream
        IFACEMETHODIMP GetMediaSource(IMFMediaSource** ppMediaSource) override;
        IFACEMETHODIMP GetStreamDescriptor(IMFStreamDescriptor** ppStreamDescriptor) override;
        IFACEMETHODIMP RequestSample(IUnknown* pToken) override;

        // IMFMediaStream2
        IFACEMETHODIMP SetStreamState(_In_ MF_STREAM_STATE state) override;
        IFACEMETHODIMP GetStreamState(_Out_ MF_STREAM_STATE* pState) override;

        // Non-interface methods.
        HRESULT Initialize(_In_ MeetingLensMediaSource* pSource, _In_ DWORD streamId, _In_ MFSampleAllocatorUsage allocatorUsage, const wchar_t* pipeName);
        HRESULT Start(_In_ IMFMediaType* pMediaType);
        HRESULT Stop(_In_ bool fSendEvent);
        HRESULT Shutdown();
        HRESULT SetSampleAllocator(_In_ IMFVideoSampleAllocator* pAllocator);


        DWORD Id() const { return m_dwStreamId; }
        MFSampleAllocatorUsage SampleAlloactorUsage() const { return m_allocatorUsage; }


    private:
        _Requires_lock_held_(m_Lock) HRESULT _CheckShutdownRequiresLock();
        _Requires_lock_held_(m_Lock) HRESULT _SetStreamAttributes(IMFAttributes* pAttributeStore);
        _Requires_lock_held_(m_Lock) HRESULT _SetStreamDescriptorAttributes(IMFAttributes* pAttributeStore);

        _Requires_lock_held_(m_Lock) HRESULT StartInternal(bool bSendEvent, IMFMediaType* pNewMediaType);
        _Requires_lock_held_(m_Lock) HRESULT StopInternal(bool bSendEvent);

        HRESULT ProduceSample(IUnknown* token);
        void SampleLoop() noexcept;
        std::mutex m_requestLock;
        std::condition_variable m_requestReady;
        std::deque<std::pair<wil::com_ptr_nothrow<IUnknown>, uint64_t>> m_requests;
        std::atomic<uint64_t> m_requestEpoch{0};
        std::thread m_sampleThread;
        std::atomic<bool> m_sampleShutdown{false};
        std::atomic<bool> m_sampleRunning{false};
        winrt::slim_mutex  m_Lock;

        wil::com_ptr_nothrow<IMFMediaSource> m_parent;
        wil::com_ptr_nothrow<IMFMediaEventQueue> m_spEventQueue;
        wil::com_ptr_nothrow<IMFAttributes> m_spAttributes;
        wil::com_ptr_nothrow<IMFStreamDescriptor> m_spStreamDesc;
        wil::com_ptr_nothrow<IMFVideoSampleAllocator> m_spSampleAllocator;
        wistd::unique_ptr<MeetingLensFrameGenerator> m_spFrameGenerator;
        wil::com_ptr_nothrow<IMFMediaType> m_spMediaType;

        bool m_bIsShutdown = false;
        bool m_bSelected = false;
        MF_STREAM_STATE m_streamState = MF_STREAM_STATE_STOPPED;
        std::wstring m_pipeName;
        LONGLONG m_lastSampleTime = 0;

        DWORD m_dwStreamId = 0;
        MFSampleAllocatorUsage m_allocatorUsage;
    };
}

#endif
