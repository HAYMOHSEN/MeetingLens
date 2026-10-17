# Release validation evidence

These JSON records accompany MeetingLens 3.2.1. The serial command has **147 browser scenarios across fifteen browser suites**, plus **eight Node worker-protocol checks**, for **155 behavioral checks**. The real bundled-vision module runs separately. Historical native source/protocol evidence contains a separate twelve checks. See ../../VALIDATION.md for command status, vision results, slow-completion and runtime-fallback coverage, and hardware limitations.

Final record refresh status: **completed after the successful v3.2.1 serial run**.

Browser records use local fixtures and synthetic camera/microphone streams on Linux. production-camera-validation.json retains the v3.2.0 sanitized supplied-camera check with all six backgrounds; the model/calibration are unchanged. It was not rerun for v3.2.1 and is not physical Windows hardware or live-motion evidence. No supplied camera image, personal photo, recording, private path or intermediate render is included here.

The reports do not certify Windows hardware, sustained effect cadence, physical-GPU performance, full native packaging, C++ builds, NPU performance or meeting-app routing. Matching-frame processing adds delay and may reduce motion cadence on CPU. The interface distinguishes newly completed person-effect frames from ordinary preview refresh; refresh is not camera capture FPS.

The offline verification record summarizes completed command output. Other automated records come from their corresponding verification scripts; the supplied-camera report is a separately sanitized numerical summary. Transient browser profiles, test downloads, supplied images and screenshots are excluded from this folder.
