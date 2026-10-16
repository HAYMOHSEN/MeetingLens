/* Regenerate branding and promotional art. Screenshots are captured separately
   from the working app with npm run capture:store-assets, never redrawn here. */
const fs = require("node:fs");
const path = require("node:path");
const { createCanvas, loadImage, GlobalFonts } = require("@napi-rs/canvas");
const root = path.resolve(__dirname, "..");
const assets = path.join(root, "assets");
let fontFamily = "sans-serif";
for (const font of ["/usr/share/fonts/truetype/dejavu/DejaVuSans.ttf", "/usr/share/fonts/truetype/dejavu/DejaVuSans-Bold.ttf"]) {
  if (fs.existsSync(font)) { GlobalFonts.registerFromPath(font, "MeetingLens Sans"); fontFamily = '"MeetingLens Sans"'; }
}

function box(ctx, x, y, w, h, r, fill) {
  ctx.beginPath(); ctx.roundRect(x, y, w, h, r); ctx.fillStyle = fill; ctx.fill();
}
function label(ctx, text, x, y, size, color, weight = 500) {
  ctx.font = `${weight} ${size}px ${fontFamily}`; ctx.fillStyle = color; ctx.fillText(text, x, y);
}
function write(canvas, file) {
  fs.mkdirSync(path.dirname(file), { recursive: true }); fs.writeFileSync(file, canvas.toBuffer("image/png"));
}
async function main() {
  const logo = await loadImage(path.join(assets, "icons/meetinglens-icon.svg"));
  for (const [file, size, maskable] of [["meetinglens-192.png",192,false],["meetinglens-512.png",512,false],["meetinglens-maskable-512.png",512,true],["favicon.png",64,false]]) {
    const c=createCanvas(size,size), g=c.getContext("2d");
    if(maskable) {g.fillStyle="#6962e8";g.fillRect(0,0,size,size);g.drawImage(logo,size*.15,size*.15,size*.7,size*.7);}
    else g.drawImage(logo,0,0,size,size);
    write(c,path.join(assets,"icons",file));
  }
  const store=createCanvas(300,300);store.getContext("2d").drawImage(logo,0,0,300,300);write(store,path.join(assets,"store-assets/store-icon-300.png"));
  const portrait = await loadImage(path.join(assets,"demo/professional-portrait.webp"));
  const poster = createCanvas(1440,2160), p = poster.getContext("2d");
  p.fillStyle="#f3f4fa";p.fillRect(0,0,1440,2160);
  p.drawImage(logo,100,104,110,110);label(p,"MeetingLens",240,180,62,"#222439",700);
  label(p,"Your best light.",100,380,112,"#222439",700);
  label(p,"Every meeting.",100,505,112,"#6962e8",700);
  label(p,"A calmer camera setup starts here.",105,595,38,"#62677f");
  const screenshot=await loadImage(path.join(assets,"store-assets/screenshots/01-studio-1920x1080.png"));
  p.save();box(p,70,720,1300,731,28,"#fff");p.clip();p.drawImage(screenshot,70,720,1300,731);p.restore();
  const items=[["NATURAL LOOKS","Fine-tune light and color."],["YOUR PRESETS","Save a setup for every occasion."],["PRIVACY FIRST","Keep camera processing on your device."]];
  items.forEach(([title,body],i)=>{const y=1570+i*148;box(p,100,y-33,10,64,5,"#8179ed");label(p,title,140,y,28,"#6962e8",700);label(p,body,140,y+48,36,"#33364c");});
  label(p,"Local camera preview for Windows",100,2090,27,"#656a80");
  write(poster,path.join(assets,"store-assets/posters/meetinglens-poster-1440x2160.png"));
  // Super hero: photographic portrait with branded color, without marketing text.
  const hero=createCanvas(3840,2160), h=hero.getContext("2d");
  const bg=h.createLinearGradient(0,0,3840,2160);bg.addColorStop(0,"#15182c");bg.addColorStop(.55,"#4c4e86");bg.addColorStop(1,"#b6b5df");h.fillStyle=bg;h.fillRect(0,0,3840,2160);
  const glow=h.createRadialGradient(2000,850,20,2000,850,1900);glow.addColorStop(0,"#a7a7e466");glow.addColorStop(1,"#a7a7e400");h.fillStyle=glow;h.fillRect(0,0,3840,2160);
  h.strokeStyle="#ffffff1b";h.lineWidth=4;[700,1040,1450].forEach(r=>{h.beginPath();h.arc(2070,1100,r,0,Math.PI*2);h.stroke()});
  const ph=2200,pw=ph*portrait.width/portrait.height;h.drawImage(portrait,(3840-pw)/2,2160-ph,pw,ph);
  write(hero,path.join(assets,"store-assets/hero/meetinglens-hero-3840x2160.png"));
  console.log("Refreshed app icons, Store logo, poster, and hero. App screenshots were left untouched.");
}
main().catch(error=>{console.error(error);process.exitCode=1});
