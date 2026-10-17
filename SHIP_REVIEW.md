# MeetingLens 3.2.1 shipping review

Reviewed on 17 October 2026. This review covers the supplied source and local browser tests. A deployed public URL or signed Windows package was not supplied for installed-package testing.

## 3.2.1 background activation and runtime recovery

A successful analysis taking more than 1.5 seconds could arrive already expired: both the vision cache and studio compared the result's capture timestamp with the current time. The background could therefore remain inactive even while the model repeatedly completed valid person masks.

Version 3.2.1 records genuine completion time separately. A person mask remains paired with the exact frame that produced it, and its lifetime is measured from completion with a bounded 1.5–5-second allowance based on the observed successful request duration. Fast processing keeps the normal 1.5-second stall limit. Cached, repeated, mismatched or failed responses cannot renew this allowance, and face-only tracking retains its capture-age limit. Privacy resets still clear retained frames and reject pending results. This trades bounded delayed-frame display for a usable effect on slower devices; it is not a motion-performance guarantee.

GPU model creation could also succeed while later execution failed. The worker now releases that GPU task, creates the same person model on CPU and retries the exact retained bitmap/timestamp. A successful retry updates backend and capability status. Invalid confidence output remains an explicit error rather than being hidden by delegate fallback; a failed CPU retry leaves segmentation unavailable with ordinary preview/manual tools usable.

Effect-rate measurement retains slower decimal rates rather than resetting solely because one inference took more than 1.5 seconds. Processing background… means no usable pair; Measuring effects… means a pair is available while its update rate is sampled. Final verification results are recorded separately in VALIDATION.md. Physical Windows camera, GPU and generated-package behavior remain unverified until the release checklist is completed.

## 3.2.0 person detection and frame alignment

Further review showed that sharpening the older model's boundary could not restore shoulders or arms that the detector had classified as background. Separately, applying a completed mask to a newer moving camera frame could cut off a body part that had changed position during inference.

Version 3.2.0 replaced that model with SelfieMulticlass 256×256 and combined every non-background class into the foreground. Live replacement, room blur and person lighting use a completed analysis with its matching captured camera frame. Split comparison and snapshots use that same pair. The initial 1.5-second capture-age expiry was subsequently corrected in 3.2.1 as described above. Stop, Shield, camera changes and other privacy resets clear the bounded frame buffers and invalidate pending results.

Person segmentation chooses GPU only when browser renderer information identifies supported hardware. Software or unknown renderers use CPU/WebAssembly, and GPU initialization failure retries the same model on CPU. Face tracking remains on CPU. This is not NPU execution or a hardware performance guarantee. Holding matching frames introduces inference delay and can make processed motion less fluid on CPU. The FPS label counts newly completed matching frames as fps · effects while person effects are active, with Processing background… until measurement is available. Ordinary rendering, including Basic preview and Hold original, is labeled fps · preview refresh and uses current video directly. Preview refresh does not measure the camera's physical capture rate.

The model and frame-pairing changes improve a demonstrated failure; they do not guarantee perfect hair, hands, movement or body coverage in every room. Complete physical Windows camera and sustained-performance checks before publication. See the current validation records for measured automated results; private test images are not part of the source or Store pack.

## 3.1.1 person-boundary correction

The live-background compositor could leave a wide, soft transition around the body, making the subject's outline appear foggy against the selected scene. Version 3.1.1 tightens this transition while keeping selected-scene softness behind the person. The replacement path does not add blur to foreground camera pixels.

This correction does not guarantee perfect separation of fine hair, fingers or fast movement. Lighting, camera resolution, framing and model confidence still affect the result. Review the boundary on physical Windows webcams before publication, including dark clothing, hair, hands, motion and contrasting backgrounds.

## 3.1.0 live-background correction

The earlier background picker changed the fictional demo portrait, but did not replace the room in a physical camera stream. Background blur used live segmentation; the chosen professional scene was missing from that live rendering path. This limitation explains why the background appeared to work in the sample and failed when a real camera was started.

Version 3.1.0 adds that live compositing path. A selected scene arms replacement before or after camera start and automatically loads the local models. The actual webcam subject is masked over the selected interior once usable person segmentation is ready. Scene softness applies behind the person. Loading, unavailable and stale-analysis states retain the actual room with status feedback. Use real background disables replacement and room blur; Original, Basic preview and zero enhancement intensity bypass background processing.

