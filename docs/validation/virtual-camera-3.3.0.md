# MeetingLens 3.3.0 Windows camera integration: validation scope

Date: 17 October 2026. Status: source integration candidate; Windows and meeting-app acceptance pending.

## Performed in the authoring environment

| Check | Result | What it establishes |
|---|---|---|
| Actual Microsoft C# compiler, warnings as errors | Passed: 7 host source files against 212 official .NET, WPF, Windows SDK and WebView2 metadata references | Managed syntax and actual API signatures; not a Windows desktop publish |
| Default .NET 8 SDK analyzers | Passed | Compiler/analyzer rules on the same frozen host sources |
| Managed repository protocol/pixel/message tests | 23 passed | Fixed header, RGBA/BGRA conversion, expiration, privacy clear, strict JSON type and trusted origin/document handling |
| Independent managed contract checks | 40 passed | Additional malformed metadata, frame freshness and pixel checks |
| Portable C++ protocol/color checks | 36 passed with GCC C++17, Wall/Wextra/Werror/pedantic | Real provider header parsing, dimensions/stride, pipe-name contract, 750 ms boundary, BGRA/NV12 channel order, limited range, chroma averaging, padding and short-buffer rejection |
| Browser virtual-output checks | 26 passed | Shared-buffer request sequencing, exact copied pixels, privacy, permission denial, lost host, camera loss, self-camera feedback rejection, failed background fail-closed behavior |
| Camera regression | 11 passed | Existing startup, recoverable errors, frame freshness and privacy behavior |
| AI-startup/head-detail regression | 22 passed | Saved effects, partial availability, no unrelated retries, head-detail opt-in/reset behavior |
| Native capability report viewer | 9 passed | Snapshot validation, safe rendering and 64-bit flag preservation |
| Offline/shipping shell | 6 passed | Asset links, repository subpath, service-worker update/offline behavior and responsive layout |
| PowerShell source parser | Passed on official PowerShell 7.4.13/Linux | Syntax only; Windows PowerShell 5.1 is checked by the Windows workflow |

Browser tests used Chromium with synthetic camera input and a controlled WebView2 bridge. The hidden-page test drives native frame pulls under a simulated visibility state; it does not prove actual Windows minimize behavior. Desktop/mobile screenshots were inspected for overflow. No user camera photographs are included in this integration package.

Evidence: `virtual-camera-managed.json`, `virtual-camera-browser.json`, and `../../native-windows/validation/camera-package-source-check.json`. The managed report retains exact source fingerprints and tool versions. No frame, audio, session token or pipe secret is logged by the runtime.

## Independent review corrections

Review found and corrected C++ namespace lookup, pipe-name length and service ACL mismatches; malformed JSON scalar exceptions; worker COM initialization and shutdown races; sample pacing; stale request invalidation; media validation before allocator initialization; WebView permission-origin checks; host lifecycle/message exceptions; and missing bundled navigation pages. This review reduces known defects; it does not establish absence of defects.

## Prepared Windows tests that have NOT run here

The Windows workflow builds the actual C++ DLL and self-contained desktop host. Its runtime harness loads the real DLL factory, activates a media source, supplies an allocator, negotiates NV12/RGB32, and requests real asynchronous black fallback samples while checking bytes, timing, duration, tokens, stop/restart and shutdown. Additional CI checks cover full managed tests, checksum tampering, install/reinstall collision, COM registration and uninstall ownership. Camera registration/enumeration is recorded separately because hosted runners may lack camera services or interactive consent.

These Windows tests are included, not claimed as passed. Full MSBuild could not evaluate projects in this authoring environment because the restricted Linux host fails MSBuild process inspection. Direct Roslyn compilation and portable test execution remained available and produced the results above. A Windows compiler/runtime is required for the native provider binary and Frame Server tests.

## Release gates

Do not label this integration production ready until the Windows workflow succeeds and the exact resulting binaries pass physical Windows acceptance: Teams and Zoom camera selection and moving processed video; simultaneous consumers; camera/permission loss; Privacy Shield and background-load failure; minimization/covered window; sleep/resume; host crash; sustained memory/latency; uninstall/reinstall; and publisher signing. See `../../native-windows/CAMERA-INSTALL.md` and `../../RELEASE_CHECKLIST.md`.

A standalone PWABuilder PWA does not install this native provider. The Windows component supplies video only; choose the normal microphone in the meeting application. Output is fixed 720p with nominal 30 fps, while AI effect cadence can be lower. No zero-defect or universal service-compatibility claim is made.
