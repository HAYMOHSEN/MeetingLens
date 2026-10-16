# MeetingLens 3.0.1 shipping review

Reviewed on 16 October 2026. This review covers the supplied source and local browser tests. A deployed public URL or signed Windows package was not supplied for installed-package testing.

## Verdict

The review found real defects and corrected them in 3.0.1. Use this corrected package instead of 3.0.0. The final automated results are recorded in VALIDATION.md and docs/validation/.

Before Microsoft Store submission, complete the publisher/support paragraphs in privacy.html and terms.html and test the generated PWABuilder package on Windows with real camera and microphone devices. The source archive is not a signed Store package.

Do not release the separate native companion as a tested finished product yet. Its managed source and protocol tests pass, but full Windows publishing, C++ builds and physical-device behavior remain unverified. Enhanced PWA video/audio routing into Zoom or Teams remains unfinished and is excluded from the PWA listing's feature claims.

## Confirmed defects corrected

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
