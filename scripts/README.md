# Rasmora Studio

**Reserved Microsoft Store product name: Rasmora Studio.** Arabic brand: **رسمورا ستوديو**. Tagline: **Draw. Paint. Create in 3D.**

Release candidate **5.0.3-rc.1** fixes export, project-import, Team sync and 3D save/import defects found in the 16 October 2026 pre-release audit. See **APPLY_FIX.txt** and **release-audit.html** before deployment. Existing ArtProof projects and brush packs remain compatible. The candidate is not approved for release: viewport PNG export after path tracing timed out in both combined and fresh software-rendered browser sessions. Investigate that path on supported Windows GPUs before shipping. No Windows certification is claimed.

An offline-capable Progressive Web App for painting, illustration, retouching, editable vector artwork, frame animation, and delivery preparation. This is an installable browser app, not a signed native Windows executable.

## Included studios

Open **3D Studio** in the top bar for mesh sculpting, UV unwrapping, layered texture painting, PBR materials, studio lighting, progressive path tracing, a basic bone rig and GLB/OBJ exchange. Save these scenes separately as **.rasmora3d.json**. The 3D scene limit is 200,000 triangles; WebGL 2 and compatible graphics hardware are required.

The canvas toolbar now supports free view rotation, Fit and Ctrl+wheel zoom. **Team** connects to the optional private revision-sync and feedback service. Run **Start_Team_Server.cmd** separately and follow **TEAM_SETUP.txt**. No public service has been deployed. See **RELEASE_NOTES_5.txt** for the complete feature scope, hardware dependencies and limits.

The 3D runtime and UV engine are bundled for offline use. End users do not need npm install. Developers can rebuild with npm install followed by npm run build. Third-party notices are in licenses/.

## Start this version

1. Extract the ZIP to a folder.
2. With Node.js 22 or newer installed, run `node ai-bridge.cjs` in that folder, or double-click `Start_Rasmora.cmd` on Windows.
3. Open **http://127.0.0.1:8787** in Edge or Chrome. The offline creative tools need no API key or npm install. You may install the PWA from the browser.
4. New work is captured automatically for speedpaint. Use **Motion → Pause capture** to pause it. Save with **Export → Save editable project**; reopen using **Open project** in the top bar.

You can also serve the folder with a static server, such as `python3 -m http.server 8080`. The optional AI bridge is separate from the offline features.

## New creative tools

| Studio | Working additions |
| --- | --- |
| Layers | Editable RGB/master and individual-channel Curves; Colour Balance for shadows, midtones and highlights; live hue and saturation; adjustment opacity mixes the result without changing the base layer's alpha or pixels. |
| Reference | Square/isometric grids; one-, two-, and three-point perspective; adjustable horizon and vanishing points; grid snapping for lines, shapes and pen anchors; perspective-constrained line endpoints, pen anchors and curve tangents. |
| Reference / Brush | Horizontal, vertical and dual-axis mirrors; radial and mirrored-radial symmetry; 2–12 arms; movable symmetry centre. |
| Vector | Cubic Bézier pen with editable anchors and tangent handles, numeric offsets/styles, duplicating and stacking, editable multiline Arabic/English text, shapes and speech balloons, basic SVG import and scalable SVG export. |
| Vector + raster | Live vector-linked paint masks: paint textures inside editable paths/text, move or reshape the vector to update the mask, and release it without erasing the original paint pixels. |
| Create | Natural sketch, comic ink, manga ink and wet-paint brush presets; paper/grain/wetness/pigment pickup/paint-load controls; 4-panel, 6-panel and RTL manga layouts; selection-clipped screen tones. |
| Motion | Editable frame timeline, blank/duplicate/reorder/delete, exposure duration, FPS, playback, previous/next onion skins, PNG sequences with timing metadata, and browser-encoded WebM. |
| Speedpaint | Automatic, local drawing-change capture from the start of a new drawing; pause/resume; stages retained in saved projects; WebM or JPEG-sequence export. Adaptive sampling keeps memory bounded while preserving the beginning and latest stage. |
| Assist | Local border-colour foreground selection, non-destructive cutout previews, ordinary 2× resampling, and an optional server-side AI image-editing connection for removal, selected-area prompt fill and high-resolution enhancement. |

