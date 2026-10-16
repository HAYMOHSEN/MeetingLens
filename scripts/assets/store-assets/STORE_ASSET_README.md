# MeetingLens 3.0.1 Store Upload Pack

Use these files for the **PWA** listing. English/Arabic copy is in STORE_LISTING.md; the source project includes RELEASE_CHECKLIST.md and FEATURE_MATRIX.md. Native Windows source projects are separate and are not part of the PWABuilder PWA package.

## Upload order

1. Supply the real publisher/support contact and publish the public privacy-policy URL.
2. Copy the final name, descriptions, features, search terms, what's new, and captions from STORE_LISTING.md.
3. Upload store-icon-300.png in the matching Store logo field.
4. Upload the ten numbered screenshots.
5. Use optional poster and hero artwork only in compatible fields requested by Partner Center.
6. Preview the listing and confirm its text/images match the deployed and packaged release.

## Screenshot order

| File | Actual app workspace |
|---|---|
| screenshots/01-studio-1920x1080.png | Camera studio and clearly labeled AI sample portrait |
| screenshots/02-looks-1920x1080.png | Local color controls and original/enhanced comparison |
| screenshots/03-background-1920x1080.png | Six professional backgrounds for the sample portrait |
| screenshots/04-privacy-1920x1080.png | Privacy Shield and capture controls |
| screenshots/05-camera-1920x1080.png | Camera and quality options |
| screenshots/06-presets-1920x1080.png | Local preset import/export |
| screenshots/07-effects-1920x1080.png | Face framing, person blur, and local portrait effects |
| screenshots/08-photo-lab-1920x1080.png | Photo Lab and color-match tools |
| screenshots/09-whiteboard-1920x1080.png | Four-corner whiteboard perspective correction |
| screenshots/10-session-1920x1080.png | Microphone check, QR, and optional still backup |

These are screenshots of the running app. The labeled sample person is fictional and AI-generated, not a physical webcam test. Preserve that label and recapture after visible interface changes.

## Asset inventory

| Asset | Dimensions | Use |
|---|---:|---|
| store-icon-300.png | 300×300 | Store logo |
| screenshots/*.png | 1920×1080 | Ten desktop screenshots |
| posters/meetinglens-poster-1440x2160.png | 1440×2160 | Optional poster |
| hero/meetinglens-hero-3840x2160.png | 3840×2160 | Optional hero |
| ../icons/meetinglens-192.png | 192×192 | PWA icon |
| ../icons/meetinglens-512.png | 512×512 | PWA icon |
| ../icons/meetinglens-maskable-512.png | 512×512 | Maskable PWA icon |
| ../icons/meetinglens-icon.svg | Vector | Logo source |

Check the current Partner Center field for accepted size/format. These assets are not a signed application package.

## Feature boundaries for the listing

- Auto Framing, live background blur, and modest landmark-assisted refinement run locally inside the PWA. Replacement interior scenes apply to the sample portrait only.
- Photo enhancement and small-object inpainting are local image-processing tools, not cloud/generative reconstruction.
- Microphone noise suppression depends on browser support and does not route audio into meetings.
- The PWA does not create a virtual camera or claim browser eye-contact correction/NPU execution.
- The separate native utility and upstream virtual-camera reference remain separate from this PWA's promised features.
- English and Arabic listing metadata are included. Declare only interface languages actually translated and verified.
