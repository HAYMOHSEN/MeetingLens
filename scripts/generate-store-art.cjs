/*
  Development-only visual asset generator.
  It produces Store-ready PNG artwork that matches the MeetingLens app design.
  Run after `npm install`:
    node scripts/generate-store-art.cjs
*/
const fs = require("node:fs");
const path = require("node:path");
const { createCanvas } = require("@napi-rs/canvas");

const root = path.resolve(__dirname, "..");
const screenshotsDir = path.join(root, "assets", "store-assets", "screenshots");
const posterDir = path.join(root, "assets", "store-assets", "posters");
const heroDir = path.join(root, "assets", "store-assets", "hero");
for (const dir of [screenshotsDir, posterDir, heroDir]) fs.mkdirSync(dir, { recursive: true });

function rounded(ctx, x, y, w, h, r, fill, stroke) {
  ctx.beginPath();
  ctx.moveTo(x + r, y);
  ctx.arcTo(x + w, y, x + w, y + h, r);
  ctx.arcTo(x + w, y + h, x, y + h, r);
  ctx.arcTo(x, y + h, x, y, r);
  ctx.arcTo(x, y, x + w, y, r);
  ctx.closePath();
  if (fill) { ctx.fillStyle = fill; ctx.fill(); }
  if (stroke) { ctx.strokeStyle = stroke; ctx.stroke(); }
}

function text(ctx, value, x, y, size, color, weight = 500, align = "left") {
  ctx.fillStyle = color;
  ctx.font = `${weight >= 700 ? "bold" : "normal"} ${size}px Arial`;
  ctx.textAlign = align;
  ctx.textBaseline = "alphabetic";
  ctx.fillText(value, x, y);
}

function line(ctx, x1, y1, x2, y2, color, width = 1) {
  ctx.beginPath(); ctx.moveTo(x1, y1); ctx.lineTo(x2, y2); ctx.strokeStyle = color; ctx.lineWidth = width; ctx.stroke();
}

function drawBrandMark(ctx, x, y, size) {
  const g = ctx.createLinearGradient(x, y, x + size, y + size);
  g.addColorStop(0, "#7de9e0"); g.addColorStop(.62, "#4d85ff"); g.addColorStop(1, "#b379ff");
  rounded(ctx, x, y, size, size, size * .3, g);
  ctx.strokeStyle = "rgba(255,255,255,.92)"; ctx.lineWidth = Math.max(2, size * .07);
  ctx.beginPath(); ctx.arc(x + size / 2, y + size / 2, size * .19, 0, Math.PI * 2); ctx.stroke();
  ctx.globalAlpha = .55; ctx.beginPath(); ctx.arc(x + size / 2, y + size / 2, size * .31, 0, Math.PI * 2); ctx.stroke(); ctx.globalAlpha = 1;
}

