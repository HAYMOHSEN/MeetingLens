# MeetingLens — Camera Studio and Photo Lab

Version **3.1.1**. MeetingLens is a Windows-friendly, installable PWA for preparing a webcam, improving photos, and capturing readable whiteboards. Camera, photo, and audio processing run locally. The app includes six professional interior backgrounds for live video and a clearly labeled fictional AI sample portrait for trying the controls without a camera.

## Camera studio

- Select a built-in or USB camera, inspect reported capabilities, request an available resolution/frame-rate preference, and see the actual delivered resolution. Driver and browser support determine the available modes.
- Enable **Auto Framing** to follow a detected face with a smoothed digital crop.
- Select any of six professional scenes to replace the room behind the person in the live camera preview. Adjust the selected scene's softness, or apply **Background Blur** to the actual room using local person segmentation.
- Add **Portrait Light** for a gentle fill-light effect and use modest, landmark-masked skin smoothing and teeth brightening. These adjustments do not reconstruct clipped highlights or guarantee removal of glare.
- Adjust brightness, contrast, saturation, temperature, vignette, and looks. Compare original/enhanced output, mirror the preview, and refine digital zoom in 0.1% steps.
- Choose **Basic preview** to bypass MeetingLens enhancements while troubleshooting. This is a browser preview mode; it does not switch the Windows driver to raw DirectShow.
- Save local presets and export/import validated preset files. Download immediate or timed PNG/JPEG snapshots.
- Stop camera and microphone capture with Privacy Shield. The default hidden-app protection stops the camera, and microphone capture always stops when hidden.

Face tracking, segmentation, and landmark assistance use bundled MediaPipe models in a local worker with CPU/WebAssembly execution. The browser must support WebGL2 for the models' texture bridge. Model errors leave the regular preview and manual controls usable, with an unavailable/retry status rather than a claim that replacement is active. Detection can miss faces, hair, hands, or fast movement; inspect the result. The browser version does not select an NPU or synthesize eye contact.

### Replace your live camera background

1. Choose **Start camera**, then open **Scenes** and click a scene. A scene can also be chosen before starting the camera.
2. Allow the bundled local vision models to finish their initial load. The app keeps the real background visible while segmentation is loading or unavailable; read the background status for progress or retry guidance.
3. The detected person is composited over the selected scene inside MeetingLens. Use the replacement switch to toggle that selection and the softness slider to soften the scene. Scene softness blurs the selected room; it does not add blur to the person.
4. Choose **Use real background** to turn off both replacement and room blur. **Original**, **Basic preview**, and zero enhancement intensity also bypass background processing.

After installing an older version, apply the app's **Update** banner and reload the updated app before testing. If no update appears, close and reopen the app online. This feature changes MeetingLens previews and snapshots; it does not change the camera selected in Zoom or Teams.

## Photo Lab and whiteboard

Open **Photo Lab** to import up to eight photos. Images are resized to a maximum 2048-pixel edge for local editing.

- **Smart Enhance:** automatic tone and color analysis with adjustable strength. This is image processing, not a generative AI model.
- **Color Match:** transfer overall Lab color statistics from a reference photo to one image or the full set, then export JPEGs in a ZIP.
- **Object Removal:** brush over small distractions and fill from neighboring pixels. It works best on simple backgrounds and is not generative scene reconstruction.
- **Face Refinement:** manual skin/teeth brushes, or optional local landmark assistance.
- **Perspective Whiteboard:** suggest bright-board corners, correct all four corners manually, flatten perspective with a homography, improve ink contrast, and save JPEG.

Undo, reset, original comparison, validated imports, keyboard-accessible corner handles, and capped image sizes help keep editing predictable. Suggested board corners are a heuristic; verify them before applying.

## Session utilities

- **Voice check:** explicit microphone start, supported browser noise suppression/echo cancellation/automatic gain control, a level meter, and a local recording of up to 60 seconds. These browser audio constraints are not a MeetingLens AI Voice Focus engine and do not route processed speech into other applications.
- **QR scan:** decode the current preview locally with BarcodeDetector or bundled jsQR. Review and copy decoded text. Optional automatic copying applies to new decoded links; links are not opened automatically.
- **Snapshot backup:** opt into a writable folder for the current session, or browser-local IndexedDB backups retaining the latest 50 stills. Backup failures are reported separately from the normal download. Folder access requires a compatible browser and explicit permission; browser backup data can be removed by storage cleanup.

No microphone, recording, QR scan, or backup starts automatically. Downloaded snapshots and recordings remain files under the user's control.

## Windows companion and meeting apps

The PWA improves its own preview; it does not create a virtual-camera device or send its processed canvas/audio into Zoom, Teams, Meet, or other apps.

The separate source project in [native-windows/README.md](./native-windows/README.md) provides a Windows camera preview and device-capability controls. On supported Windows cameras it reads and changes available Windows Studio Effects through Kernel Streaming properties, including background blur, eye contact, and portrait light; automatic framing and device zoom/modes use Windows camera controls. Unsupported modes stay unavailable. Windows controls NPU acceleration and Voice Focus availability.

The companion can export a local JSON report. Import it in [Windows camera tools](./native-capabilities.html) to review a **snapshot** of capabilities; this is not a live bridge to the companion. Camera/sound settings open only after the user clicks their links. Avoid applying duplicate blur or other effects in Windows, MeetingLens, and the meeting app.

The native project also includes a DirectShow diagnostic preview and a pinned Microsoft virtual-camera reference with build scripts. That reference is not connected to the PWA canvas. Multi-app camera sharing depends on supported Windows settings/device behavior; no integrated MeetingLens routing is claimed. The managed Windows source passed compilation against 209 official reference assemblies and 12 KS protocol/report checks in a Linux harness. Full Windows publishing, native C++ builds, and physical-device testing remain to be completed using the native guide and release checklist.

