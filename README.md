# MeetingLens — Camera Preview Studio

MeetingLens is an installable Windows-friendly PWA that helps users prepare their webcam before a meeting, class, or presentation. It provides a local camera preview, natural color and lighting controls, framing guidance, privacy controls, and snapshot capture.

## Important product boundary

This PWA processes the camera **inside MeetingLens only**. It does **not** create a system-wide virtual camera for Teams, Zoom, Google Meet, or Webex. A future native Windows companion is required for that capability. See [NATIVE_COMPANION_ROADMAP.md](./NATIVE_COMPANION_ROADMAP.md).

## What works in this release

- Live camera permission and local browser preview
- Brightness, contrast, saturation, color-look, crop, and light smoothing controls
- Before/after “Hold original” comparison
- Meeting-ready profiles for natural, low-light, teaching, and presentation preparation
- Local-only settings storage and manual PNG snapshot download
- Privacy Shield that stops the camera preview immediately
- Offline app shell and installability through a web manifest and service worker

## Run locally

Camera permission requires `https://` or `http://localhost`.

```bash
cd meetinglens-pwa
python3 -m http.server 8080
```

Open `http://localhost:8080` in Microsoft Edge or Chrome. Select **Start camera preview** and approve the camera permission prompt.

## Publish with GitHub Pages

1. Create a new GitHub repository named `meetinglens-pwa`.
2. Upload every file in this folder, including `.github/workflows/deploy-pages.yml`.
3. In GitHub, open **Settings → Pages** and set **Source** to **GitHub Actions**.
4. Push to the `main` branch. The included workflow publishes the app automatically.
5. Confirm the deployed URL works over HTTPS:

   `https://YOUR-GITHUB-USERNAME.github.io/meetinglens-pwa/`

6. Open the site in Edge, test camera permission, installability, and offline behavior before packaging.

## PWABuilder → Microsoft Store

1. Reserve the final app name in Microsoft Partner Center.
2. Copy the **Package ID**, **Publisher ID**, and **Publisher display name** from Product identity.
3. Submit the deployed HTTPS URL to [PWABuilder](https://www.pwabuilder.com/).
4. Resolve every PWABuilder report-card warning.
5. Choose **Package for Stores → Windows**, enter your Partner Center identity values, and download the generated package.
6. Install-test the package on a Windows PC before Store submission.
7. Use the prepared assets and copy in [`STORE_LISTING.md`](./STORE_LISTING.md).

PWABuilder packaging does not eliminate Store certification requirements. All Store text and screenshots must describe what this PWA actually does.

## Store materials already included

`assets/store-assets/` will contain:

- Four real 1920×1080 screenshots captured from the finished app
- One 300×300 Store icon
- One optional 1440×2160 poster asset
- One optional 3840×2160 super-hero asset

See [`STORE_LISTING.md`](./STORE_LISTING.md) for exact names, captions, English/Arabic metadata, and the submission checklist.

## Before publishing

- Replace the placeholder support contact in `privacy.html`.
- Add the final public Privacy Policy URL in Partner Center.
- Reserve the final Store name before using it in marketing.
- Verify that all claims match the PWA-only capability scope.
- Set the GitHub Pages site to public or deploy the same static files to another HTTPS host you own.

## Project structure

```text
meetinglens-pwa/
├── .github/workflows/deploy-pages.yml
├── assets/
│   ├── icons/
│   └── store-assets/
│       ├── hero/
│       ├── posters/
│       └── screenshots/
├── index.html
├── offline.html
├── privacy.html
├── manifest.webmanifest
├── service-worker.js
├── STORE_LISTING.md
├── NATIVE_COMPANION_ROADMAP.md
└── README.md
```

## References

- [Microsoft: Publish a PWA to the Microsoft Store](https://learn.microsoft.com/en-us/microsoft-edge/progressive-web-apps/how-to/microsoft-store)
- [Microsoft: PWA screenshots and images](https://learn.microsoft.com/en-us/windows/apps/publish/publish-your-app/pwa/screenshots-and-images)
- [Microsoft: Create a PWA submission](https://learn.microsoft.com/en-us/windows/apps/publish/publish-your-app/pwa/create-app-submission)