function drawDemoPreview(ctx, x, y, w, h, scene = "room") {
  ctx.save();
  rounded(ctx, x, y, w, h, 24, "#1d2938");
  ctx.clip();
  const palettes = {
    room: ["#7898ac", "#4d6177", "#17212d"],
    soft: ["#95a6b2", "#5e7280", "#253444"],
    studio: ["#396e90", "#193451", "#0c1627"],
    night: ["#34455d", "#1d2b3e", "#0b111b"]
  };
  const [top, mid, bottom] = palettes[scene];
  const bg = ctx.createLinearGradient(x, y, x, y + h);
  bg.addColorStop(0, top); bg.addColorStop(.56, mid); bg.addColorStop(.565, bottom); bg.addColorStop(1, "#111821");
  ctx.fillStyle = bg; ctx.fillRect(x, y, w, h);
  if (scene === "studio") {
    const aura = ctx.createRadialGradient(x + w * .66, y + h * .3, 16, x + w * .66, y + h * .3, w * .52);
    aura.addColorStop(0, "rgba(151,242,220,.62)"); aura.addColorStop(.35, "rgba(71,151,236,.29)"); aura.addColorStop(1, "rgba(5,13,30,0)");
    ctx.fillStyle = aura; ctx.fillRect(x, y, w, h);
    ctx.strokeStyle = "rgba(214,247,255,.28)"; ctx.lineWidth = 3;
    ctx.beginPath(); ctx.arc(x + w * .75, y + h * .42, w * .22, -1.25, 1.25); ctx.stroke();
  } else {
    ctx.fillStyle = "rgba(61,77,88,.78)"; ctx.fillRect(x + w * .69, y - h * .05, w * .28, h * .58);
    ctx.fillStyle = "rgba(226,246,250,.26)"; ctx.fillRect(x + w * .715, y, w * .095, h * .48); ctx.fillRect(x + w * .824, y, w * .095, h * .48);
    ctx.fillStyle = "rgba(40,56,70,.7)"; ctx.fillRect(x + w * .808, y, 9, h * .54); ctx.fillRect(x + w * .69, y + h * .25, w * .28, 9);
    ctx.fillStyle = "#463d3a"; ctx.fillRect(x + w * .055, y + h * .08, w * .19, h * .5);
    const colors = ["#dfae61", "#345e7a", "#cc6261", "#e8dbb8", "#416047"];
    for (let shelf = 0; shelf < 3; shelf++) {
      ctx.fillStyle = "#292829"; ctx.fillRect(x + w * .055, y + h * (.22 + shelf * .14), w * .19, 8);
      let bx = x + w * .073;
      for (let b = 0; b < 5; b++) { ctx.fillStyle = colors[(b + shelf) % colors.length]; ctx.fillRect(bx, y + h * (.105 + shelf * .14), 15 + (b % 2) * 8, h * .103); bx += 22 + (b % 2) * 8; }
    }
    ctx.fillStyle = "#1c262e"; ctx.fillRect(x + w * .47, y + h * .45, w * .17, h * .16);
    ctx.fillStyle = "#2a6379"; ctx.fillRect(x + w * .485, y + h * .465, w * .14, h * .12);
  }
  ctx.fillStyle = "rgba(65,45,38,.62)"; ctx.beginPath(); ctx.moveTo(x - 30, y + h * .79); ctx.lineTo(x + w + 30, y + h * .69); ctx.lineTo(x + w + 30, y + h + 30); ctx.lineTo(x - 30, y + h + 30); ctx.closePath(); ctx.fill();
  const cx = x + w * .52;
  ctx.fillStyle = "#2a4164"; ctx.beginPath(); ctx.ellipse(cx, y + h * .9, w * .21, h * .33, 0, Math.PI, 0); ctx.fill();
  ctx.fillStyle = "#1b304d"; ctx.beginPath(); ctx.moveTo(cx - w * .21, y + h); ctx.lineTo(cx - w * .1, y + h * .7); ctx.lineTo(cx + w * .1, y + h * .7); ctx.lineTo(cx + w * .21, y + h); ctx.closePath(); ctx.fill();
  ctx.fillStyle = "#e6eff4"; ctx.beginPath(); ctx.moveTo(cx - 23, y + h * .69); ctx.lineTo(cx + 23, y + h * .69); ctx.lineTo(cx, y + h * .82); ctx.closePath(); ctx.fill();
  rounded(ctx, cx - 27, y + h * .54, 54, 70, 16, "#bd765f");
  ctx.fillStyle = "#dfa184"; ctx.beginPath(); ctx.ellipse(cx - 7, y + h * .49, w * .058, h * .13, .05, 0, Math.PI * 2); ctx.fill();
  ctx.fillStyle = "#282a33"; ctx.beginPath(); ctx.ellipse(cx - 13, y + h * .4, w * .065, h * .06, -.1, Math.PI, 0); ctx.fill();
  ctx.strokeStyle = "#29313a"; ctx.lineWidth = Math.max(3, w * .006); ctx.beginPath(); ctx.roundRect(cx - w * .04, y + h * .482, w * .032, h * .04, 6); ctx.roundRect(cx + w * .01, y + h * .482, w * .032, h * .04, 6); ctx.stroke(); line(ctx, cx - w * .008, y + h * .5, cx + w * .01, y + h * .5, "#29313a", 3);
  const sheen = ctx.createLinearGradient(x, y, x + w, y + h); sheen.addColorStop(0, "rgba(255,255,255,.06)"); sheen.addColorStop(1, "rgba(0,0,0,.23)"); ctx.fillStyle = sheen; ctx.fillRect(x, y, w, h);
  ctx.restore();
}

