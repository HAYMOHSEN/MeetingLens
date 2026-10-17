#pragma once
#include <guiddef.h>
// Never share the reference sample's CLSID: this is the MeetingLens transport provider.
inline constexpr GUID CLSID_MeetingLensProvider = { 0x2ebfd872, 0xc949, 0x48e9, { 0xa2, 0xc4, 0x87, 0xc5, 0xb0, 0xa5, 0xbc, 0x92 } };
inline constexpr GUID MEETINGLENS_PIPE_NAME = { 0x6bc993a9, 0xdb38, 0x4a03, { 0xb6, 0x44, 0x68, 0xb0, 0xb7, 0xbc, 0xe3, 0x92 } };
inline constexpr wchar_t MeetingLensProviderClsid[] = L"{2EBFD872-C949-48E9-A2C4-87C5B0A5BC92}";