### Live adjustments

In **Layers**, select **Curves** or **Colour Balance** from the adjustment menu and click **Add**. Adjustment layers affect the raster composition below their position, including groups, not the separate live-vector overlay.

For Curves, click the graph to add a point, drag it, or edit its numeric input/output. Choose composite RGB or a separate channel. Reset and contrast/fade presets are available. For Colour Balance, choose a tonal range and adjust the cyan/red, magenta/green and yellow/blue controls. The luminance-preservation option is an RGB approximation, not ICC colour management.

Hide an adjustment, reduce its layer opacity, or undo to recover the earlier appearance. The base paint pixels are not rewritten. Parameters are retained in project files and animation frames.

### Construction and vector workflow

- Enable the perspective overlay in **Reference**, then choose its mode and horizon. Grid snapping places pen anchors and line/shape points on the geometric grid. Perspective snapping projects line endpoints, pen anchors and dragged tangents toward the nearest vanishing-point ray. It is a 2D construction aid, not a 3D scene model.
- Select **Path**. Click for corners, or drag while placing an anchor to create a curve. Press **Enter** or **Finish path**. **Edit points** edits anchors/tangents; Alt-drag breaks tangent symmetry. Escape cancels an unfinished path. Locally created cubic paths have editable handles; imported SVG paths can be moved and styled but are not decomposed into editable anchors.
- Select a vector/text object and a paint layer, then choose **Clip active paint to vector**, or create **New paint inside vector**. The solid vector preview is hidden so the raster texture shows, but its geometry remains editable as a live mask. Restore visibility from **Show / hide**, or keep a separate visible path for an outline. **Release active paint clip** restores the unclipped pixels. Deleting a mask's vector hides its linked paint until the link is released.
- SVG retains visible mathematical paths and text. Raster paint, including clipped textures, remains embedded bitmap content and does not become infinitely detailed. SVG import supports basic paths, shapes, groups, transforms and text—not advanced CSS, gradients, masks, fonts or linked images. SVG is the Illustrator interchange route; there is no direct Adobe plug-in or native `.ai` support.

### Animation and speedpaint

Expand the timeline or open **Motion**. Capture the current drawing, then add blank/duplicate frames. Blank frames retain paper and starter-photo layers; use **Create → Hide starter photograph** for a blank illustration workflow. Each frame keeps its layer/vector state and its own undo history; switching frames retains the latest six undo snapshots for that frame.

Onion skins show the adjacent frames' artwork without paper/starter-photo layers. They are never baked into exports. PNG-sequence ZIPs include `timing.json` with FPS and exposure durations. WebM export uses MediaRecorder and takes approximately the clip's duration. Clips shorter than half a second hold their final frame until 500 ms so the browser can encode a non-empty video. Keep the tab visible; use **Cancel video export** or Escape if needed. Unsupported browsers can still export image sequences.

Speedpaint capture starts automatically for new drawings, stores a snapshot after committed changes, and omits idle time. It is an edit-based time-lapse, not a screen recorder or a recording of every cursor movement. At 240 retained stages, older stages are thinned; the first and newest stages are kept so capture continues through the finish. Stages and pause/resume state are saved with the editable project. Export **Time-lapse WebM** for a speedpaint video, or **JPEG sequence** for another video editor.

Limits: 1200 × 900 master document, up to 48 animation frames, 240 retained speedpaint stages, and 100 MB project save/open limit. Long or layer-heavy projects can consume substantial memory. Save regularly; this build does not provide crash-recovery autosave.

### Optional AI connection

