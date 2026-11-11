// The monitor's wallpaper: the Annapurna range at sunrise over misty
// foothills, drawn with plain canvas calls so there is no image to download.
// The scene uses it as the screen's texture (rack.ts), and the desktop uses
// it as its own background when it fills the stage (Rack.astro).
import { DESK_W, DESK_H } from "../data/desktop.ts";

export function paintWallpaper(canvas: HTMLCanvasElement) {
  const W = (canvas.width = DESK_W);
  const H = (canvas.height = DESK_H);
  const g = canvas.getContext("2d");
  if (!g) return;
  const sky = g.createLinearGradient(0, 0, 0, H);
  sky.addColorStop(0, "#1c62cf");
  sky.addColorStop(0.45, "#4f9cec");
  sky.addColorStop(0.75, "#a9d2f3");
  sky.addColorStop(1, "#d7ecf4");
  g.fillStyle = sky;
  g.fillRect(0, 0, W, H);
  // clouds
  const cloud = (x: number, y: number, w: number, h: number, a: number) => {
    const r = g.createRadialGradient(x, y, 0, x, y, w);
    r.addColorStop(0, `rgba(255,255,255,${a})`);
    r.addColorStop(1, "rgba(255,255,255,0)");
    g.save();
    g.translate(x, y);
    g.scale(1, h / w);
    g.translate(-x, -y);
    g.fillStyle = r;
    g.fillRect(x - w, y - w, w * 2, w * 2);
    g.restore();
  };
  for (const [x, y, w, h, a] of [
    [90, 60, 130, 26, 0.9], [200, 150, 190, 24, 0.75], [330, 205, 150, 20, 0.6], [640, 150, 150, 18, 0.8],
    [760, 175, 120, 16, 0.7], [430, 120, 60, 12, 0.7], [820, 250, 110, 12, 0.5], [520, 240, 160, 14, 0.45],
  ] as const)
    cloud(x, y, w, h, a);
  // Annapurna South on the left, Machapuchare's fishtail to the right.
  const ridge = (pts: number[][], top: string, bottom: string, base: number) => {
    const gr = g.createLinearGradient(0, Math.min(...pts.map((p) => p[1])), 0, base);
    gr.addColorStop(0, top);
    gr.addColorStop(1, bottom);
    g.fillStyle = gr;
    g.beginPath();
    g.moveTo(pts[0][0], base);
    for (const [x, y] of pts) g.lineTo(x, y);
    g.lineTo(pts[pts.length - 1][0], base);
    g.closePath();
    g.fill();
  };
  ridge([[0, 335], [50, 292], [95, 236], [130, 188], [150, 210], [176, 246], [214, 286], [250, 268], [282, 252], [306, 280], [350, 312], [400, 338], [450, 356]], "#ffffff", "#5a82b6", 400);
  ridge([[130, 188], [150, 210], [176, 246], [214, 286], [190, 330], [156, 290], [136, 236]], "#93aed2", "#4f76a8", 350);
  ridge([[250, 268], [282, 252], [306, 280], [350, 312], [300, 330], [276, 290]], "#a3bad9", "#557aa9", 345);
  ridge([[420, 366], [456, 334], [480, 298], [492, 268], [504, 292], [524, 324], [566, 360]], "#f6faff", "#6189ba", 380);
  ridge([[492, 268], [504, 292], [524, 324], [566, 360], [520, 366], [500, 320]], "#9db6d8", "#5b82b2", 372);
  // Foothills: four ridgelines, bluer and paler with distance, with mist
  // pooling in the valleys between them.
  const hills = (base: number, amp: number, seed: number, top: string, bottom: string) => {
    const pts: number[][] = [];
    for (let x = 0; x <= W; x += 8) {
      const u = x / W;
      const n = Math.sin(u * 5.1 + seed) * 0.5 + Math.sin(u * 11.7 + seed * 2.3) * 0.28 + Math.sin(u * 27.3 + seed * 4.1) * 0.13 + Math.sin(u * 61 + seed * 7.7) * 0.06;
      pts.push([x, base - n * amp]);
    }
    ridge(pts, top, bottom, base + 160);
  };
  hills(352, 24, 1.3, "#86a8c8", "#cfe3ea");
  hills(386, 28, 4.1, "#5f8f93", "#c2dcd6");
  hills(428, 32, 2.2, "#3d7a63", "#a3cbb5");
  hills(484, 28, 5.6, "#22573f", "#5f9c7c");
  const haze = g.createLinearGradient(0, 380, 0, H);
  haze.addColorStop(0, "rgba(214,234,232,0)");
  haze.addColorStop(0.5, "rgba(214,234,232,0.3)");
  haze.addColorStop(1, "rgba(190,216,206,0.12)");
  g.fillStyle = haze;
  g.fillRect(0, 380, W, H - 380);
  // sun rays, low on the right
  const ray = g.createRadialGradient(W * 0.98, H * 1.02, 0, W * 0.98, H * 1.02, 330);
  ray.addColorStop(0, "rgba(232,255,170,0.75)");
  ray.addColorStop(1, "rgba(232,255,170,0)");
  g.fillStyle = ray;
  g.fillRect(W - 360, H - 340, 360, 340);
  // pines along the bottom
  const pine = (x: number, base: number, h: number, c: string) => {
    g.fillStyle = c;
    for (let i = 0; i < 5; i++) {
      const y = base - h + (i * h) / 5;
      const w = (h * 0.42 * (i + 1.4)) / 6;
      g.beginPath();
      g.moveTo(x, y - h * 0.08);
      g.lineTo(x - w, y + h / 4.2);
      g.lineTo(x + w, y + h / 4.2);
      g.closePath();
      g.fill();
    }
  };
  for (const [x, h] of [[600, 60], [640, 78], [700, 96], [742, 70], [790, 120], [840, 104], [880, 150], [930, 126], [975, 170], [1010, 140], [330, 44], [300, 30], [545, 40]] as const)
    pine(x, H + 8, h, x > 760 ? "#12402d" : "#0f3326");
}
