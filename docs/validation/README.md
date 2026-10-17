# Release validation evidence

These JSON records accompany MeetingLens 3.2.0. The final serial command has **145 browser scenarios across fifteen browser suites**, plus **five Node worker-protocol checks**, for **150 behavioral checks**. The real bundled-vision module runs separately and is not counted again. Historical native source/protocol evidence contains a separate twelve checks. See ../../VALIDATION.md for the final command status, measured vision results, matching-frame/body-edge tests and hardware limitations.

Final record refresh status: **completed**. The records reflect the successful v3.2.0 serial command, the separate real-vision result and the sanitized supplied-camera check. The unchanged native evidence retains its historical scope.

Browser records use local fixtures and synthetic camera/microphone streams on Linux. production-camera-validation.json is a sanitized numerical report from a supplied camera still streamed through the actual production camera path with all six backgrounds. It records exact sampled foreground/background preservation and PNG agreement; it is not a physical Windows hardware or live-motion test. No supplied camera image, personal photo, recording, private path or intermediate render is included here.

The reports do not certify Windows hardware, sustained effect cadence, physical-GPU performance, full native packaging, C++ builds, NPU performance or meeting-app routing. Matching-frame processing adds delay and may reduce motion cadence on CPU. The interface distinguishes newly completed person-effect frames from ordinary preview refresh; refresh is not camera capture FPS.

The offline verification record summarizes completed command output. Other automated records come from their corresponding verification scripts; the supplied-camera report is a separately sanitized numerical summary. Transient browser profiles, test downloads, supplied images and screenshots are excluded from this folder.
