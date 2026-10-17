// Adapted from Microsoft Windows-Camera VirtualCamera sample; see LICENSE-Microsoft.txt.
#include "pch.h"
BOOL APIENTRY DllMain(HMODULE, DWORD, LPVOID) { return TRUE; }
HRESULT __stdcall DllCanUnloadNow() noexcept
{
    if (winrt::get_module_lock()) return S_FALSE;
    winrt::clear_factory_cache();
    return S_OK;
}
HRESULT __stdcall DllGetClassObject(REFCLSID clsid, REFIID iid, void** result) noexcept try
{
    RETURN_HR_IF_NULL(E_POINTER, result);
    *result = nullptr;
    if (clsid != CLSID_MeetingLensProvider) return CLASS_E_CLASSNOTAVAILABLE;
    return winrt::make_self<MeetingLensActivateFactory>()->QueryInterface(iid, result);
} CATCH_RETURN()