function drawHeader(ctx, w) {
  ctx.fillStyle = "rgba(9,14,23,.95)"; ctx.fillRect(0, 0, w, 82);
  line(ctx, 0, 82, w, 82, "rgba(205,225,251,.12)");
  drawBrandMark(ctx, 30, 23, 37);
  text(ctx, "MeetingLens", 78, 51, 21, "#edf5ff", 750);
  rounded(ctx, 207, 33, 116, 23, 5, "#172338", "rgba(166,194,230,.16)"); text(ctx, "CAMERA STUDIO", 265, 49, 8, "#a7b9d3", 700, "center");
  ctx.fillStyle = "#ffc063"; ctx.beginPath(); ctx.arc(435, 43, 4, 0, Math.PI * 2); ctx.fill(); text(ctx, "Demo preview · no camera access", 448, 48, 12, "#a5b8d0", 500);
  rounded(ctx, w - 230, 21, 200, 43, 11, "#6ce7d7"); text(ctx, "Start camera preview", w - 130, 48, 12, "#05231f", 800, "center");
}

function drawNav(ctx, h) {
  ctx.fillStyle = "rgba(9,14,23,.75)"; ctx.fillRect(0, 82, 90, h - 82);
  line(ctx, 90, 82, 90, h, "rgba(205,225,251,.12)");
  const rows = [["◉", "Studio"], ["✦", "Looks"], ["◌", "Background"], ["⌖", "Frame"], ["◈", "Privacy"]];
  rows.forEach(([symbol, label], index) => {
    const y = 106 + index * 70;
    if (index === 0) rounded(ctx, 12, y, 66, 57, 13, "rgba(85,202,193,.16)", "rgba(117,239,220,.15)");
    text(ctx, symbol, 45, y + 25, 18, index === 0 ? "#edf5ff" : "#8195b0", 500, "center");
    text(ctx, label, 45, y + 45, 10, index === 0 ? "#edf5ff" : "#8195b0", 700, "center");
  });
}

function drawSummaryCard(ctx, x, y, w, label, sub, icon, color) {
  rounded(ctx, x, y, w, 76, 14, "#151f30", "rgba(205,225,251,.12)");
  rounded(ctx, x + 13, y + 23, 30, 30, 9, `${color}22`); text(ctx, icon, x + 28, y + 45, 16, color, 700, "center");
  text(ctx, label, x + 52, y + 34, 11, "#dceafa", 700);
  text(ctx, sub, x + 52, y + 51, 9, "#92a7c0", 500);
  text(ctx, label === "Privacy" ? "Local" : "Ready", x + w - 13, y + 44, 9, label === "Privacy" ? "#c0b5ff" : "#62e4a4", 800, "right");
}

function drawInspectorHeader(ctx, x, w, title, eyebrow) {
  rounded(ctx, x, 105, w, 900, 20, "#111a29", "rgba(205,225,251,.12)");
  text(ctx, eyebrow.toUpperCase(), x + 21, 137, 9, "#65e4ce", 800);
  text(ctx, title, x + 21, 166, 19, "#edf5ff", 700);
  line(ctx, x, 187, x + w, 187, "rgba(205,225,251,.12)");
}

