# MeetingLens 2.0 validation record

Checked on 16 October 2026 using headless Chromium 153 on Linux. Camera checks use Chromium's synthetic camera and controlled permission/device events. They do not establish compatibility with a particular Windows webcam or certify a Store package.

## Automated results

All **13 studio browser scenarios passed** in `scripts/verify-studio.cjs`:

- Professional portrait loading and navigation to all seven panels.
- A 390px layout without horizontal page overflow; all panels remain reachable.
- Pixel changes from adjustments, and enhancement intensity zero matching the original.
- Accurate original-left / enhanced-right split comparison.
- Preset save, restore, export, valid import, and rejection of malformed imports.
- Startup with corrupt, hostile, or blocked browser storage.
- Actual PNG/JPEG downloads and timed snapshot cancellation by Privacy Shield.
- Camera startup, stopping every track, and release by Privacy Shield.
- Quality changes resizing output, restarting cleanly, and never requesting audio.
- Delayed permission responses cancelled by Stop or Privacy Shield.
- Hidden-tab camera release, no automatic restart, and explicit restart.
- Camera-disconnect feedback and recovery.
- Permission-denied feedback and retry recovery.

Both service-worker integration scenarios passed in `scripts/verify-offline.cjs`: offline app shell, query shortcuts and portrait; explicit update activation, previous-release cleanup, and preservation of unrelated caches.

Additional visual checks passed at 1920×1080, 1366×768, and 390×844. Fullscreen controls remained inside the viewport. Six 1920×1080 Store screenshots were captured from the running app with the labeled fictional AI sample portrait. Source JavaScript syntax and manifest asset paths were checked. Archives were checked for corruption before delivery.

## Before release

Complete the real Windows camera and PWABuilder installation checks in `RELEASE_CHECKLIST.md`. Fill in the real support contact in the policy pages. Confirm that your published HTTPS site, Store listing, and packaged version match.

The PWA adjusts its local preview. It does not create a virtual camera for other meeting apps. All six background scenes apply to the included sample portrait only.