The app makes **no automatic image uploads**. Local selection is a connected border-colour heuristic, not AI object recognition. Local 2× output is interpolation, not AI-generated detail. See **AI_SETUP.md** for the optional bridge.

The included bridge supports real provider image-edit requests, but needs your server-side API key and model access. In Assist, explicitly approve sending the selected paint layer, prompt, and fill mask, enter the bridge token, and press **Run connected AI**. Review the result before applying it as a new layer. A fill is clipped to the original selection when applied; cutouts hide but retain the source layer. Other background layers may still need to be hidden for a transparent preview.

AI can change faces, lettering and other details. Background removal is generative editing, not guaranteed pixel-exact segmentation. Higher-resolution enhancement requests 2048 × 1536; applying it fits the document size, while **Download result PNG** retains the returned resolution. Charges may apply even if a request is cancelled. No live paid provider calls were made during validation.

## Professional starter canvas

Choose **New** to start a blank, pure-white 1200 × 900 canvas with an empty, selected **Layer 1** above a locked white background. New projects do not contain a sample-photo layer. The confirmation reminds you to save your current project first; cancelling keeps it open. A slow-loading demo image cannot replace the new artwork or reset its undo history.

The app opens with **Aurelia · Editorial sample**, an original high-end studio photograph on its own editable layer. A blank paint layer sits above it, so artists can immediately test brushes, masks, selections, typography, and retouching. Hide or delete the sample layer whenever a blank canvas is preferred.

## Included working capabilities

- **Brush Studio:** 16 built-in pencil, pen, airbrush, oil, watercolour, charcoal, texture, and stamp tips. Pointer Events use pen pressure, tilt, twist/rotation, and velocity when the device exposes them. Artists can adjust flow, opacity, spacing, stabilisation, shape and angle dynamics, symmetry, and palm rejection; custom brushes can be saved, exported, and imported as Rasmora Brush Pack JSON files.
- **Layers:** paint layers, groups, group rendering, masks, clipping masks, live vector masks, blend modes, opacity, pixel/alpha/position locks, and live adjustment layers (Curves, Colour Balance, brightness, contrast, saturation, hue, blur, and monochrome).
- **Selections:** freehand lasso, rectangular and elliptical marquees, connected-region magic wand, colour range, and an edge-aware Quick Selection brush. Replace, add, subtract, or intersect masks; sample the active layer or visible composite; feather/refine/invert; preview the actual selection boundary; and copy selected pixels to a new layer.
- **Transforms:** selection-aware free transform with anchored resize handles, proportion lock, move, rotation handle, X/Y skew, corner distortion, bend, and a nine-control-point warp grid. The preview preserves the original until Apply, stays in the correct layer stack, and leaves unselected pixels in place. Apply transforms the selection mask too. Reset, Cancel, Undo, and Redo are available.
- **Liquify and retouching:** adjustable Push, Expand, Pinch, and Twirl brushes with diameter and strength controls. Liquify protects pixels outside the selection and supports per-stroke undo. Existing smudge, blur, sharpen, dodge/burn, clone, healing, and wet mixing tools remain available.
- **Colour Studio:** an interactive digital hue/saturation wheel, RGB, HSV, HSL, HEX, and CMYK values, palette extraction, harmony palettes, gradients, colour history, and colour-vision proof previews. The wet-paint mixer combines two pigments into a reusable colour, and the Wet Mix canvas tool deposits and picks up colour as it is dragged.
- **Reference tools:** side-by-side reference board, perspective grid, rulers, pose mannequin, lighting arrow, symmetry guide, and custom guide lines.
- **Vector and text:** editable cubic Bézier anchors and handles, basic SVG shape/path/text import/export, vector icons, geometric shapes, and editable multiline Arabic/English text with RTL support.
- **Export:** PNG, JPG, uncompressed RGB TIFF, flattened compatibility PSD, SVG with live Rasmora paths/text, Device-CMYK PDF proof, transparent background, and high-resolution social, poster, print, and portfolio presets. The .rasmora.json file retains layers, masks, adjustments, vectors, and project data.