function drawStudioPanel(ctx, x, w) {
  drawInspectorHeader(ctx, x, w, "Meeting readiness", "Home profile");
  rounded(ctx, x + 18, 208, w - 36, 150, 15, "#213d4c", "rgba(101,228,206,.24)");
  rounded(ctx, x + 32, 223, 34, 34, 10, "#65e4ce"); text(ctx, "✓", x + 49, 248, 17, "#062522", 800, "center");
  text(ctx, "Your preview is almost ready", x + 77, 237, 13, "#edf5ff", 700); text(ctx, "Apply a modest camera correction for a", x + 77, 254, 10, "#a7bad0", 500); text(ctx, "balanced, natural result.", x + 77, 268, 10, "#a7bad0", 500);
  rounded(ctx, x + 32, 305, w - 64, 35, 9, "rgba(101,228,206,.13)", "rgba(101,228,206,.28)"); text(ctx, "Fix naturally", x + w / 2, 328, 11, "#d4fff6", 800, "center");
  const states = [["Camera setup", "Ready", "#62e4a4"], ["Light balance", "Adjust", "#ffc063"], ["Face integrity", "Natural", "#62e4a4"], ["Privacy status", "Local", "#62e4a4"]];
  states.forEach((s, i) => { const y = 386 + i * 28; text(ctx, s[0], x + 20, y, 11, "#d8e4f2", 500); text(ctx, s[1], x + w - 21, y, 10, s[2], 700, "right"); });
  text(ctx, "QUICK PROFILE", x + 20, 516, 10, "#d8e6f5", 800);
  const cards = [["✦", "Natural", "Balanced & faithful"], ["☼", "Low light", "Lift dark rooms"], ["▤", "Teaching", "Wider guide"], ["▣", "Presentation", "Clean color"]];
  cards.forEach((card, index) => {
    const cx = x + 20 + (index % 2) * ((w - 49) / 2); const cy = 532 + Math.floor(index / 2) * 98; const cw = (w - 57) / 2;
    rounded(ctx, cx, cy, cw, 87, 12, index === 0 ? "#244759" : "#172338", index === 0 ? "rgba(101,228,206,.58)" : null);
    rounded(ctx, cx + 11, cy + 10, 25, 25, 8, "rgba(101,228,206,.11)"); text(ctx, card[0], cx + 23.5, cy + 29, 13, "#65e4ce", 700, "center"); text(ctx, card[1], cx + 11, cy + 53, 11, "#e6f0fb", 700); text(ctx, card[2], cx + 11, cy + 69, 9, "#95a8c0", 500);
  });
}

function drawLooksPanel(ctx, x, w) {
  drawInspectorHeader(ctx, x, w, "Natural enhancement", "Camera adjustments");
  rounded(ctx, x + 18, 208, w - 36, 64, 11, "#183151", "rgba(105,169,255,.15)"); text(ctx, "i", x + 34, 233, 11, "#91c7ff", 800, "center"); text(ctx, "Natural by default. Changes stay", x + 48, 232, 10, "#b7cbe0", 600); text(ctx, "inside the local camera preview.", x + 48, 247, 10, "#b7cbe0", 600);
  text(ctx, "CAMERA LOOK", x + 20, 305, 10, "#d8e6f5", 800);
  const items = [["Natural", "#86b3d0"], ["Clear", "#6f9ec7"], ["Warm", "#cf937a"], ["Studio", "#5da3d9"], ["Mono", "#a7a7b0"], ["Brand", "#8a77d5"]];
  items.forEach((item, index) => { const cx = x + 20 + (index % 2) * ((w - 49) / 2); const cy = 320 + Math.floor(index / 2) * 88; const cw = (w - 57) / 2; rounded(ctx, cx, cy, cw, 76, 11, index === 0 ? "#244759" : "#172338", index === 0 ? "rgba(101,228,206,.58)" : null); rounded(ctx, cx + 8, cy + 8, cw - 16, 31, 8, item[1]); text(ctx, item[0], cx + 9, cy + 60, 11, "#e6f0fb", 700); });
  const sliders = [["Light lift", "56%"], ["Clarity", "54%"], ["Color balance", "53%"]];
  sliders.forEach((row, index) => { const y = 603 + index * 72; text(ctx, row[0], x + 20, y, 11, "#dce9f6", 700); text(ctx, row[1], x + w - 20, y, 10, "#65e4ce", 700, "right"); line(ctx, x + 20, y + 22, x + w - 20, y + 22, "#3a6e7f", 4); ctx.fillStyle = "#65e4ce"; ctx.beginPath(); ctx.arc(x + w * .56, y + 22, 7, 0, Math.PI * 2); ctx.fill(); });
}

