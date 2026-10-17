//
// Copyright (C) Microsoft Corporation. All rights reserved.
//
#include "pch.h"

namespace winrt::MeetingLens::implementation
{
    // IMFActivate
    IFACEMETHODIMP MeetingLensActivate::ActivateObject(REFIID riid, void** ppv)
    try
    {
        RETURN_HR_IF_NULL(E_POINTER, ppv);
        *ppv = nullptr;

        winrt::slim_lock_guard lock(m_lock);
        if (!m_spMeetingLensMediaSrc)
        {
            auto source = winrt::make_self<winrt::MeetingLens::implementation::MeetingLensMediaSource>();
            RETURN_IF_FAILED(source->Initialize(this));
            m_spMeetingLensMediaSrc = std::move(source);
        }
        return m_spMeetingLensMediaSrc->QueryInterface(riid, ppv);
    } CATCH_RETURN()

    IFACEMETHODIMP MeetingLensActivate::ShutdownObject()
    {
        winrt::slim_lock_guard lock(m_lock);
        if (m_spMeetingLensMediaSrc) m_spMeetingLensMediaSrc->Shutdown();
        m_spMeetingLensMediaSrc = nullptr;
        return S_OK;
    }

    IFACEMETHODIMP MeetingLensActivate::DetachObject()
    {
        winrt::slim_lock_guard lock(m_lock);
        m_spMeetingLensMediaSrc = nullptr;
        return S_OK;
    }

    // IMFAttributes (inherits by IMFActivate)
    IFACEMETHODIMP MeetingLensActivate::GetItem(_In_ REFGUID guidKey, _Inout_opt_  PROPVARIANT* pValue)
    {
        if (!m_spActivateAttributes)
            RETURN_IF_FAILED(MFCreateAttributes(&m_spActivateAttributes, 1));
        return m_spActivateAttributes->GetItem(guidKey, pValue);
    }

    IFACEMETHODIMP MeetingLensActivate::GetItemType(_In_ REFGUID guidKey, _Out_ MF_ATTRIBUTE_TYPE* pType)
    {
        if (!m_spActivateAttributes)
            RETURN_IF_FAILED(MFCreateAttributes(&m_spActivateAttributes, 1));
        return m_spActivateAttributes->GetItemType(guidKey, pType);
    }

    IFACEMETHODIMP MeetingLensActivate::CompareItem(_In_ REFGUID guidKey, _In_ REFPROPVARIANT Value, _Out_ BOOL* pbResult)
    {
        if (!m_spActivateAttributes)
            RETURN_IF_FAILED(MFCreateAttributes(&m_spActivateAttributes, 1));
        return m_spActivateAttributes->CompareItem(guidKey, Value, pbResult);
    }

    IFACEMETHODIMP MeetingLensActivate::Compare(_In_ IMFAttributes* pTheirs, _In_ MF_ATTRIBUTES_MATCH_TYPE MatchType, _Out_ BOOL* pbResult)
    {
        if (!m_spActivateAttributes)
            RETURN_IF_FAILED(MFCreateAttributes(&m_spActivateAttributes, 1));
        return m_spActivateAttributes->Compare(pTheirs, MatchType, pbResult);
    }

    IFACEMETHODIMP MeetingLensActivate::GetUINT32(_In_ REFGUID guidKey, _Out_ UINT32* punValue)
    {
        if (!m_spActivateAttributes)
            RETURN_IF_FAILED(MFCreateAttributes(&m_spActivateAttributes, 1));
        return m_spActivateAttributes->GetUINT32(guidKey, punValue);
    }

    IFACEMETHODIMP MeetingLensActivate::GetUINT64(_In_ REFGUID guidKey, _Out_ UINT64* punValue)
    {
        if (!m_spActivateAttributes)
            RETURN_IF_FAILED(MFCreateAttributes(&m_spActivateAttributes, 1));
        return m_spActivateAttributes->GetUINT64(guidKey, punValue);
    }

    IFACEMETHODIMP MeetingLensActivate::GetDouble(_In_ REFGUID guidKey, _Out_ double* pfValue)
    {
        if (!m_spActivateAttributes)
            RETURN_IF_FAILED(MFCreateAttributes(&m_spActivateAttributes, 1));
        return m_spActivateAttributes->GetDouble(guidKey, pfValue);
    }
    IFACEMETHODIMP MeetingLensActivate::GetGUID(_In_ REFGUID guidKey, _Out_ GUID* pguidValue)
    {
        if (!m_spActivateAttributes)
            RETURN_IF_FAILED(MFCreateAttributes(&m_spActivateAttributes, 1));
        return m_spActivateAttributes->GetGUID(guidKey, pguidValue);
    }