## Important delivery notes

- The PSD export is a valid flattened RGB compatibility file. Keep the .rasmora.json project alongside it for editable Rasmora layers.
- The PDF creates Device-CMYK raster data at a nominal 300 DPI page size. For a colour-critical commercial print run, ask the printer for the final ICC-profiled conversion and proof.
- C2PA signing and shareable review URLs still require a separate production signing/collaboration service; they are not represented as completed features in this offline build.
- Quick Selection is a connected-colour brush, not AI object/subject detection. Its tolerance controls edge sensitivity within the brush footprint.
- These transforms edit the active raster layer (or its mask when mask editing is enabled); they do not transform live vector/text objects. Unlock position and alpha before transforming. Liquify edits the active raster layer's pixels.
- Warp uses a continuous tessellated grid with bilinear pixel sampling, not a 3D or physically simulated deformation system. A reduced-resolution preview is used during grid dragging; releasing the pointer or applying renders at full document resolution.
- Natural-media tools are physically inspired procedural brush approximations, not a fluid solver, spectral pigment model, or true impasto simulation.
- Arabic/English shaping uses browser and installed-font support. For reliable cross-computer typography, install the same fonts and proof the resulting SVG/PDF.
- Automated DOM/canvas and mocked-provider tests cover the new workflows. Browser workflows and real WebM encoding were exercised in Chromium. Accessibility, sustained performance, Windows pen/palm rejection and live provider-output testing remain required before Store release. No native Windows/Store certification is claimed.

## Selection and transform workflow

1. In **Layers**, choose the layer containing the pixels you want to edit. For the starter photograph, select **Aurelia · Editorial sample**, not the empty Layer 1 above it.
2. Open **Select** and use Lasso, a Marquee, Magic Wand, or Quick Selection. Adjust tolerance and brush diameter as needed. Use the mode buttons, **Shift** to add, **Alt** to subtract, or **Shift + Alt** to intersect.
3. Choose **Transform selection**, or press **Ctrl + T**. Drag inside to move; drag square handles to resize; drag the round handle to rotate. Corner resizing keeps proportions when its checkbox is enabled. Hold Shift while rotating to snap to 15-degree increments.
4. Choose **Skew** to shear with edge handles, or **Warp / Mesh warp** to move nine grid handles. The numerical sliders also adjust scale, rotation, shear, and bend. **Reset preview** returns to the original.
5. Press **Enter** to apply or **Escape** to cancel without losing the selection. **Ctrl + Z** undoes; **Ctrl + Y** or **Ctrl + Shift + Z** redoes.
6. For brush-based reshaping, choose **Liquify**, set its mode, diameter, and strength, then drag over the active layer. The selection protects surrounding pixels. Each completed stroke is undoable.

Other shortcuts: **M** rectangular marquee, **Shift + M** elliptical marquee, **W** Quick Selection, **Ctrl + A** select all, **Ctrl + D** deselect, and **[ / ]** adjust Quick Selection or Liquify brush diameter. Text input fields retain their usual editing shortcuts.

## Developer regression checks

The app has no CDN or browser runtime dependencies. The optional bridge uses Node built-ins only. Optional development tests use the pinned canvas and DOM packages:

    npm install
    npm test

Validation for this candidate: **67 automated checks passed**, including seven new export, rollback and save-boundary regressions. The release-audit.html report and validation/ records describe the browser checks, source revision, remaining device tests and deployment status. Windows hardware, Store packaging and production-service validation remain separate.

## Run locally

Serve this folder from any static web server, then open index.html.

    python3 -m http.server 8080

Open http://localhost:8080 and install it from the browser when prompted.

## Microsoft Store / PWA Builder

Deploy the folder to HTTPS hosting first. Then submit the public URL to PWA Builder, generate the Windows package, test it on Windows, and submit that package through Partner Center.