function drawBackgroundPanel(ctx, x, w) {
  drawInspectorHeader(ctx, x, w, "Background preview", "Scene tools");
  rounded(ctx, x + 18, 208, w - 36, 76, 11, "#342817", "rgba(255,192,99,.2)"); text(ctx, "i", x + 34, 234, 11, "#ffc063", 800, "center"); text(ctx, "Scenes are visual previews in this", x + 48, 232, 10, "#d8c6aa", 600); text(ctx, "browser-only release.", x + 48, 247, 10, "#d8c6aa", 600);
  text(ctx, "PREVIEW SCENE", x + 20, 320, 10, "#d8e6f5", 800);
  const rows = [["Keep my room", "Natural home office", "#5e788f", true], ["Soft focus", "Calm visual preview", "#829aa1", false], ["Studio blue", "Professional demo scene", "#315f91", false], ["Dark neutral", "Low-distraction preview", "#27384e", false]];
  rows.forEach((row, index) => { const y = 336 + index * 76; rounded(ctx, x + 18, y, w - 36, 65, 12, row[3] ? "#244759" : "#172338", row[3] ? "rgba(101,228,206,.58)" : null); rounded(ctx, x + 27, y + 9, 53, 47, 8, row[2]); text(ctx, row[0], x + 92, y + 29, 11, "#e6f0fb", 700); text(ctx, row[1], x + 92, y + 45, 9, "#95a8c0", 500); if (row[3]) text(ctx, "On", x + w - 26, y + 38, 10, "#65e4ce", 800, "right"); });
  text(ctx, "SCENE STRENGTH", x + 20, 680, 10, "#d8e6f5", 800); line(ctx, x + 20, 708, x + w - 20, 708, "#3a6e7f", 4); ctx.fillStyle = "#65e4ce"; ctx.beginPath(); ctx.arc(x + w * .45, 708, 7, 0, Math.PI * 2); ctx.fill();
}

function drawPrivacyPanel(ctx, x, w) {
  drawInspectorHeader(ctx, x, w, "Privacy & trust", "Your camera, your control");
  rounded(ctx, x + 18, 208, w - 36, 152, 14, "#1d3654", "rgba(114,165,255,.25)"); rounded(ctx, x + 32, 222, 34, 34, 10, "rgba(102,172,255,.15)"); text(ctx, "◈", x + 49, 247, 18, "#c0e7ff", 700, "center"); text(ctx, "Privacy Shield", x + 77, 238, 13, "#edf5ff", 700); text(ctx, "Instantly pauses the camera preview", x + 77, 255, 10, "#a9bfd5", 500); text(ctx, "and hides the frame in MeetingLens.", x + 77, 269, 10, "#a9bfd5", 500); rounded(ctx, x + 32, 305, w - 64, 36, 9, "rgba(95,167,255,.14)", "rgba(102,172,255,.28)"); text(ctx, "Activate shield", x + w / 2, 328, 11, "#d1eaff", 800, "center");
  const states = [["Camera data", "Not uploaded"], ["Saved settings", "Local browser storage"], ["Snapshots", "You choose when to download"]]; states.forEach((state, index) => { const y = 410 + index * 40; text(ctx, state[0], x + 20, y, 11, "#b7c7da", 500); text(ctx, state[1], x + w - 20, y, 10, "#62e4a4", 700, "right"); });
  line(ctx, x + 20, 548, x + w - 20, 548, "rgba(210,230,255,.08)"); text(ctx, "Read the full privacy policy", x + 20, 582, 11, "#a7dffc", 700); text(ctx, "→", x + w - 20, 582, 14, "#a7dffc", 700, "right");
}