    IFACEMETHODIMP MeetingLensActivate::GetStringLength(_In_ REFGUID guidKey, _Out_ UINT32* pcchLength)
    {
        if (!m_spActivateAttributes)
            RETURN_IF_FAILED(MFCreateAttributes(&m_spActivateAttributes, 1));
        return m_spActivateAttributes->GetStringLength(guidKey, pcchLength);
    }

    IFACEMETHODIMP MeetingLensActivate::GetString(_In_ REFGUID guidKey, _Out_writes_(cchBufSize) LPWSTR pwszValue, _In_ UINT32 cchBufSize, _Inout_opt_ UINT32* pcchLength)
    {
        if (!m_spActivateAttributes)
            RETURN_IF_FAILED(MFCreateAttributes(&m_spActivateAttributes, 1));
        return m_spActivateAttributes->GetString(guidKey, pwszValue, cchBufSize, pcchLength);
    }

    IFACEMETHODIMP MeetingLensActivate::GetAllocatedString(_In_ REFGUID guidKey, _Out_writes_(*pcchLength + 1) LPWSTR* ppwszValue, _Inout_  UINT32* pcchLength)
    {
        if (!m_spActivateAttributes)
            RETURN_IF_FAILED(MFCreateAttributes(&m_spActivateAttributes, 1));
        return m_spActivateAttributes->GetAllocatedString(guidKey, ppwszValue, pcchLength);
    }

    IFACEMETHODIMP MeetingLensActivate::GetBlobSize(_In_ REFGUID guidKey, _Out_ UINT32* pcbBlobSize)
    {
        if (!m_spActivateAttributes)
            RETURN_IF_FAILED(MFCreateAttributes(&m_spActivateAttributes, 1));
        return m_spActivateAttributes->GetBlobSize(guidKey, pcbBlobSize);
    }

    IFACEMETHODIMP MeetingLensActivate::GetBlob(_In_ REFGUID  guidKey, _Out_writes_(cbBufSize) UINT8* pBuf, UINT32 cbBufSize, _Inout_  UINT32* pcbBlobSize)
    {
        if (!m_spActivateAttributes)
            RETURN_IF_FAILED(MFCreateAttributes(&m_spActivateAttributes, 1));
        return m_spActivateAttributes->GetBlob(guidKey, pBuf, cbBufSize, pcbBlobSize);
    }

    IFACEMETHODIMP MeetingLensActivate::GetAllocatedBlob(__RPC__in REFGUID guidKey, __RPC__deref_out_ecount_full_opt(*pcbSize) UINT8** ppBuf, __RPC__out UINT32* pcbSize)
    {
        if (!m_spActivateAttributes)
            RETURN_IF_FAILED(MFCreateAttributes(&m_spActivateAttributes, 1));
        return m_spActivateAttributes->GetAllocatedBlob(guidKey, ppBuf, pcbSize);
    }

    IFACEMETHODIMP MeetingLensActivate::GetUnknown(__RPC__in REFGUID guidKey, __RPC__in REFIID riid, __RPC__deref_out_opt LPVOID* ppv)
    {
        if (!m_spActivateAttributes)
            RETURN_IF_FAILED(MFCreateAttributes(&m_spActivateAttributes, 1));
        return m_spActivateAttributes->GetUnknown(guidKey, riid, ppv);
    }

    IFACEMETHODIMP MeetingLensActivate::SetItem(_In_ REFGUID guidKey, _In_ REFPROPVARIANT Value)
    {
        if (!m_spActivateAttributes)
            RETURN_IF_FAILED(MFCreateAttributes(&m_spActivateAttributes, 1));
        return m_spActivateAttributes->SetItem(guidKey, Value);
    }

    IFACEMETHODIMP MeetingLensActivate::DeleteItem(_In_ REFGUID guidKey)
    {
        if (!m_spActivateAttributes)
            RETURN_IF_FAILED(MFCreateAttributes(&m_spActivateAttributes, 1));
        return m_spActivateAttributes->DeleteItem(guidKey);
    }

    IFACEMETHODIMP MeetingLensActivate::DeleteAllItems()
    {
        if (!m_spActivateAttributes)
            RETURN_IF_FAILED(MFCreateAttributes(&m_spActivateAttributes, 1));
        return m_spActivateAttributes->DeleteAllItems();
    }

