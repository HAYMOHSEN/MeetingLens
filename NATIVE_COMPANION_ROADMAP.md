# Native Companion Roadmap — Virtual Camera Output

The current MeetingLens PWA is intentionally scoped as an in-app camera preview and preparation tool. Browser PWAs cannot register a system-wide camera device that Teams, Zoom, Google Meet, or Webex can select.

To deliver a real **MeetingLens Camera** device on Windows, add a separate native Windows companion after the PWA launch.

## Native feature target

```text
Physical webcam → Local enhancement pipeline → MeetingLens virtual camera → Compatible meeting application
```

## Recommended technology path

- Windows 11, build 22000 or newer
- WinUI 3 or C++ desktop host for the settings experience
- Media Foundation virtual camera APIs (`MFCreateVirtualCamera` / `IMFVirtualCamera`)
- Direct3D / DirectML or ONNX Runtime for on-device enhancement and segmentation
- Windows capability declarations for camera access
- Performance fallback tiers: NPU/GPU enhanced, GPU standard, CPU-lite

## Required validation before advertising this feature

1. Validate the virtual camera in Teams, Zoom, Meet, and Webex on supported Windows versions.
2. Measure end-to-end latency and provide a safe fallback if performance drops.
3. Test difficult conditions: hair, glasses, hand movement, whiteboards, backlighting, and busy rooms.
4. Clearly disclose any AI-generated background or eye-contact feature.
5. Ensure the native feature does not double-process Windows Studio Effects.
6. Update the Privacy Policy and Store metadata only after the feature is tested and included in the submitted package.

## Future Store wording — only after implementation

> On supported Windows 11 PCs, MeetingLens Camera can be selected as a virtual camera in compatible meeting apps.

Do not use the above statement for the PWA-only release.