function drawScreenshot(panel, file) {
  const w = 1920, h = 1080;
  const canvas = createCanvas(w, h); const ctx = canvas.getContext("2d");
  const background = ctx.createRadialGradient(w * .75, -80, 50, w * .75, -80, w * .55); background.addColorStop(0, "#253f76"); background.addColorStop(1, "#080d16"); ctx.fillStyle = background; ctx.fillRect(0, 0, w, h);
  drawHeader(ctx, w); drawNav(ctx, h);
  text(ctx, panel === "studio" ? "Meeting preparation" : panel === "looks" ? "Camera appearance" : panel === "background" ? "Background preview" : "Privacy controls", 124, 128, 10, "#65e4ce", 800);
  const mainTitle = { studio: "Look clear and natural before you join.", looks: "Refine the preview without changing yourself.", background: "Prepare a calmer visual setting.", privacy: "Keep camera control in your hands." }[panel];
  text(ctx, mainTitle, 124, 164, 30, "#edf5ff", 750);
  rounded(ctx, 780, 113, 202, 33, 10, "#192739", "rgba(205,225,251,.12)"); text(ctx, "Local browser processing", 881, 135, 11, "#acc0d7", 600, "center");
  drawDemoPreview(ctx, 124, 196, 1110, 624, panel === "background" ? "studio" : panel === "privacy" ? "night" : "room");
  rounded(ctx, 142, 213, 120, 27, 8, "rgba(9,13,21,.58)", "rgba(227,239,255,.15)"); ctx.fillStyle = "#ffc063"; ctx.beginPath(); ctx.arc(157, 226, 4, 0, Math.PI * 2); ctx.fill(); text(ctx, "DEMO PREVIEW", 208, 230, 10, "#d9e7f5", 700, "center");
  rounded(ctx, 1017, 213, 198, 27, 8, "rgba(9,13,21,.58)", "rgba(227,239,255,.15)"); ctx.fillStyle = "#62e4a4"; ctx.beginPath(); ctx.arc(1033, 226, 4, 0, Math.PI * 2); ctx.fill(); text(ctx, "Balanced for a meeting", 1122, 230, 10, "#ccefe7", 700, "center");
  ctx.strokeStyle = "rgba(114,239,217,.38)"; ctx.lineWidth = 1; rounded(ctx, 451, 293, 447, 446, 19, null, "rgba(114,239,217,.38)");
  rounded(ctx, 142, 774, 230, 28, 8, "rgba(9,13,21,.58)", "rgba(227,239,255,.15)"); text(ctx, panel === "looks" ? "Clear look · light lift" : "Natural color · light lift", 257, 793, 10, "#dcfff5", 700, "center");
  rounded(ctx, 1070, 774, 145, 28, 8, "rgba(9,13,21,.58)", "rgba(227,239,255,.15)"); text(ctx, "1280 × 720 preview", 1142, 793, 10, "#b7c9df", 700, "center");
  const labels = [["☼", "Light & color", "Natural lift enabled", "#65e4ce"], ["⌖", "Composition", "Centered guide shown", "#6ca7ff"], ["◈", "Privacy", "Camera stays on this device", "#c0b5ff"]]; labels.forEach((item, index) => drawSummaryCard(ctx, 124 + index * 370, 850, 350, item[1], item[2], item[0], item[3]));
  const x = 1270, width = 620;
  if (panel === "studio") drawStudioPanel(ctx, x, width); else if (panel === "looks") drawLooksPanel(ctx, x, width); else if (panel === "background") drawBackgroundPanel(ctx, x, width); else drawPrivacyPanel(ctx, x, width);
  fs.writeFileSync(file, canvas.toBuffer("image/png"));
}

function drawPoster() {
  const w = 1440, h = 2160; const canvas = createCanvas(w, h); const ctx = canvas.getContext("2d");
  const bg = ctx.createLinearGradient(0, 0, w, h); bg.addColorStop(0, "#08152b"); bg.addColorStop(.5, "#162f56"); bg.addColorStop(1, "#0a1020"); ctx.fillStyle = bg; ctx.fillRect(0, 0, w, h);
  const aqua = ctx.createRadialGradient(w * .15, h * .12, 10, w * .15, h * .12, w * .65); aqua.addColorStop(0, "rgba(98,238,215,.55)"); aqua.addColorStop(1, "rgba(98,238,215,0)"); ctx.fillStyle = aqua; ctx.fillRect(0, 0, w, h);
  drawBrandMark(ctx, 104, 112, 88); text(ctx, "MeetingLens", 211, 171, 48, "#f0f7ff", 750); text(ctx, "CAMERA PREVIEW STUDIO", 211, 198, 14, "#98b8d7", 800);
  text(ctx, "Prepare your", 100, 370, 84, "#edf5ff", 750); text(ctx, "camera with", 100, 470, 84, "#edf5ff", 750); text(ctx, "clarity.", 100, 570, 84, "#71ebd6", 750);
  text(ctx, "Natural light · visual framing · local privacy", 103, 628, 22, "#b7c7da", 500);
  drawDemoPreview(ctx, 100, 760, 1240, 698, "studio");
  rounded(ctx, 129, 790, 166, 35, 9, "rgba(8,14,24,.62)"); text(ctx, "DEMO PREVIEW", 212, 813, 11, "#d9e7f5", 800, "center");
  const features = [["✦", "Natural camera looks"], ["⌖", "Meeting-ready framing"], ["◈", "Privacy in your control"]];
  features.forEach((feature, index) => { const y = 1580 + index * 116; rounded(ctx, 100, y, 1240, 90, 16, "rgba(22,35,56,.74)", "rgba(205,225,251,.13)"); rounded(ctx, 122, y + 21, 48, 48, 14, "rgba(101,228,206,.13)"); text(ctx, feature[0], 146, y + 54, 21, "#65e4ce", 700, "center"); text(ctx, feature[1], 192, y + 55, 27, "#e9f2fc", 700); });
  fs.writeFileSync(path.join(posterDir, "meetinglens-poster-1440x2160.png"), canvas.toBuffer("image/png"));
}

