// The monitor's wallpaper: a photograph (public/wallpaper.webp). The scene
// uses it as the screen's texture (rack.ts), and the desktop uses it as its
// own background when it fills the stage (Rack.astro).
import { DESK_W, DESK_H } from "../data/desktop.ts";

let image: Promise<HTMLImageElement | null> | null = null;
/** The photo, fetched once. Null if it cannot be loaded. */
function wallpaperImage() {
  image ??= new Promise((done) => {
    const img = new Image();
    img.decoding = "async";
    img.onload = () => done(img);
    img.onerror = () => done(null);
    img.src = "/wallpaper.webp";
  });
  return image;
}

/**
 * Size a canvas to the desktop (times `scale`) and paint the wallpaper on it.
 * It gets a plain dawn sky at once and the photo when that arrives; `then`
 * runs after the photo is on the canvas.
 */
export function paintWallpaper(canvas: HTMLCanvasElement, scale = 1, then?: () => void) {
  const W = (canvas.width = DESK_W * scale);
  const H = (canvas.height = DESK_H * scale);
  const g = canvas.getContext("2d");
  if (!g) return;
  const sky = g.createLinearGradient(0, 0, 0, H);
  sky.addColorStop(0, "#1f6fc4");
  sky.addColorStop(0.55, "#7fb4d6");
  sky.addColorStop(1, "#6f8f7c");
  g.fillStyle = sky;
  g.fillRect(0, 0, W, H);
  void wallpaperImage().then((img) => {
    if (!img) return;
    // cover the canvas, keeping the photo's proportions
    const k = Math.max(W / img.naturalWidth, H / img.naturalHeight);
    const w = img.naturalWidth * k;
    const h = img.naturalHeight * k;
    g.drawImage(img, (W - w) / 2, (H - h) / 2, w, h);
    then?.();
  });
}
