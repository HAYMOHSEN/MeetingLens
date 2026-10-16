# Changelog

## 3.0.0 — 2026-10-16

- Added bundled local face-landmark/person-segmentation models in a CPU/WebAssembly worker, with failure fallback to regular preview/manual controls.
- Added face-based Auto Framing, live Background Blur, Portrait Light, and modest landmark-masked skin/teeth adjustments.
- Added fine digital zoom, reported camera capability/resolution/FPS controls, and Basic preview that bypasses app effects.
- Added Photo Lab for automatic local tone enhancement, Lab reference-color matching, batch JPEG ZIP export, small-object neighborhood inpainting, and manual/assisted face refinement.
- Added perspective whiteboard correction with bright-board corner suggestions, four editable corners, homography rectification, and ink cleanup.
- Added opt-in browser microphone processing, a level meter, and a local test recording limited to 60 seconds.
- Added local QR decoding with jsQR fallback, explicit copying, and optional automatic copying of new QR links.
- Added opt-in snapshot folder/browser backups, latest-50 browser retention, and backup failure feedback.
- Extended Privacy Shield and hidden-app cleanup to microphone sessions and temporary test recordings.
- Added a read-only local Windows capability-report viewer, explicit Settings links, and duplicate-blur guidance.
- Added separate native Windows source for supported KS effect controls, camera preview/modes/zoom, a DirectShow diagnostic, and a pinned Microsoft virtual-camera reference with build instructions.
- Updated policy pages, bilingual Store copy, feature status, release guidance, and ten screenshots.

The PWA still processes its own preview/audio and does not route them into meeting apps. Browser models do not select an NPU or synthesize eye contact. Windows effects depend on hardware; the virtual-camera reference is not connected to the PWA canvas. See FEATURE_MATRIX.md and VALIDATION.md for scope and testing.

## 2.0.1 — 2026-10-16

- Replaced illustrated backgrounds with six realistic professional interiors and matching photo thumbnails.
- Added background-only softness while keeping the original portrait sharp.
- Added reliable image loading, neutral fallback, and offline caching for all six scenes.
- Refreshed Store screenshots and poster artwork.

## 2.0.0 — 2026-10-16

- Redesigned the studio with a light workspace, navy navigation rail, violet controls, and a professional fictional AI demo portrait with a visible label.
- Added color temperature and vignette alongside brightness, contrast, saturation, and visual looks.
- Added true original-view and split-view comparisons.
- Added camera selection and 720p, 1080p, and efficient quality preferences.
- Added six sample backgrounds for the AI demo portrait. Live camera background replacement remains outside this release.
- Added zoom, mirror, grid, eye-line, and manual framing controls.
- Added immediate or timed PNG/JPEG snapshot downloads.
- Added local preset save, load, delete, import, and export with imported-data validation.
- Improved permission errors, device-loss recovery, and protection against delayed camera requests reopening the camera after a privacy stop.
- Added camera stop when hidden, enabled by default, and clearer Privacy Shield behavior.
- Refined the offline shell and explicit update flow.
- Updated English and Arabic Store copy, six app screenshots, policy wording, and release validation guidance.

This is a local preview PWA. It does not provide an operating-system virtual camera or alter video in external meeting applications. Automated browser checks are accompanied by a required Windows hardware and package-install checklist; release notes do not imply Store certification.

## 1.0.0

- Initial camera-preview studio with visual adjustments, framing guidance, local settings, PNG snapshots, privacy controls, and a PWA shell.