    IFACEMETHODIMP MeetingLensActivate::SetUINT32(_In_ REFGUID guidKey, _In_ UINT32  unValue)
    {
        if (!m_spActivateAttributes)
            RETURN_IF_FAILED(MFCreateAttributes(&m_spActivateAttributes, 1));
        return m_spActivateAttributes->SetUINT32(guidKey, unValue);
    }

    IFACEMETHODIMP MeetingLensActivate::SetUINT64(_In_ REFGUID guidKey, _In_ UINT64  unValue)
    {
        if (!m_spActivateAttributes)
            RETURN_IF_FAILED(MFCreateAttributes(&m_spActivateAttributes, 1));
        return m_spActivateAttributes->SetUINT64(guidKey, unValue);
    }

    IFACEMETHODIMP MeetingLensActivate::SetDouble(_In_ REFGUID guidKey, _In_ double  fValue)
    {
        if (!m_spActivateAttributes)
            RETURN_IF_FAILED(MFCreateAttributes(&m_spActivateAttributes, 1));
        return m_spActivateAttributes->SetDouble(guidKey, fValue);
    }

    IFACEMETHODIMP MeetingLensActivate::SetGUID(_In_ REFGUID guidKey, _In_ REFGUID guidValue)
    {
        if (!m_spActivateAttributes)
            RETURN_IF_FAILED(MFCreateAttributes(&m_spActivateAttributes, 1));
        return m_spActivateAttributes->SetGUID(guidKey, guidValue);
    }

    IFACEMETHODIMP MeetingLensActivate::SetString(_In_ REFGUID guidKey, _In_ LPCWSTR wszValue)
    {
        if (!m_spActivateAttributes)
            RETURN_IF_FAILED(MFCreateAttributes(&m_spActivateAttributes, 1));
        return m_spActivateAttributes->SetString(guidKey, wszValue);
    }

    IFACEMETHODIMP MeetingLensActivate::SetBlob(_In_ REFGUID guidKey, _In_reads_(cbBufSize) const UINT8* pBuf, UINT32 cbBufSize)
    {
        if (!m_spActivateAttributes)
            RETURN_IF_FAILED(MFCreateAttributes(&m_spActivateAttributes, 1));
        return m_spActivateAttributes->SetBlob(guidKey, pBuf, cbBufSize);
    }

    IFACEMETHODIMP MeetingLensActivate::SetUnknown(_In_ REFGUID guidKey, _In_ IUnknown* pUnknown)
    {
        if (!m_spActivateAttributes)
            RETURN_IF_FAILED(MFCreateAttributes(&m_spActivateAttributes, 1));
        return m_spActivateAttributes->SetUnknown(guidKey, pUnknown);
    }

    IFACEMETHODIMP MeetingLensActivate::LockStore()
    {
        if (!m_spActivateAttributes)
            RETURN_IF_FAILED(MFCreateAttributes(&m_spActivateAttributes, 1));
        return m_spActivateAttributes->LockStore();
    }

    IFACEMETHODIMP MeetingLensActivate::UnlockStore()
    {
        if (!m_spActivateAttributes)
            RETURN_IF_FAILED(MFCreateAttributes(&m_spActivateAttributes, 1));
        return m_spActivateAttributes->UnlockStore();
    }

    IFACEMETHODIMP MeetingLensActivate::GetCount(_Out_ UINT32* pcItems)
    {
        if (!m_spActivateAttributes)
            RETURN_IF_FAILED(MFCreateAttributes(&m_spActivateAttributes, 1));
        return m_spActivateAttributes->GetCount(pcItems);
    }

    IFACEMETHODIMP MeetingLensActivate::GetItemByIndex(UINT32 unIndex, _Out_ GUID* pguidKey, _Inout_ PROPVARIANT* pValue)
    {
        if (!m_spActivateAttributes)
            RETURN_IF_FAILED(MFCreateAttributes(&m_spActivateAttributes, 1));
        return m_spActivateAttributes->GetItemByIndex(unIndex, pguidKey, pValue);
    }

    IFACEMETHODIMP MeetingLensActivate::CopyAllItems(_In_ IMFAttributes* pDest)
    {
        if (!m_spActivateAttributes)
            RETURN_IF_FAILED(MFCreateAttributes(&m_spActivateAttributes, 1));
        return m_spActivateAttributes->CopyAllItems(pDest);
    }

    // non interface method
    HRESULT MeetingLensActivate::Initialize()
    {
        RETURN_IF_FAILED(MFCreateAttributes(&m_spActivateAttributes, 3));
        // No physical camera is wrapped by this provider. Frames arrive through the session pipe.
        return S_OK;
    }
}
