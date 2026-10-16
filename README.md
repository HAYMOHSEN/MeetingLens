# MeetingLens — Camera Preview Studio

Version **2.0.0**. MeetingLens is an installable Windows-friendly PWA for preparing a webcam before a meeting, class, or presentation. Its redesigned studio pairs a light workspace with a navy navigation rail, violet controls, and a clearly labeled professional AI demo portrait.

## What the app does

- Displays a live local webcam preview after the user grants permission.
- Adjusts brightness, contrast, saturation, color temperature, vignette, and visual looks.
- Compares the original and adjusted image with original-view and split-view controls.
- Offers camera selection and 720p, 1080p, or efficient quality preferences; the camera and browser determine the actual resolution.
- Provides zoom, mirror, framing guides, a composition grid, and an eye-line guide. These are manual guides, not face detection or a measured readiness score.
- Previews six backgrounds with the **AI demo portrait only**. Background selection does not remove or replace a live camera background.
- Downloads PNG or JPEG snapshots locally, immediately or with a timer.
- Saves, loads, deletes, imports, and exports local presets, with validation of imported files.
- Stops camera tracks with Privacy Shield and, by default, when the app is hidden. Restarting requires a user action.
- Provides a cached app shell for offline use after a successful first load and an explicit update action when a new version is ready.

## Meeting-app compatibility

The adjustments apply **inside MeetingLens**. This PWA does not create a system-wide virtual camera or send enhanced video into Teams, Zoom, Google Meet, Webex, or other apps. A separate native Windows companion is needed for that capability. See [NATIVE_COMPANION_ROADMAP.md](./NATIVE_COMPANION_ROADMAP.md).

The sample person is fictional and AI-generated. Keep the visible demo label in screenshots and marketing showing the sample. See [IMAGE_ASSET_NOTES.md](./IMAGE_ASSET_NOTES.md).

## Run locally

Camera access requires HTTPS or localhost. The app is static and needs no build step or account.

~~~bash
cd meetinglens-pwa
python3 -m http.server 8080
~~~

Open `http://localhost:8080` in Microsoft Edge or Chrome. Start the camera and approve the browser permission prompt. The demo works without camera permission.

## Development checks

~~~bash
npm install
npx playwright install chromium
npm test
~~~

If using an existing Chromium installation, set `CHROMIUM_PATH` to its executable before running the test command. The test command runs the studio and offline browser checks. They exercise the implemented browser flows, including service-worker offline behavior and controlled updates; they do not replace physical Windows hardware and packaged-app validation.

Complete [RELEASE_CHECKLIST.md](./RELEASE_CHECKLIST.md), including permission denial, camera switching and disconnection, sleep/resume, and installation of the actual PWABuilder package. Automated checks do not establish Store certification or zero defects.

## Publish with GitHub Pages

1. Create a GitHub repository, for example `meetinglens-pwa`.
2. Upload **the contents of this folder to the repository root**, including `.github/workflows/deploy-pages.yml`. Do not upload only the ZIP or nest the app in another folder.
3. Open **Settings → Pages** and set **Source** to **GitHub Actions**.
4. Push to `main` and wait for the deployment workflow to complete.
5. Open the public HTTPS URL: `https://YOUR-GITHUB-USERNAME.github.io/meetinglens-pwa/`.
6. Complete the release checklist against that deployed URL before packaging.

Use the repository name you actually chose in the URL. Relative asset paths support serving the app from a GitHub Pages repository path.

## PWABuilder and Microsoft Store

1. Reserve the final app name in Microsoft Partner Center.
2. Replace the required contact placeholders in `privacy.html` and `terms.html`, publish the changes, and confirm both policy URLs are publicly accessible.
3. Copy the **Package ID**, **Publisher ID**, and **Publisher display name** from your Partner Center product identity.
4. Submit the deployed HTTPS app URL to [PWABuilder](https://www.pwabuilder.com/) and review its report.
5. Choose the Windows package option and enter the exact Partner Center identity values.
6. Download and install-test the generated package on a Windows PC. The source ZIP is not a signed Store package.
7. Add the copy and assets from [STORE_LISTING.md](./STORE_LISTING.md), complete the Partner Center declarations, and submit after the required checks are complete.

PWABuilder packaging does not guarantee Microsoft Store certification. Keep the listing, screenshots, declared languages, policy pages, and submitted app consistent.

## Included Store materials

- Six 1920×1080 PNG screenshots captured from the redesigned app: studio, looks, sample backgrounds, privacy, camera options, and presets.
- A 300×300 Store logo and 192px/512px PWA icons.
- Optional 1440×2160 poster and 3840×2160 hero artwork.
- English and Arabic listing copy, screenshot captions, and an upload guide.

Demo screenshots show the labeled fictional AI subject, not a live camera session. Arabic listing copy does not imply that the app interface is translated into Arabic. Declare only interface languages actually implemented and verified.

## Privacy and local files

Camera frames and adjustments stay on the device. The app does not upload camera video, automatically record it, or request microphone access. Settings and presets use browser-local storage. Imported preset files are read locally; exports and snapshots download at the user's request. Hosting providers may handle ordinary page-request information under their own policies. Complete and review [privacy.html](./privacy.html) before publication.

## Project files

| Path | Purpose |
|---|---|
| `index.html`, `assets/styles/app.css`, `assets/js/app.js` | Studio interface and local camera processing |
| `assets/demo/` | Fictional AI-generated sample portrait |
| `assets/icons/` | App and manifest icons |
| `assets/store-assets/` | Screenshots, logo, and optional marketing art |
| `manifest.webmanifest`, `service-worker.js`, `offline.html` | Installation, controlled updates, and offline shell |
| `privacy.html`, `terms.html` | Policy templates requiring a real support contact |
| `.github/workflows/deploy-pages.yml` | GitHub Pages deployment |
| `STORE_LISTING.md`, `CHANGELOG.md`, `RELEASE_CHECKLIST.md` | Store copy, changes, and release checks |

## References

- [Microsoft: Publish a PWA to the Microsoft Store](https://learn.microsoft.com/en-us/microsoft-edge/progressive-web-apps/how-to/microsoft-store)
- [Microsoft: PWA screenshots and images](https://learn.microsoft.com/en-us/windows/apps/publish/publish-your-app/pwa/screenshots-and-images)
- [Microsoft: Create a PWA submission](https://learn.microsoft.com/en-us/windows/apps/publish/publish-your-app/pwa/create-app-submission)
