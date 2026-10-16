# MeetingLens 2.0.0 Store Upload Pack

Use these files for the MeetingLens **PWA** listing. Copy is in [STORE_LISTING.md](../../STORE_LISTING.md); source-release checks are in [RELEASE_CHECKLIST.md](../../RELEASE_CHECKLIST.md).

## Upload order

1. Complete the required publisher/support contact and publish the public privacy-policy URL.
2. Copy the final name, descriptions, features, search terms, what's new, and captions from `STORE_LISTING.md`.
3. Upload `store-icon-300.png` in the matching Store logo field.
4. Upload the six PNG screenshots in the numbered order below.
5. Use optional poster and hero art only in compatible promotional-art fields requested by Partner Center.
6. Preview the listing and confirm its screenshots and text match the deployed and packaged app.

## Screenshot order

| File | Actual app screen |
|---|---|
| `screenshots/01-studio-1920x1080.png` | Redesigned studio with a labeled AI demo portrait |
| `screenshots/02-looks-1920x1080.png` | Local color controls and original/adjusted comparison |
| `screenshots/03-background-1920x1080.png` | Six backgrounds for the sample portrait only |
| `screenshots/04-privacy-1920x1080.png` | Privacy Shield and camera-stop controls |
| `screenshots/05-camera-1920x1080.png` | Camera selection and preview-quality preferences |
| `screenshots/06-presets-1920x1080.png` | Local presets with import and export |

The screenshots are captured from the app interface. The sample person is fictional and AI-generated, not a live webcam session. Keep the demo label visible. Recapture screenshots when the interface changes.

## Asset inventory

| Asset | Dimensions | Use |
|---|---:|---|
| `store-icon-300.png` | 300×300 | Store logo |
| `screenshots/*.png` | 1920×1080 | Six desktop screenshots |
| `posters/meetinglens-poster-1440x2160.png` | 1440×2160 | Optional poster art |
| `hero/meetinglens-hero-3840x2160.png` | 3840×2160 | Optional hero art |
| `../icons/meetinglens-192.png` | 192×192 | PWA icon |
| `../icons/meetinglens-512.png` | 512×512 | PWA icon |
| `../icons/meetinglens-maskable-512.png` | 512×512 | Maskable PWA icon |
| `../icons/meetinglens-icon.svg` | Vector | Logo source |

Check the current Partner Center field for its exact accepted size and format. These listing assets are not a signed app package. Generate the Windows package from your deployed HTTPS URL using PWABuilder and your Partner Center identity.

## Accurate scope

Camera adjustments affect the local preview inside MeetingLens. This release does not create a system-wide virtual camera or change video in Teams, Zoom, Google Meet, Webex, or other meeting apps. The six background choices work only with the labeled AI demo portrait. Framing guides are manual aids; no face tracking or readiness score is claimed.

English and Arabic listing metadata are included. Declare only app interface languages that are implemented and verified.
