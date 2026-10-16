# Microsoft camera reference source

`vendor/Samples/VirtualCamera/` and `vendor/Samples/Shared/` are copied without code changes from Microsoft's [Windows-Camera repository](https://github.com/microsoft/Windows-Camera), commit `626f8b19c5f367602f2e89c6b314573d3776c9df` (retrieved 16 October 2026).

The complete MIT license is retained in `vendor/MICROSOFT-LICENSE.txt`; individual source copyright notices remain intact. `vendor-source-sha256.json` records the copied file hashes. These files are a third-party developer reference and are not bundled into the installed PWA or executed by its service worker.

`MeetingLens.Windows/KsControl.cs` adapts the KS property identifiers, binary layouts and GET/SET pattern from `Samples/WindowsStudio/WindowsStudioSample_WinUI/KsHelper.cs` at the same commit, under that license. The original sample is at <https://github.com/microsoft/Windows-Camera/tree/626f8b19c5f367602f2e89c6b314573d3776c9df/Samples/WindowsStudio>.

MeetingLens's Windows UI, device-lifecycle handling, reports and DirectShow diagnostic utility are maintained separately. The upstream provider still uses Microsoft's sample names and sample CLSID. Product integration must assign MeetingLens identifiers, preserve licensing, build and test the provider, and supply an installer/uninstaller before release.
