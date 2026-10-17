# MeetingLens Windows virtual-camera media source

This is a real Media Foundation source DLL, not a registration placeholder. It exposes one color capture stream at **1280×720, 30 fps**, negotiating **NV12** or **RGB32**. The native host owns camera capture and effects, creates a session camera with `MFCreateVirtualCamera`, sets `MEETINGLENS_PIPE_NAME` via inherited `IMFAttributes.SetString`, then starts it. The provider never opens a physical camera itself.

The DLL has its own CLSID `{2EBFD872-C949-48E9-A2C4-87C5B0A5BC92}` and does not replace or change the pinned Microsoft reference source. Its output filename is `MeetingLens.VirtualCamera.dll`. The installer owns machine COM registration at a stable Program Files path. The DLL exports `DllGetClassObject` and `DllCanUnloadNow`, with no self-registration exports.

## Frame contract

The attribute `{6BC993A9-DB38-4A03-B644-68B0B7BCE392}` contains only `MeetingLens.Camera.` followed by **64 hexadecimal characters**, generated per host run with a cryptographic RNG. Arbitrary pipe paths are rejected. The native host's local duplex named-pipe server admits its user, LocalService (the Windows camera frame server), and System, rejects network clients, and does not permit LocalService to create server instances.

The provider opens the pipe with explicit read/write data access and `SECURITY_SQOS_PRESENT | SECURITY_IDENTIFICATION`, preventing the user host from impersonating the frame-server identity. There is no TCP endpoint, global shared memory, background service or disk frame file.

For each frame the provider writes four ASCII bytes `NEXT`. The host returns a 40-byte header followed by exactly 3,686,400 bytes of top-down BGRA32, tightly packed at 5,120 bytes per row. All header integers are little endian:

| Offset | Type | Value |
| --- | --- | --- |
| 0 | UInt32 | `0x31464C4D`, bytes `MLF1` |
| 4 | UInt16 | Version `1` |
| 6 | UInt16 | Header length `40` |
| 8 | UInt32 | Width `1280` |
| 12 | UInt32 | Height `720` |
| 16 | UInt32 | Stride `5120` |
| 20 | UInt32 | Payload length `3686400` |
| 24 | UInt64 | Sequence; `0` requests black output |
| 32 | UInt64 | Capture time in Windows boot milliseconds, `Environment.TickCount64` / `GetTickCount64` |

The host must retain the original capture timestamp when re-serving a frame. The provider outputs black when a frame is 750 ms old or older, in the future, sequence zero, malformed, disconnected or unavailable. Disconnect clears the cached sequence immediately. A partial or unresponsive pipe operation has a one-second deadline and is canceled on stop/shutdown. Stop clears pending requests and cached pixels. An async worker serves at most 30 samples per second and bounds outstanding COM tokens at eight; no MF request thread performs pipe I/O or sleeps.

NV12 conversion averages chroma over each 2×2 block, uses limited range BT.601, and declares both the matrix and nominal range on the media type. RGB32 declares a positive top-down stride. Allocator buffers are unlocked on render failures. The source returns the original sample token and QPC-derived MF timestamps, and validates subtype, dimensions, frame rate, interlace and major type before allocation.

## Build and checks

Requires Windows 11, Visual Studio 2022 C++ desktop build tools, Windows SDK 10.0.26100.0 and NuGet. Restore `packages.config` into this directory's `packages`, then build `MeetingLens.VirtualCamera.vcxproj`, platform `x64`, configuration `Release`. The top-level native build/package scripts automate this and preserve pinned dependencies.

`ProtocolTests.cpp` is intentionally independent of Windows headers. Run with a C++17 compiler, for example:

```sh
c++ -std=c++17 -Wall -Wextra -Werror -pedantic ProtocolTests.cpp -o protocol-tests
./protocol-tests
```

The Windows test projects `ProtocolTests.vcxproj` and `ProviderRuntimeTests.vcxproj` emit `MeetingLens.ProtocolTests.exe` and `MeetingLens.ProviderRuntimeTests.exe`. Run the latter with the full path to the built DLL. It loads that DLL's real COM factory without installing a device, negotiates NV12 then RGB32 then NV12 with the same provided allocator, captures actual asynchronous samples, and verifies black output without a host, lengths, token identity, timestamps, duration, 30 fps pacing, pipe attribute propagation, stop/restart and shutdown behavior. It requires Media Foundation on Windows but no camera hardware. This complements a later real Windows camera-device / Teams / Zoom validation.

This verifies binary headers, 64-bit fields, malformed frame rejection, session names, freshness boundaries and actual color conversion including channel order, chroma averaging, padding and short buffers. It does **not** prove Windows compilation, COM activation, frame-server permissions, virtual-device enumeration, Teams or Zoom compatibility. Those require the Windows release validation workflow and an actual Windows session. Do not describe unrun Windows checks as passed.

## Attribution

The source/stream/activation implementation is adapted from Microsoft [Windows-Camera](https://github.com/microsoft/Windows-Camera/tree/626f8b19c5f367602f2e89c6b314573d3776c9df/Samples/VirtualCamera/VirtualCameraMediaSource), commit `626f8b19c5f367602f2e89c6b314573d3776c9df`. Original Microsoft copyright notices and the MIT license are retained in `LICENSE-Microsoft.txt`. MeetingLens adds the session transport, real processed frames, format checks, conversion, scheduling and lifecycle changes. The original pinned source remains under `../vendor/`.