See [FEATURE_MATRIX.md](./FEATURE_MATRIX.md) for the exact status of every requested feature and [NATIVE_COMPANION_ROADMAP.md](./NATIVE_COMPANION_ROADMAP.md) for integration work remaining.

## Run locally

The app is static and needs no production build step. Camera, microphone, clipboard, and folder permissions require HTTPS or localhost.

~~~bash
cd meetinglens-pwa
python3 -m http.server 8080
~~~

Open http://localhost:8080 in current Microsoft Edge or Chrome. Camera and microphone access are separate, explicit actions. The sample works without either permission.

## Development and validation

~~~bash
npm install
npx playwright install chromium
npm test
npm run test:backgrounds
npm run test:release
~~~

Use the additional test commands listed in package.json for the advanced studio, Photo Lab, session tools, local vision, and native-report viewer. Set CHROMIUM_PATH if using an existing browser installation. See [VALIDATION.md](./VALIDATION.md) for completed checks and their limits.

The complete photo regression suite also requires Python 3 with Pillow and the unzip command. Install Pillow with `python3 -m pip install Pillow`; use a development environment with those tools available, such as WSL on Windows.

The complete regression command includes the shipping edge-case suites. See [SHIP_REVIEW.md](./SHIP_REVIEW.md) for fixed defects and the remaining publication requirements.

Complete [RELEASE_CHECKLIST.md](./RELEASE_CHECKLIST.md) on physical Windows cameras and the generated Windows package. Simulated Chromium devices do not establish driver compatibility, battery life, audio quality, NPU use, or Store certification.

## GitHub Pages and PWABuilder

1. Create a GitHub repository, for example meetinglens-pwa.
2. Upload **this folder's contents to the repository root**, including .github/workflows/deploy-pages.yml. Do not upload only the ZIP or nest the app in another folder.
3. In **Settings → Pages**, choose **GitHub Actions**. Push to main and wait for successful deployment.
4. Open the public HTTPS app URL, for example https://YOUR-GITHUB-USERNAME.github.io/meetinglens-pwa/.
5. Fill in the real publisher/support contact in privacy.html and terms.html, publish them, and verify the public policy URL.
6. Reserve the final Store name. Copy the exact Package ID, Publisher ID, and Publisher display name from Partner Center.
7. Submit the public app URL to [PWABuilder](https://www.pwabuilder.com/), review its report, and generate a Windows package with that identity.
8. Install and test the generated package on Windows, complete the release checklist, then submit the matching metadata/assets from [STORE_LISTING.md](./STORE_LISTING.md).

The source ZIP is not a signed Store package. Packaging the PWA does not package the separate native projects or establish Microsoft Store certification. All relative paths support a GitHub Pages repository subpath.

## Store materials

Ten 1920×1080 app screenshots cover the studio, looks, background controls, privacy, camera options, presets, local effects, Photo Lab, whiteboard, and session tools. A 300×300 logo, PWA icons, optional 1440×2160 poster, optional 3840×2160 hero, and English/Arabic metadata are included. Keep the visible sample AI disclosure in screenshots. A screenshot using that sample is not a physical-webcam test. Arabic listing text does not imply an Arabic interface; declare only verified interface languages.

## Privacy and files

Camera/audio frames, imported photos, reference images, masks, and reports are processed on the device. Models and decoders are bundled, without a cloud inference endpoint. Settings/presets use localStorage; optional image backups use IndexedDB or an explicitly selected local folder. Photo edits and imported capability reports are temporary tab data unless exported. QR content reaches the system clipboard only by a chosen copy action or enabled automatic-link-copy option.

The app has no account, advertising, or built-in analytics. Hosting providers still receive normal static-file requests. After the initial successful cache, the offline shell and bundled assets can reopen without a network; storage eviction may require loading them again. Complete and review [privacy.html](./privacy.html) before publication.

## Main source files

| Path | Purpose |
|---|---|
| index.html, assets/js/app.js | Camera studio and local preview |
| photo-workbench.html, assets/js/photo-workbench.js | Photo Lab, batch edits, whiteboard |
| assets/js/vision-effects.js, assets/vendor/vision/ | Bundled local face/segmentation worker and models |
| assets/js/session-tools.js, assets/vendor/jsqr/ | Microphone check, QR, snapshot backups |
| native-capabilities.html, assets/js/native-capabilities.js | Read-only local Windows capability report viewer |
| native-windows/ | Separate Windows controls/diagnostics and virtual-camera reference source |
| assets/demo/, assets/icons/, assets/store-assets/ | Sample imagery, icons, Store assets |
| manifest.webmanifest, service-worker.js, offline.html | Installation, offline files, controlled updates |
| privacy.html, terms.html | Publisher-completed policy pages |
| .github/workflows/deploy-pages.yml | GitHub Pages deployment |
| .github/workflows/windows-native-build.yml | Windows controls, diagnostics and reference-provider builds |

## References

- [Microsoft: Windows Studio Effects overview](https://learn.microsoft.com/en-us/windows/apps/develop/windows-integration/studio-effects)
- [Microsoft: Publish a PWA to the Store](https://learn.microsoft.com/en-us/microsoft-edge/progressive-web-apps/how-to/microsoft-store)
- [Microsoft: PWA screenshots and images](https://learn.microsoft.com/en-us/windows/apps/publish/publish-your-app/pwa/screenshots-and-images)
- Third-party model/code provenance and licenses are included beside the bundled dependencies and in the native project.