function drawHero() {
  const w = 3840, h = 2160; const canvas = createCanvas(w, h); const ctx = canvas.getContext("2d");
  const bg = ctx.createLinearGradient(0, 0, w, h); bg.addColorStop(0, "#071326"); bg.addColorStop(.53, "#12355a"); bg.addColorStop(1, "#090f1b"); ctx.fillStyle = bg; ctx.fillRect(0, 0, w, h);
  const glow = ctx.createRadialGradient(w * .62, h * .41, 20, w * .62, h * .41, 1370); glow.addColorStop(0, "rgba(126,241,221,.65)"); glow.addColorStop(.35, "rgba(75,147,255,.3)"); glow.addColorStop(1, "rgba(7,17,33,0)"); ctx.fillStyle = glow; ctx.fillRect(0, 0, w, h);
  ctx.strokeStyle = "rgba(198,246,255,.22)"; ctx.lineWidth = 9; ctx.beginPath(); ctx.arc(w * .63, h * .46, 800, -.88, 1.95); ctx.stroke(); ctx.beginPath(); ctx.arc(w * .61, h * .46, 590, -.88, 1.95); ctx.stroke();
  for (let i = 0; i < 22; i++) { ctx.fillStyle = `rgba(116,230,214,${.05 + i * .006})`; ctx.beginPath(); ctx.arc(w * (.1 + i * .04), h * (.19 + (i % 6) * .08), 8 + (i % 4) * 5, 0, Math.PI * 2); ctx.fill(); }
  ctx.fillStyle = "rgba(19,34,55,.72)"; ctx.beginPath(); ctx.ellipse(w * .47, h * 1.1, 860, 850, 0, Math.PI, 0); ctx.fill();
  ctx.fillStyle = "#193456"; ctx.beginPath(); ctx.moveTo(w * .23, h); ctx.lineTo(w * .39, h * .6); ctx.lineTo(w * .57, h * .6); ctx.lineTo(w * .72, h); ctx.closePath(); ctx.fill();
  ctx.fillStyle = "#dca084"; ctx.beginPath(); ctx.ellipse(w * .48, h * .42, 360, 480, .04, 0, Math.PI * 2); ctx.fill();
  ctx.fillStyle = "#20222d"; ctx.beginPath(); ctx.ellipse(w * .43, h * .22, 385, 220, -.08, Math.PI, 0); ctx.fill();
  ctx.strokeStyle = "#26313f"; ctx.lineWidth = 38; ctx.beginPath(); ctx.roundRect(w * .28, h * .39, 190, 130, 40); ctx.roundRect(w * .49, h * .39, 190, 130, 40); ctx.stroke(); line(ctx, w * .465, h * .455, w * .49, h * .455, "#26313f", 25);
  const edge = ctx.createRadialGradient(w * .48, h * .44, 100, w * .48, h * .44, 1000); edge.addColorStop(.7, "rgba(0,0,0,0)"); edge.addColorStop(1, "rgba(0,0,0,.48)"); ctx.fillStyle = edge; ctx.fillRect(0, 0, w, h);
  fs.writeFileSync(path.join(heroDir, "meetinglens-hero-3840x2160.png"), canvas.toBuffer("image/png"));
}

drawScreenshot("studio", path.join(screenshotsDir, "01-studio-1920x1080.png"));
drawScreenshot("looks", path.join(screenshotsDir, "02-looks-1920x1080.png"));
drawScreenshot("background", path.join(screenshotsDir, "03-background-1920x1080.png"));
drawScreenshot("privacy", path.join(screenshotsDir, "04-privacy-1920x1080.png"));
drawPoster();
drawHero();
console.log("MeetingLens Store visuals created.");