Existing installations must apply the app's Update banner and reload the updated app. The change affects MeetingLens preview and snapshots. It does not add a virtual-camera bridge to Zoom or Teams, an NPU backend, or browser gaze correction. The native source is unchanged by this fix.

Use VALIDATION.md and docs/validation/ for the completed current-release checks and their exact scope. The release checklist includes physical-camera replacement tests, missing-model/WebGL2 failure, stalled analysis, existing-installation updates and full archive extraction/download verification. A completed sample screenshot alone does not verify a physical webcam.

## Publication requirements

Before Microsoft Store submission, complete the publisher/support paragraphs in privacy.html and terms.html and test the generated PWABuilder package on Windows with real camera and microphone devices. The source archive is not a signed Store package.

Do not release the separate native companion as a tested finished product yet. Its managed source and protocol tests pass, but full Windows publishing, C++ builds and physical-device behavior remain unverified. Enhanced PWA video/audio routing into Zoom or Teams remains unfinished and is excluded from the PWA listing's feature claims.

## Historical 3.0.1 review — completed corrections

The earlier shipping review corrected the defects below in 3.0.1. Those fixes are retained in 3.2.1; they do not establish that later background changes have passed a particular test. Review the current validation records separately.

| Severity | Area | Before | Correction |
|---|---|---|---|
| High | Photo imports | A rejected import could discard edits to the sample; other failures could change selection and clear masks/Undo. | Validate a candidate set before committing; rejected files leave existing work intact. |
| High | Backup choices | Delayed permission/picker results could enable backup after Off; queued snapshots could reappear after deletion. | Invalidate earlier operations and serialize deletion with the backup queue. |
| High | Native camera | Retained SoftwareBitmap buffers could stall the preview; late acquire/dispose/UI callbacks could throw on worker threads. | Dispose acquired bitmaps deterministically, ignore old readers and guard worker/UI shutdown boundaries. |
| Medium | AI loading | Failed initialization could permanently block retry; partial availability could leave the missing model inaccessible. | Make full and partial loads retryable; ignore callbacks from replaced workers and cancel their pending requests. |
| Medium | AI freshness | Stalled inference could apply an old live mask/crop; hidden-tab or failed first analysis could leave the still sample without effects. | Bound live-analysis age and reschedule discarded/unsuccessful still analysis. |
| Medium | Update restart | Microphone/test recording could continue while the camera stopped and the update activated. | Stop camera, microphone and temporary recording before activation. |
| Medium | Photo memory | Very tall images could create unusable oversized thumbnails; enlarged board output was omitted from import memory accounting. | Bound thumbnail dimensions and account for original/current working sizes consistently. |
| Medium | Backup retention | Random ID order could evict the newest backups when timestamps tied. | Allocate monotonic save order inside the IndexedDB write transaction. |
| Medium | Storage retry | Failed/blocked database opening could block future retries or leave a late connection open. | Clear rejected open state and close connections delivered after cancellation. |
| Medium | Audio callbacks | A late error from an old recorder could interrupt a newer recording. | Restrict callbacks to their own recording session. |
| Medium | Native reports | Numeric JSON could lose 64-bit KS flags when read by JavaScript. | Export exact decimal strings and verify high-bit values across the report boundary. |
| Medium | DirectShow diagnostics | Invalid/unreadable explicitly requested modes could silently use a default mode. | Reject the invalid request and guard malformed driver format buffers. |

Additional compatibility hardening keeps the PWA in standard standalone mode. A window-controls overlay was advertised without implementing a titlebar-safe layout; that declaration was removed. Camera status wording now clearly refers to its video-only stream while the independent microphone tool may be active.

## Verification scope

The regression checks exercise real browser image processing, model inference, QR decoding, exports, local storage and service workers, alongside synthetic camera/microphone streams and deterministic failure/race simulations. The deployment check uses a real /MeetingLens/ repository path with controlled offline updates and isolated caches. Layout checks cover 320, 768 and 1366-pixel widths.

Folder permission/write failure tests use simulated directory APIs. They do not replace a real Windows disk/permission test. Headless Chromium on Linux does not establish Windows driver compatibility, microphone quality, NPU performance, sustained webcam stability or Store certification.

Run all browser suites with `npm run test:release`. Native checks and Windows commands are documented in native-windows/README.md. The included Windows CI workflow is ready for use after upload, but its presence is not evidence that it has run successfully.
