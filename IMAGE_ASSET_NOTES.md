# MeetingLens demo portrait

The camera preview uses an AI-generated fictional professional as a sample subject. It does not depict the app owner or a live camera feed. Keep a visible `AI demo` or `Demo portrait` label wherever the sample is displayed.

## Files

- `assets/demo/professional-portrait.png` — original 1536 × 1024 PNG with alpha transparency.
- `assets/demo/professional-portrait.webp` — web-optimized 1536 × 1024 WebP with alpha transparency, derived only by format conversion from the original.

The PNG is the selected first result from the built-in image generation tool. The portrait was visually inspected for natural appearance, professional clothing, friendly direct eye contact, balanced lighting, complete shoulders, and framing. The alpha channel was checked programmatically. The hidden RGB data outside the person contains some background-like colors; those pixels are transparent and should be rendered with normal alpha compositing.

## Final generation prompt

Use case: photorealistic-natural

Asset type: transparent demo subject for a premium desktop camera preview studio. A fictional sample person, no real-person likeness.

Primary request: create a polished, highly realistic corporate webcam portrait cutout on a genuinely transparent background.

Subject: one adult professional man in his early 30s, neatly groomed short dark hair, subtle close-cropped beard, navy business casual jacket over a light neutral crew-neck shirt, warm professional expression with a small natural smile and direct eye contact. Realistic skin texture, natural facial proportions, no excessive beauty retouching.

Composition/framing: landscape 1536x1024 canvas, subject precisely centered, eye-level webcam perspective, upper torso from entire head to waist/just below chest. Both shoulders completely visible with generous transparent margin at either side and above the head. Upright relaxed posture. Arms and hands not visible. Subject fills roughly 65 percent of frame height, bottom edge can crop lower torso. Face large enough to read in a desktop camera preview.

Lighting/mood: soft balanced daylight, clean neutral color rendition, realistic premium corporate portrait photography, gently defined face without harsh shadows.

Scene/backdrop: fully transparent alpha background with clean hair and jacket edges suitable for compositing over different backgrounds; no ground plane or cast shadow.

Constraints: no text, no logos, no props, no border, no frame, no watermark, no hands, no duplicated body parts, no illustrated or cartoon appearance.

Generation used the built-in image tool with `transparent_background: true`. No content editing was applied to the selected image.
