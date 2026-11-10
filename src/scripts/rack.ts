// The 3D hero: a desk in the evening, lit by two warm lamps and a monitor.
// Every object with a soft glow above it opens a piece of the site (about,
// roles, stack, signals, house rules, contact). Geometry and textures are all
// generated here, so there are no model or image downloads and the CSP stays
// 'self'-only. Loaded lazily by Rack.astro, only on devices that can run it.
import * as THREE from "three";
import { site } from "../data/site.ts";
import { experience } from "../data/experience.ts";

const C = {
  ok: "#39e58c",
  info: "#62b6ff",
  fg: "#e6ebf2",
  mut: "#8d99ab",
  warm: "#ffc98a",
};
const DISPLAY = '"Space Grotesk", system-ui, sans-serif';
const MONO = '"JetBrains Mono", ui-monospace, monospace';

type Hot = {
  id: string;
  label: string;
  pos: THREE.Vector3;
  normal: THREE.Vector3;
  dist: number;
  /** Width the close-up must keep in view, in metres. */
  w?: number;
  /** Objects that nudge toward the visitor on hover / select. */
  slide?: THREE.Object3D;
  slideBase?: number;
  slideNow?: number;
  /** Objects that rise a few millimetres under the pointer. */
  lift?: THREE.Object3D;
  liftBase?: number;
  liftNow?: number;
  beacon?: THREE.SpriteMaterial;
};

export interface RackController {
  select(id: string | null): void;
  dispose(): void;
}

export async function initRack(
  stage: HTMLElement,
  canvas: HTMLCanvasElement,
  on: { select(id: string | null): void; hover(label: string | null, x: number, y: number): void },
): Promise<RackController> {
  const reduced = matchMedia("(prefers-reduced-motion: reduce)").matches;

  // Canvas textures use the page fonts; make sure they are loaded first.
  try {
    // Bounded: a stalled font request must not hold the scene back.
    await Promise.race([
      Promise.all([
        document.fonts.load(`700 40px ${DISPLAY}`),
        document.fonts.load(`500 40px ${DISPLAY}`),
        document.fonts.load(`500 24px ${MONO}`),
        document.fonts.load(`700 24px ${MONO}`),
      ]),
      new Promise((done) => setTimeout(done, 1500)),
    ]);
  } catch {
    /* fall back to system fonts */
  }

  const renderer = new THREE.WebGLRenderer({ canvas, antialias: true, powerPreference: "high-performance" });
  renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 2));
  renderer.outputColorSpace = THREE.SRGBColorSpace;
  renderer.toneMapping = THREE.ACESFilmicToneMapping;
  renderer.toneMappingExposure = 1.1;
  const maxAniso = renderer.capabilities.getMaxAnisotropy();

  const scene = new THREE.Scene();
  const bgDark = new THREE.Color("#0c0907");
  const bgLight = new THREE.Color("#8d8377");
  scene.background = bgDark.clone();
  scene.fog = new THREE.Fog(scene.background as THREE.Color, 6, 14);

  const camera = new THREE.PerspectiveCamera(36, 1, 0.05, 40);

  const WALL_Z = -0.42;
  const TOP = 0.74; // desk surface height

  // ── helpers ────────────────────────────────────────────────────────────
  const disposables: { dispose(): void }[] = [];
  const track = <T extends { dispose(): void }>(x: T) => (disposables.push(x), x);

  function tex(w: number, h: number, draw: (g: CanvasRenderingContext2D, w: number, h: number) => void) {
    const c = document.createElement("canvas");
    c.width = w;
    c.height = h;
    const g = c.getContext("2d")!;
    draw(g, w, h);
    const t = track(new THREE.CanvasTexture(c));
    t.colorSpace = THREE.SRGBColorSpace;
    t.anisotropy = maxAniso;
    return t;
  }
  const std = (color: string, rough = 0.7, metal = 0) =>
    track(new THREE.MeshStandardMaterial({ color, roughness: rough, metalness: metal }));
  function box(w: number, h: number, d: number, mat: THREE.Material | THREE.Material[], x = 0, y = 0, z = 0, parent: THREE.Object3D = scene) {
    const m = new THREE.Mesh(track(new THREE.BoxGeometry(w, h, d)), mat);
    m.position.set(x, y, z);
    parent.add(m);
    return m;
  }
  function cyl(rt: number, rb: number, h: number, mat: THREE.Material, x = 0, y = 0, z = 0, parent: THREE.Object3D = scene, seg = 24, open = false) {
    const m = new THREE.Mesh(track(new THREE.CylinderGeometry(rt, rb, h, seg, 1, open)), mat);
    m.position.set(x, y, z);
    parent.add(m);
    return m;
  }
  function fit(g: CanvasRenderingContext2D, text: string, weight: number, family: string, size: number, maxW: number) {
    let s = size;
    do {
      g.font = `${weight} ${s}px ${family}`;
      s -= 2;
    } while (g.measureText(text).width > maxW && s > 12);
  }

  const glowTex = tex(64, 64, (g) => {
    const r = g.createRadialGradient(32, 32, 0, 32, 32, 32);
    r.addColorStop(0, "rgba(255,255,255,1)");
    r.addColorStop(0.25, "rgba(255,255,255,0.45)");
    r.addColorStop(1, "rgba(255,255,255,0)");
    g.fillStyle = r;
    g.fillRect(0, 0, 64, 64);
  });
  function glow(parent: THREE.Object3D, x: number, y: number, z: number, color: string, size: number, opacity = 0.8) {
    const mat = track(
      new THREE.SpriteMaterial({ map: glowTex, color, blending: THREE.AdditiveBlending, depthWrite: false, transparent: true, opacity }),
    );
    const s = new THREE.Sprite(mat);
    s.position.set(x, y, z);
    s.scale.setScalar(size);
    parent.add(s);
    return mat;
  }

  // Soft contact shadows and pools of lamplight are flat, blended discs: far
  // cheaper than shadow maps, and they sell the evening light.
  function disc(w: number, d: number, x: number, y: number, z: number, color: string, opacity: number, additive: boolean, parent: THREE.Object3D = scene) {
    const mat = track(
      new THREE.MeshBasicMaterial({
        map: glowTex,
        color,
        transparent: true,
        opacity,
        depthWrite: false,
        blending: additive ? THREE.AdditiveBlending : THREE.NormalBlending,
        toneMapped: false,
      }),
    );
    const m = new THREE.Mesh(track(new THREE.PlaneGeometry(w, d)), mat);
    m.rotation.x = -Math.PI / 2;
    m.position.set(x, y, z);
    m.renderOrder = additive ? 2 : 1;
    parent.add(m);
    return { mesh: m, mat };
  }
  const shadow = (w: number, d: number, x: number, z: number, y = TOP + 0.0052, o = 0.5) => disc(w, d, x, y, z, "#000000", o, false);

  const hots: Hot[] = [];
  const hitTargets: THREE.Object3D[] = [];
  const markHot = (o: THREE.Object3D, id: string) => {
    o.userData.hot = id;
    hitTargets.push(o);
  };
  /** An invisible, generous click target around small objects. */
  const hitMat = track(new THREE.MeshBasicMaterial({ visible: false }));
  const hitBox = (w: number, h: number, d: number, x: number, y: number, z: number, id: string, parent: THREE.Object3D = scene) =>
    markHot(box(w, h, d, hitMat, x, y, z, parent), id);

  // ── room ───────────────────────────────────────────────────────────────

  const floorTex = tex(256, 256, (g, w, h) => {
    g.fillStyle = "#b8b4ad";
    g.fillRect(0, 0, w, h);
    g.fillStyle = "rgba(255,255,255,0.05)";
    for (let i = 0; i < 300; i++) g.fillRect(Math.random() * w, Math.random() * h, 2, 2);
    g.strokeStyle = "#6f6a63";
    g.lineWidth = 5;
    g.strokeRect(0, 0, w, h);
  });
  floorTex.wrapS = floorTex.wrapT = THREE.RepeatWrapping;
  floorTex.repeat.set(36, 36);
  const floor = new THREE.Mesh(
    track(new THREE.PlaneGeometry(16, 16)),
    track(new THREE.MeshStandardMaterial({ map: floorTex, roughness: 0.55, metalness: 0 })),
  );
  floor.rotation.x = -Math.PI / 2;
  scene.add(floor);

  const wallMat = std("#e3d6c2", 0.96);
  const wall = new THREE.Mesh(track(new THREE.PlaneGeometry(16, 4.2)), wallMat);
  wall.position.set(0, 2.1, WALL_Z);
  scene.add(wall);
  box(16, 0.09, 0.015, std("#f1ede6", 0.7), 0, 0.045, WALL_Z + 0.008);
  // Outlet under the desk, with the power lead hanging to it.
  box(0.07, 0.11, 0.008, std("#f4f1ea", 0.6), 0.08, 0.42, WALL_Z + 0.005);
  {
    const lead = new THREE.CatmullRomCurve3([
      new THREE.Vector3(-0.02, TOP - 0.03, -0.3),
      new THREE.Vector3(-0.04, 0.5, -0.33),
      new THREE.Vector3(0.0, 0.3, -0.36),
      new THREE.Vector3(0.07, 0.36, WALL_Z + 0.02),
      new THREE.Vector3(0.08, 0.42, WALL_Z + 0.012),
    ]);
    scene.add(new THREE.Mesh(track(new THREE.TubeGeometry(lead, 40, 0.004, 6)), std("#ecebe6", 0.6)));
  }

  // Curtain on the right: a pleated sheet from ceiling to floor. It sways.
  let curtain: THREE.PlaneGeometry | null = null;
  {
    const geo = track(new THREE.PlaneGeometry(1.5, 3.2, 90, 1));
    const p = geo.attributes.position;
    for (let i = 0; i < p.count; i++) p.setZ(i, Math.sin(p.getX(i) * 46) * 0.028 + Math.sin(p.getX(i) * 13) * 0.02);
    geo.computeVertexNormals();
    const m = new THREE.Mesh(geo, track(new THREE.MeshStandardMaterial({ color: "#7c8ba3", roughness: 0.95, side: THREE.DoubleSide })));
    m.position.set(1.56, 1.6, WALL_Z + 0.2);
    scene.add(m);
    curtain = geo;
  }

  // Couch on the left: just the arm and seat that show in frame.
  {
    const fabric = std("#737982", 0.98);
    box(1.2, 0.44, 0.95, fabric, -1.72, 0.22, 0.2);
    box(0.2, 0.66, 0.95, fabric, -1.02, 0.33, 0.2);
    box(1.2, 0.86, 0.22, fabric, -1.72, 0.43, -0.2);
    box(0.5, 0.14, 0.5, std("#868c95", 0.98), -1.42, 0.51, 0.1);
  }

  // ── desk ───────────────────────────────────────────────────────────────
  const DW = 1.44;
  const DD = 0.74;
  const white = std("#f3f1ec", 0.55);
  box(DW, 0.026, DD, white, 0, TOP - 0.013, 0);
  for (const sx of [-1, 1]) {
    cyl(0.03, 0.03, TOP - 0.05, white, sx * 0.58, (TOP - 0.05) / 2 + 0.02, -0.02);
    box(0.075, 0.024, 0.62, white, sx * 0.58, 0.012, 0);
    box(0.09, 0.03, 0.5, white, sx * 0.58, TOP - 0.041, -0.02);
  }
  box(1.1, 0.03, 0.06, white, 0, TOP - 0.041, -0.02);
  // Desk mat.
  box(0.94, 0.004, 0.37, std("#1d2622", 0.85), 0, TOP + 0.002, 0.14);
  {
    // Stitched edge of the mat.
    const stitch = std("#3b4a43", 0.9);
    for (const sz of [-1, 1]) box(0.92, 0.0006, 0.0025, stitch, 0, TOP + 0.0044, 0.14 + sz * 0.176);
    for (const sx of [-1, 1]) box(0.0025, 0.0006, 0.352, stitch, sx * 0.461, TOP + 0.0044, 0.14);
  }
  // Height controller under the front-right edge, and the desk's shadow.
  box(0.11, 0.022, 0.05, std("#e9e6e0", 0.5), 0.56, TOP - 0.037, 0.33);
  box(0.03, 0.004, 0.012, std("#9aa0a6", 0.5), 0.56, TOP - 0.037, 0.356);
  disc(2.3, 1.5, 0, 0.004, 0.02, "#000000", 0.55, false);
  disc(1.9, 0.5, 0, 0.5, WALL_Z + 0.012, "#000000", 0.28, false).mesh.rotation.x = 0;

  const worldOf = (o: THREE.Object3D, x = 0, y = 0, z = 0) => o.localToWorld(new THREE.Vector3(x, y, z));

  // ── monitor → about ────────────────────────────────────────────────────
  const SW = 0.62;
  const SH = 0.36;
  const mon = new THREE.Group();
  mon.position.set(0, TOP, -0.2);
  scene.add(mon);
  const dark = std("#17191c", 0.5, 0.3);
  box(0.34, 0.012, 0.24, dark, 0, 0.006, 0.02, mon);
  cyl(0.02, 0.02, 0.3, std("#b9bdc2", 0.3, 0.9), 0, 0.16, -0.03, mon);
  const SCY = 0.15 + SH / 2;
  const monBody = box(SW + 0.014, SH + 0.022, 0.028, dark, 0, SCY - 0.004, 0, mon);
  const scr = document.createElement("canvas");
  scr.width = 1024;
  scr.height = Math.round((1024 * SH) / SW);
  const sg = scr.getContext("2d")!;
  const scrTex = track(new THREE.CanvasTexture(scr));
  scrTex.colorSpace = THREE.SRGBColorSpace;
  scrTex.anisotropy = maxAniso;
  const screen = new THREE.Mesh(track(new THREE.PlaneGeometry(SW, SH)), track(new THREE.MeshBasicMaterial({ map: scrTex, toneMapped: false })));
  screen.position.set(0, SCY, 0.0145);
  mon.add(screen);
  markHot(monBody, "console");
  markHot(screen, "console");
  box(0.012, 0.0025, 0.002, track(new THREE.MeshBasicMaterial({ color: "#9fd0ff", toneMapped: false })), 0.1, 0.143, 0.0146, mon);
  box(0.05, 0.012, 0.012, dark, 0.1, 0.136, 0.006, mon);
  shadow(0.5, 0.36, 0, -0.18, TOP + 0.0006, 0.55);
  {
    // Display cable from the monitor round to the laptop.
    const c = new THREE.CatmullRomCurve3([
      new THREE.Vector3(0.1, TOP + 0.2, -0.222),
      new THREE.Vector3(0.12, TOP + 0.04, -0.26),
      new THREE.Vector3(0.22, TOP + 0.008, -0.2),
      new THREE.Vector3(0.27, TOP + 0.008, -0.13),
      new THREE.Vector3(0.285, TOP + 0.008, -0.08),
    ]);
    scene.add(new THREE.Mesh(track(new THREE.TubeGeometry(c, 30, 0.0022, 6)), std("#111214", 0.6)));
  }

  // The lock screen: mountains at sunrise, the visitor's local time on top.
  const paper = document.createElement("canvas");
  paper.width = scr.width;
  paper.height = scr.height;
  {
    const g = paper.getContext("2d")!;
    const W = paper.width;
    const H = paper.height;
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
    // haze + green hills
    ridge([[0, 372], [140, 352], [300, 340], [420, 322], [520, 318], [640, 332], [760, 350], [900, 372], [W, 392]], "#4f8f76", "#a9cfc4", 470);
    ridge([[0, 410], [200, 392], [420, 372], [620, 360], [800, 372], [W, 352]], "#6aa58a", "#cfe6dc", 520);
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
  const initials = site.name
    .split(" ")
    .map((s) => s[0])
    .join("")
    .slice(0, 2)
    .toUpperCase();
  const fmtDate = new Intl.DateTimeFormat("en-CA", { weekday: "short", month: "short", day: "numeric" });
  function drawLock(now: Date) {
    const W = scr.width;
    const H = scr.height;
    sg.drawImage(paper, 0, 0);
    sg.textAlign = "center";
    sg.textBaseline = "alphabetic";
    sg.fillStyle = "rgba(255,255,255,0.92)";
    sg.font = `500 26px ${DISPLAY}`;
    sg.fillText(fmtDate.format(now).replace(",", ""), W / 2, 84);
    sg.fillStyle = "rgba(190,236,255,0.9)";
    sg.font = `700 92px ${DISPLAY}`;
    sg.fillText(`${now.getHours() % 12 || 12}:${String(now.getMinutes()).padStart(2, "0")}`, W / 2, 168);
    // avatar + name
    sg.fillStyle = "rgba(60,84,120,0.85)";
    sg.beginPath();
    sg.arc(W / 2, H - 112, 24, 0, Math.PI * 2);
    sg.fill();
    sg.fillStyle = "#fff";
    sg.font = `700 20px ${DISPLAY}`;
    sg.fillText(initials, W / 2, H - 105);
    sg.font = `500 15px ${DISPLAY}`;
    sg.fillText(site.name, W / 2, H - 70);
    sg.fillStyle = "rgba(255,255,255,0.28)";
    sg.fillRect(W / 2 - 70, H - 58, 140, 20);
    sg.textAlign = "left";
  }

  // Selecting the monitor wakes it into a terminal.
  const age = `${new Date().getFullYear() - site.opsStart}y`;
  const pad = (s: string, n: number) => s.padEnd(n, " ");
  type TL = { t: "cmd" | "out" | "head" | "kv"; s: string; k?: string };
  const term: TL[] = [
    { t: "cmd", s: "kubectl get engineer" },
    { t: "head", s: `${pad("NAME", 13)}${pad("READY", 7)}${pad("STATUS", 9)}AGE` },
    { t: "out", s: `${pad(site.handle, 13)}${pad("1/1", 7)}${pad("Running", 9)}${age}` },
    { t: "cmd", s: `kubectl describe engineer ${site.handle}` },
    { t: "kv", k: "Location", s: site.location },
    ...site.currently.map((c) => ({ t: "kv" as const, k: c.key, s: c.value })),
    { t: "kv", k: "Status", s: site.available ? site.availableLabel : "heads-down" },
  ];
  const termChars = term.reduce((n, l) => n + (l.t === "cmd" ? l.s.length + 8 : 2), 0);
  function drawTerm(t: number) {
    const prog = reduced ? termChars : Math.max(0, (t - 0.5) * 34);
    const caret = Math.floor(t * 2) % 2 === 0;
    const W = scr.width;
    const H = scr.height;
    sg.fillStyle = "#050a0d";
    sg.fillRect(0, 0, W, H);
    sg.fillStyle = "#0e151c";
    sg.fillRect(0, 0, W, 58);
    sg.textBaseline = "middle";
    sg.textAlign = "left";
    sg.font = `500 26px ${MONO}`;
    sg.fillStyle = C.mut;
    sg.fillText(`${site.handle}@prod: ~`, 28, 30);
    sg.textAlign = "right";
    sg.fillStyle = C.ok;
    sg.fillText(`● ${site.region}`, W - 28, 30);
    sg.textAlign = "left";
    const LH = 44;
    let yy = 98;
    let left = prog;
    let done = true;
    sg.font = `500 30px ${MONO}`;
    for (const l of term) {
      if (left <= 0) {
        done = false;
        break;
      }
      if (l.t === "cmd") {
        const n = Math.min(l.s.length, Math.floor(left));
        sg.fillStyle = C.ok;
        sg.fillText("$", 28, yy);
        sg.fillStyle = C.fg;
        sg.fillText(l.s.slice(0, n), 64, yy);
        if (n < l.s.length) {
          if (caret) sg.fillRect(64 + sg.measureText(l.s.slice(0, n)).width + 3, yy - 18, 16, 36);
          done = false;
          break;
        }
        left -= l.s.length + 8;
        if (left <= 0) {
          done = false;
          break;
        }
      } else {
        if (l.t === "kv") {
          sg.fillStyle = C.info;
          sg.fillText(pad(`${l.k}:`, 12), 28, yy);
          sg.fillStyle = l.k === "Status" ? C.ok : C.fg;
          sg.fillText(l.s, 28 + sg.measureText(pad("", 12)).width, yy);
        } else {
          sg.fillStyle = l.t === "head" ? C.mut : C.fg;
          sg.fillText(l.s, 28, yy);
        }
        left -= 2;
      }
      yy += LH;
    }
    if (done) {
      sg.fillStyle = C.ok;
      sg.fillText("$", 28, yy);
      if (caret) {
        sg.fillStyle = C.fg;
        sg.fillRect(64, yy - 18, 16, 36);
      }
    }
    sg.textBaseline = "alphabetic";
  }
  let screenKey = "";
  let termSince = 0;
  function drawScreen(t: number, termOn: boolean) {
    const now = new Date();
    const key = termOn
      ? `t${Math.min((reduced ? termChars : Math.max(0, (t - termSince - 0.5) * 34)) | 0, termChars)}:${Math.floor((t - termSince) * 2) % 2}`
      : `l${now.getHours()}:${now.getMinutes()}`;
    if (key === screenKey) return;
    screenKey = key;
    if (termOn) drawTerm(t - termSince);
    else drawLock(now);
    scrTex.needsUpdate = true;
  }
  drawScreen(0, false);

  // ── table lamp (left) → house rules ────────────────────────────────────
  const lampL = new THREE.Group();
  lampL.position.set(-0.56, TOP, -0.18);
  scene.add(lampL);
  cyl(0.05, 0.052, 0.022, std("#c9a06a", 0.6), 0, 0.011, 0, lampL, 32);
  cyl(0.005, 0.005, 0.12, white, 0, 0.082, 0, lampL, 10);
  const shadeTex = tex(512, 128, (g, w, h) => {
    const base = g.createLinearGradient(0, 0, 0, h);
    base.addColorStop(0, "#ffe9bd");
    base.addColorStop(0.55, "#fff3d4");
    base.addColorStop(1, "#ffd995");
    g.fillStyle = base;
    g.fillRect(0, 0, w, h);
    // pleats
    for (let i = 0; i < 36; i++) {
      const x = (i / 36) * w;
      const pl = g.createLinearGradient(x, 0, x + w / 36, 0);
      pl.addColorStop(0, "rgba(160,96,20,0.34)");
      pl.addColorStop(0.5, "rgba(255,255,255,0.12)");
      pl.addColorStop(1, "rgba(160,96,20,0.3)");
      g.fillStyle = pl;
      g.fillRect(x, 0, w / 36, h);
    }
  });
  const shade = new THREE.Mesh(
    track(new THREE.CylinderGeometry(0.052, 0.082, 0.105, 36, 1, true)),
    track(new THREE.MeshBasicMaterial({ map: shadeTex, side: THREE.DoubleSide, toneMapped: false })),
  );
  shade.position.set(0, 0.2, 0);
  lampL.add(shade);
  const shadeGlow = glow(lampL, 0, 0.2, 0.02, "#ffae38", 0.46, 0.42);
  hitBox(0.19, 0.28, 0.19, 0, 0.14, 0, "principles", lampL);
  // Finial, bulb, and the pools of light the shade throws on wall and desk.
  cyl(0.004, 0.006, 0.012, std("#d9c08a", 0.4, 0.6), 0, 0.258, 0, lampL, 10);
  glow(lampL, 0, 0.185, 0, "#fff0c8", 0.06, 0.9);
  const poolWallL = disc(1.25, 1.25, -0.56, TOP + 0.24, WALL_Z + 0.006, "#ffab40", 0.3, true);
  poolWallL.mesh.rotation.x = 0;
  const poolDeskL = disc(0.62, 0.5, -0.54, TOP + 0.0008, -0.12, "#ffab40", 0.28, true);
  shadow(0.14, 0.14, -0.56, -0.18, TOP + 0.0012, 0.45);

  // ── succulent → AIOps, still growing ───────────────────────────────────
  const plant = new THREE.Group();
  plant.position.set(-0.385, TOP, -0.2);
  scene.add(plant);
  const potTex = tex(256, 64, (g, w, h) => {
    g.fillStyle = "#b9c8bd";
    g.fillRect(0, 0, w, h);
    for (let i = 0; i < 28; i++) {
      g.fillStyle = i % 2 ? "rgba(255,255,255,0.16)" : "rgba(40,60,50,0.16)";
      g.fillRect((i / 28) * w, 0, w / 28, h);
    }
  });
  cyl(0.046, 0.046, 0.008, std("#aebdb2", 0.6), 0, 0.004, 0, plant, 24);
  cyl(0.04, 0.034, 0.062, track(new THREE.MeshStandardMaterial({ map: potTex, roughness: 0.7 })), 0, 0.039, 0, plant, 28);
  cyl(0.036, 0.036, 0.004, std("#3a2c22", 0.95), 0, 0.068, 0, plant, 20);
  {
    const leaf = track(new THREE.ConeGeometry(0.009, 0.03, 6));
    const leafMat = std("#5f9d6c", 0.6);
    const tipMat = std("#83bd88", 0.6);
    for (let ring = 0; ring < 3; ring++) {
      const n = [7, 5, 3][ring];
      for (let i = 0; i < n; i++) {
        const a = (i / n) * Math.PI * 2 + ring * 0.5;
        const m = new THREE.Mesh(leaf, ring === 2 ? tipMat : leafMat);
        const r = [0.02, 0.012, 0.004][ring];
        m.position.set(Math.cos(a) * r, 0.076 + ring * 0.007, Math.sin(a) * r);
        m.rotation.set(Math.sin(a) * (0.95 - ring * 0.35), 0, -Math.cos(a) * (0.95 - ring * 0.35));
        plant.add(m);
      }
    }
  }
  hitBox(0.12, 0.14, 0.12, 0, 0.06, 0, "aiops", plant);
  shadow(0.13, 0.13, -0.385, -0.2, TOP + 0.0012, 0.45);

  // ── gooseneck lamp (right) ─────────────────────────────────────────────
  const lampR = new THREE.Group();
  lampR.position.set(0.6, TOP, -0.24);
  scene.add(lampR);
  cyl(0.058, 0.062, 0.012, white, 0, 0.006, 0, lampR, 32);
  cyl(0.007, 0.007, 0.26, white, 0, 0.14, 0, lampR, 10);
  const neck = new THREE.CatmullRomCurve3([
    new THREE.Vector3(0, 0.26, 0),
    new THREE.Vector3(0, 0.33, 0.004),
    new THREE.Vector3(-0.022, 0.375, 0.016),
    new THREE.Vector3(-0.06, 0.375, 0.034),
    new THREE.Vector3(-0.082, 0.35, 0.046),
  ]);
  lampR.add(new THREE.Mesh(track(new THREE.TubeGeometry(neck, 24, 0.008, 8)), std("#e8b53a", 0.55)));
  const head = cyl(0.012, 0.034, 0.06, track(new THREE.MeshStandardMaterial({ color: "#f3f1ec", roughness: 0.55, side: THREE.DoubleSide })), -0.098, 0.326, 0.056, lampR, 24, true);
  head.rotation.set(0.5, 0, 0.62);
  const bulbGlow = glow(lampR, -0.114, 0.3, 0.07, "#ffae38", 0.17, 0.8);
  const bulbCore = glow(lampR, -0.114, 0.3, 0.07, "#fff0c8", 0.05, 1);
  {
    // Yellow cord with its inline switch, trailing off behind the laptop.
    const c = new THREE.CatmullRomCurve3([
      new THREE.Vector3(0.6, TOP + 0.008, -0.27),
      new THREE.Vector3(0.52, TOP + 0.005, -0.3),
      new THREE.Vector3(0.4, TOP + 0.005, -0.285),
      new THREE.Vector3(0.3, TOP + 0.005, -0.31),
      new THREE.Vector3(0.24, TOP + 0.005, -0.34),
    ]);
    scene.add(new THREE.Mesh(track(new THREE.TubeGeometry(c, 30, 0.003, 6)), std("#e8b53a", 0.6)));
    box(0.04, 0.012, 0.018, std("#f3f1ec", 0.5), 0.46, TOP + 0.007, -0.293);
  }
  const poolWallR = disc(1.0, 1.0, 0.52, TOP + 0.34, WALL_Z + 0.006, "#ffab40", 0.27, true);
  poolWallR.mesh.rotation.x = 0;
  const poolDeskR = disc(0.5, 0.42, 0.47, TOP + 0.0008, -0.12, "#ffab40", 0.22, true);
  shadow(0.16, 0.16, 0.6, -0.24, TOP + 0.0012, 0.4);
  // The desk lamp is a real switch: click it to turn it off and on.
  const lampRHit = box(0.2, 0.42, 0.18, hitMat, -0.03, 0.2, 0.02, lampR);
  lampRHit.userData.toggle = "lampR";
  hitTargets.push(lampRHit);

  // ── keyboard + wrist rest → stack ──────────────────────────────────────
  const kb = new THREE.Group();
  kb.position.set(0, TOP + 0.004, 0.1);
  scene.add(kb);
  const kbTex = tex(1024, 400, (g, w, h) => {
    g.fillStyle = "#cfd3d8";
    g.fillRect(0, 0, w, h);
    const U = 62;
    const G = 6;
    const key = (x: number, y: number, kw: number, c: string) => {
      g.fillStyle = "rgba(0,0,0,0.25)";
      g.fillRect(x + 2, y + 4, kw - G, U - G);
      g.fillStyle = c;
      g.beginPath();
      g.roundRect(x, y, kw - G, U - G, 8);
      g.fill();
    };
    const lightKey = "#f1f0ea";
    const modKey = "#8c97a3";
    const rows: [number, string][][] = [
      [[1, "#58b76a"], ...Array.from({ length: 13 }, () => [1, lightKey] as [number, string]), [1, "#e0463c"]],
      [...Array.from({ length: 13 }, () => [1, lightKey] as [number, string]), [2, modKey]],
      [[1.5, modKey], ...Array.from({ length: 12 }, () => [1, lightKey] as [number, string]), [1.5, lightKey]],
      [[1.75, modKey], ...Array.from({ length: 11 }, () => [1, lightKey] as [number, string]), [2.25, "#3f6fd0"]],
      [[2.25, modKey], ...Array.from({ length: 10 }, () => [1, lightKey] as [number, string]), [1.75, modKey], [1, modKey]],
      [[1.25, modKey], [1.25, modKey], [1.25, modKey], [6.25, "#f0c43c"], [1, modKey], [1, modKey], [1, modKey], [1, modKey], [1, modKey]],
    ];
    rows.forEach((row, r) => {
      let x = 28;
      for (const [u, c] of row) {
        key(x, 16 + r * (U + 1), u * U, c);
        x += u * U;
      }
    });
  });
  const kbSide = std("#dfe2e6", 0.4);
  const kbTop = track(new THREE.MeshStandardMaterial({ map: kbTex, roughness: 0.6 }));
  const kbBody = box(0.33, 0.022, 0.13, [kbSide, kbSide, kbTop, kbSide, kbSide, kbSide], 0, 0.011, 0, kb);
  kbBody.rotation.x = 0.06;
  const rest = box(0.34, 0.02, 0.085, std("#8a9099", 0.95), 0, 0.01, 0.118, kb);
  markHot(kbBody, "stack");
  markHot(rest, "stack");
  shadow(0.42, 0.3, 0, 0.16, TOP + 0.0046, 0.5);
  shadow(0.1, 0.13, 0.31, 0.172, TOP + 0.0046, 0.55);
  {
    // Coiled charging lead and the earbud case at the left of the mat.
    const c = new THREE.CatmullRomCurve3([
      new THREE.Vector3(-0.2, TOP + 0.006, -0.04),
      new THREE.Vector3(-0.12, TOP + 0.006, -0.02),
      new THREE.Vector3(-0.1, TOP + 0.007, 0.03),
      new THREE.Vector3(-0.17, TOP + 0.007, 0.04),
      new THREE.Vector3(-0.235, TOP + 0.007, 0.0),
      new THREE.Vector3(-0.3, TOP + 0.004, -0.06),
      new THREE.Vector3(-0.3, TOP + 0.004, -0.2),
    ]);
    scene.add(new THREE.Mesh(track(new THREE.TubeGeometry(c, 40, 0.0025, 6)), std("#ecebe6", 0.6)));
    box(0.05, 0.022, 0.045, std("#eeece7", 0.4), -0.215, TOP + 0.011, -0.045);
  }

  // Mouse.
  {
    const m = new THREE.Mesh(track(new THREE.SphereGeometry(0.03, 20, 14)), std("#1b1d20", 0.45));
    m.scale.set(1, 0.55, 1.6);
    m.position.set(0.31, TOP + 0.018, 0.17);
    scene.add(m);
  }

  // Mug of something hot, with steam curling off it.
  const steam: { mat: THREE.SpriteMaterial; sprite: THREE.Sprite; phase: number }[] = [];
  {
    const mug = new THREE.Group();
    mug.position.set(0.215, TOP + 0.004, 0.0);
    scene.add(mug);
    const glaze = std("#e9dfcf", 0.35);
    cyl(0.036, 0.032, 0.082, glaze, 0, 0.041, 0, mug, 28);
    cyl(0.031, 0.031, 0.002, std("#2a1a10", 0.3), 0, 0.0815, 0, mug, 24);
    const handle = new THREE.Mesh(track(new THREE.TorusGeometry(0.022, 0.006, 8, 20, Math.PI)), glaze);
    handle.position.set(0.034, 0.042, 0);
    handle.rotation.z = -Math.PI / 2;
    mug.add(handle);
    shadow(0.12, 0.12, 0.215, 0.0, TOP + 0.0046, 0.5);
    for (let i = 0; i < 6; i++) {
      const mat = track(new THREE.SpriteMaterial({ map: glowTex, color: "#fff1dc", transparent: true, opacity: 0, depthWrite: false }));
      const sprite = new THREE.Sprite(mat);
      mug.add(sprite);
      steam.push({ mat, sprite, phase: i / 6 });
    }
  }

  // Dust drifting through the lamplight.
  const DUST = 80;
  const dustPos = new Float32Array(DUST * 3);
  const dustSeed = new Float32Array(DUST);
  for (let i = 0; i < DUST; i++) {
    dustPos[i * 3] = (Math.random() - 0.5) * 1.9;
    dustPos[i * 3 + 1] = TOP + Math.random() * 0.95;
    dustPos[i * 3 + 2] = -0.3 + Math.random() * 0.85;
    dustSeed[i] = Math.random() * 20;
  }
  const dustGeo = track(new THREE.BufferGeometry());
  dustGeo.setAttribute("position", new THREE.BufferAttribute(dustPos, 3));
  const dustMat = track(
    new THREE.PointsMaterial({ size: 0.011, map: glowTex, color: "#ffd9a0", transparent: true, opacity: 0, depthWrite: false, blending: THREE.AdditiveBlending, toneMapped: false }),
  );
  scene.add(new THREE.Points(dustGeo, dustMat));

  // ── laptop + glasses → signals ─────────────────────────────────────────
  const lap = new THREE.Group();
  lap.position.set(0.43, TOP, -0.06);
  lap.rotation.y = -0.05;
  scene.add(lap);
  const lapBody = box(0.31, 0.013, 0.215, std("#c9ccd0", 0.35, 0.85), 0, 0.0065, 0, lap);
  markHot(lapBody, "signals");
  {
    const frame = std("#111214", 0.4);
    const ring = track(new THREE.TorusGeometry(0.021, 0.0022, 8, 28));
    const gl = new THREE.Group();
    gl.position.set(0.02, 0.036, 0.03);
    gl.rotation.set(-0.12, 0.25, 0);
    lap.add(gl);
    for (const sx of [-1, 1]) {
      const r = new THREE.Mesh(ring, frame);
      r.position.set(sx * 0.026, 0, 0);
      r.scale.set(1.12, 0.9, 1);
      gl.add(r);
      const temple = box(0.003, 0.003, 0.12, frame, sx * 0.05, 0.008, -0.06, gl);
      temple.rotation.x = 0.1;
    }
    box(0.012, 0.003, 0.003, frame, 0, 0.006, 0, gl);
    const lens = track(new THREE.MeshBasicMaterial({ color: "#cfe2ff", transparent: true, opacity: 0.1, depthWrite: false }));
    for (const sx of [-1, 1]) {
      const l = new THREE.Mesh(track(new THREE.CircleGeometry(0.02, 20)), lens);
      l.position.set(sx * 0.026, 0, 0);
      l.scale.set(1.12, 0.9, 1);
      gl.add(l);
    }
    hitBox(0.14, 0.07, 0.16, 0.02, 0.04, -0.02, "signals", lap);
    shadow(0.4, 0.3, 0.43, -0.06, TOP + 0.0012, 0.5);
  }

  // ── phone → contact ────────────────────────────────────────────────────
  const phone = new THREE.Group();
  phone.position.set(-0.3, TOP + 0.004, 0.13);
  phone.rotation.y = 0.3;
  scene.add(phone);
  const phoneTop = track(
    new THREE.MeshBasicMaterial({
      map: tex(256, 520, (g, w, h) => {
        g.fillStyle = "#0b0d10";
        g.fillRect(0, 0, w, h);
        g.fillStyle = "rgba(255,255,255,0.72)";
        g.textAlign = "center";
        g.font = `500 56px ${DISPLAY}`;
        g.fillText("on call", w / 2, 150);
        g.fillStyle = "rgba(255,255,255,0.12)";
        g.beginPath();
        g.roundRect(18, 250, w - 36, 130, 22);
        g.fill();
        g.textAlign = "left";
        g.fillStyle = C.ok;
        g.font = `700 26px ${MONO}`;
        g.fillText("● PAGE ME", 36, 298);
        g.fillStyle = "rgba(255,255,255,0.85)";
        g.font = `500 24px ${DISPLAY}`;
        g.fillText(site.available ? site.availableLabel : "pager is on", 36, 346);
      }),
      toneMapped: false,
    }),
  );
  const phoneSide = std("#1a1c20", 0.4, 0.5);
  const phoneBody = box(0.072, 0.008, 0.148, [phoneSide, phoneSide, phoneTop, phoneSide, phoneSide, phoneSide], 0, 0.004, 0, phone);
  markHot(phoneBody, "contact");
  hitBox(0.12, 0.05, 0.19, 0, 0.02, 0, "contact", phone);
  shadow(0.12, 0.2, -0.3, 0.13, TOP + 0.0046, 0.5);
  shadow(0.32, 0.26, -0.565, 0.19, TOP + 0.0012, 0.55);

  // ── books → one per role, newest on top ────────────────────────────────
  const covers = ["#2f4f46", "#34455f", "#8a4a3a", "#b88a2f"];
  const pages = std("#efe8d8", 0.9);
  experience.forEach((role, i) => {
    const n = experience.length;
    const col = covers[i % covers.length];
    const cover = std(col, 0.8);
    const spine = track(
      new THREE.MeshStandardMaterial({
        map: tex(768, 110, (g, w, h) => {
          g.fillStyle = col;
          g.fillRect(0, 0, w, h);
          g.fillStyle = "rgba(255,255,255,0.14)";
          g.fillRect(24, 14, 4, h - 28);
          g.fillRect(w - 28, 14, 4, h - 28);
          g.textBaseline = "middle";
          g.fillStyle = "#f6efe0";
          const name = role.company.toUpperCase();
          fit(g, name, 700, DISPLAY, 54, w - 300);
          g.fillText(name, 50, h / 2 + 2);
          g.textAlign = "right";
          g.fillStyle = "rgba(246,239,224,0.75)";
          g.font = `500 30px ${MONO}`;
          g.fillText(role.year.replace(/\s+/g, " "), w - 48, h / 2 + 2);
        }),
        roughness: 0.8,
      }),
    );
    const top = track(
      new THREE.MeshStandardMaterial({
        map: tex(768, 540, (g, w, h) => {
          g.fillStyle = col;
          g.fillRect(0, 0, w, h);
          g.strokeStyle = "rgba(255,255,255,0.16)";
          g.lineWidth = 4;
          g.strokeRect(30, 30, w - 60, h - 60);
          g.fillStyle = "#f6efe0";
          const name = role.company.toUpperCase();
          fit(g, name, 700, DISPLAY, 84, w - 130);
          g.fillText(name, 64, 170);
          g.fillStyle = "rgba(246,239,224,0.8)";
          fit(g, role.title, 500, MONO, 34, w - 130);
          g.fillText(role.title, 64, 232);
          g.font = `500 30px ${MONO}`;
          g.fillText(role.year.replace(/\s+/g, " "), 64, h - 70);
        }),
        roughness: 0.8,
      }),
    );
    const grp = new THREE.Group();
    const BH = 0.03;
    grp.position.set(-0.565 + ((i % 2) - 0.5) * 0.008, TOP + (n - 1 - i) * (BH + 0.001) + BH / 2, 0.19);
    grp.rotation.y = 0.1 + (i % 2 ? -0.07 : 0.05) * (i + 1) * 0.5;
    scene.add(grp);
    const b = box(0.215, BH, 0.155, [pages, cover, top, cover, spine, pages], 0, 0, 0, grp);
    markHot(b, `role-${i}`);
    hots.push({
      id: `role-${i}`,
      label: `${role.company} · ${role.year}`,
      pos: worldOf(grp, 0, 0, 0.08),
      normal: new THREE.Vector3(0, 0.5, 0.87).normalize(),
      dist: 0.62,
      w: 0.27,
      slide: grp,
      slideBase: grp.position.z,
      slideNow: 0,
    });
  });

  scene.updateMatrixWorld(true);
  const up = (y: number, z: number) => new THREE.Vector3(0, y, z).normalize();
  hots.push(
    { id: "console", label: "monitor · about", pos: screen.getWorldPosition(new THREE.Vector3()), normal: new THREE.Vector3(0, 0, 1), dist: 1.2, w: 0.68 },
    { id: "aiops", label: "succulent · AIOps, still growing", pos: worldOf(plant, 0, 0.06, 0), normal: up(0.3, 0.95), dist: 0.5, lift: plant },
    { id: "stack", label: "keyboard · stack", pos: worldOf(kb, 0, 0.01, 0.04), normal: up(0.8, 0.6), dist: 0.66, w: 0.4, lift: kb },
    { id: "signals", label: "laptop · signals", pos: worldOf(lap, 0, 0.02, 0), normal: up(0.7, 0.72), dist: 0.8, w: 0.36, lift: lap },
    { id: "principles", label: "lamp · house rules", pos: worldOf(lampL, 0, 0.15, 0), normal: new THREE.Vector3(0.38, 0.2, 0.9).normalize(), dist: 0.72 },
    { id: "contact", label: "phone · contact", pos: worldOf(phone, 0, 0.01, 0), normal: up(0.86, 0.5), dist: 0.5, lift: phone },
  );
  for (const h of hots) if (h.lift) (h.liftBase = h.lift.position.y), (h.liftNow = 0);
  // A soft point of light above each thing that opens.
  const beaconY: Record<string, number> = { console: 0.23, aiops: 0.1, stack: 0.07, signals: 0.09, principles: 0.19, contact: 0.07 };
  for (const h of hots) {
    const isBook = h.id.startsWith("role-");
    if (isBook && h.id !== "role-0") continue; // one beacon for the stack of books
    const p = h.pos.clone();
    p.y += isBook ? 0.075 : (beaconY[h.id] ?? 0.08);
    if (isBook) p.z -= 0.08;
    h.beacon = glow(scene, p.x, p.y, p.z + 0.02, "#ffd27a", 0.034, 0.9);
  }

  // ── light ──────────────────────────────────────────────────────────────
  const hemi = new THREE.HemisphereLight("#ffd9a0", "#22170c", 0.3);
  scene.add(hemi);
  // Daylight through the curtain, only when the light theme is on.
  const sun = new THREE.DirectionalLight("#dfe9ff", 0);
  sun.position.set(2.6, 2.6, 2.4);
  scene.add(sun);
  // A faint fill from where the visitor stands, so fronts are not silhouettes.
  const fill = new THREE.DirectionalLight("#ffd49a", 0.34);
  fill.position.set(-0.4, 1.6, 3);
  scene.add(fill);
  const lampLLight = new THREE.PointLight("#ffb347", 1.05, 3.2, 1.7);
  lampLLight.position.copy(worldOf(lampL, 0, 0.19, 0.03));
  scene.add(lampLLight);
  const lampLDown = new THREE.SpotLight("#ffb955", 1.6, 1.6, 0.85, 0.8, 1.4);
  lampLDown.position.copy(worldOf(lampL, 0, 0.2, 0));
  lampLDown.target.position.copy(worldOf(lampL, 0.05, 0, 0.12));
  scene.add(lampLDown, lampLDown.target);
  const lampRLight = new THREE.PointLight("#ffb347", 0.8, 2.6, 1.8);
  lampRLight.position.copy(worldOf(lampR, -0.12, 0.29, 0.09));
  scene.add(lampRLight);
  const monLight = new THREE.PointLight("#a9cdfa", 0.4, 2.2, 1.6);
  monLight.position.copy(screen.getWorldPosition(new THREE.Vector3())).add(new THREE.Vector3(0, -0.05, 0.3));
  scene.add(monLight);
  // The cool spill behind the monitor onto the wall.
  const backLight = new THREE.PointLight("#9dbdf5", 0.12, 1.2, 1.6);
  backLight.position.copy(worldOf(mon, 0, SCY, -0.12));
  scene.add(backLight);

  // ── camera ─────────────────────────────────────────────────────────────
  const home = { pos: new THREE.Vector3(), look: new THREE.Vector3() };
  const want = { pos: new THREE.Vector3(), look: new THREE.Vector3() };
  const look = new THREE.Vector3();
  let aspect = 1;
  let selected: Hot | null = null;
  const tanV = Math.tan(THREE.MathUtils.degToRad(camera.fov / 2));

  function place() {
    const portrait = aspect < 0.9;
    // The detail panel sits at the bottom up to 760px wide, else on the right.
    const sheetBottom = matchMedia("(max-width: 760px)").matches;
    // Fit the desk and a little room either side (the desk alone on phones).
    const dist = Math.max(1.55, (portrait ? 0.8 : 0.98) / (tanV * aspect));
    // On wide screens the name sits bottom-left, so the desk is framed a
    // little right of centre; on phones it sits above, so the desk is low.
    const cx = portrait ? 0 : -0.2;
    home.look.set(cx, portrait ? 1.03 : 0.8, 0);
    home.pos.set(cx, portrait ? 1.2 : 1.04, dist);
    if (!selected) {
      want.pos.copy(home.pos);
      want.look.copy(home.look);
      return;
    }
    const h = selected;
    // Far enough back that the whole object fits in the part of the view the
    // panel leaves free (all of the width above a bottom sheet, about half
    // of it beside a side panel).
    const free = sheetBottom ? 0.9 : 0.52;
    const d = Math.max(h.dist * (sheetBottom ? 1.3 : 1), (h.w ?? 0.2) / (2 * tanV * aspect * free));
    const p = h.pos.clone();
    const right = new THREE.Vector3(h.normal.z, 0, -h.normal.x).normalize();
    const shift = new THREE.Vector3();
    if (sheetBottom) shift.y = -0.22 * 2 * d * tanV; // sheet covers the bottom half
    else shift.copy(right).multiplyScalar(0.2 * 2 * d * tanV * aspect); // panel on the right
    want.look.copy(p).add(shift);
    want.pos.copy(p).addScaledVector(h.normal, d).add(shift);
    want.pos.y = Math.max(0.35, want.pos.y);
  }

  function resize() {
    const w = stage.clientWidth;
    const h = stage.clientHeight;
    if (!w || !h) return;
    aspect = w / h;
    renderer.setSize(w, h, false);
    camera.aspect = aspect;
    camera.updateProjectionMatrix();
    place();
    dirty = true;
  }

  // ── interaction ────────────────────────────────────────────────────────
  const ray = new THREE.Raycaster();
  const ptr = new THREE.Vector2(0, 0);
  const par = new THREE.Vector2(0, 0);
  let hovered: Hot | null = null;
  let dirty = true;
  const byId = (id: string | null) => hots.find((h) => h.id === id) ?? null;

  // The desk lamp's switch, and how far the visitor has dragged the view.
  let lampROn = true;
  let lampRLevel = 1;
  let overToggle = false;
  const orbit = { yaw: 0, pitch: 0, nowYaw: 0, nowPitch: 0 };
  let drag: { x: number; y: number; id: number; moved: boolean } | null = null;
  let dragged = false;

  function pickRaw(e: PointerEvent | MouseEvent) {
    const r = canvas.getBoundingClientRect();
    ptr.set(((e.clientX - r.left) / r.width) * 2 - 1, -((e.clientY - r.top) / r.height) * 2 + 1);
    ray.setFromCamera(ptr, camera);
    return ray.intersectObjects(hitTargets, false)[0]?.object ?? null;
  }
  const pick = (e: PointerEvent | MouseEvent) => {
    const o = pickRaw(e);
    return o?.userData.hot ? byId(o.userData.hot) : null;
  };
  function clearHover() {
    hovered = null;
    canvas.style.cursor = "";
    on.hover(null, 0, 0);
  }
  function onDown(e: PointerEvent) {
    if (e.button !== 0) return;
    drag = { x: e.clientX, y: e.clientY, id: e.pointerId, moved: false };
    dragged = false;
  }
  function onMove(e: PointerEvent) {
    if (drag && e.pointerId === drag.id) {
      const dx = e.clientX - drag.x;
      const dy = e.clientY - drag.y;
      // A sideways drag looks around the desk. On touch, a mostly vertical
      // drag is the page scrolling, so it is left alone.
      if (!drag.moved && Math.hypot(dx, dy) > 6 && (e.pointerType !== "touch" || Math.abs(dx) > Math.abs(dy))) {
        drag.moved = true;
        dragged = true;
        canvas.setPointerCapture?.(e.pointerId);
        on.hover(null, 0, 0);
      }
      if (drag.moved) {
        orbit.yaw = THREE.MathUtils.clamp(orbit.yaw - dx * 0.0045, -0.7, 0.7);
        orbit.pitch = THREE.MathUtils.clamp(orbit.pitch + dy * 0.003, -0.1, 0.38);
        drag.x = e.clientX;
        drag.y = e.clientY;
        canvas.style.cursor = "grabbing";
        dirty = true;
        return;
      }
    }
    if (e.pointerType === "touch") return;
    const o = pickRaw(e);
    const h = o?.userData.hot ? byId(o.userData.hot) : null;
    overToggle = !!o?.userData.toggle;
    par.copy(ptr);
    hovered = h;
    canvas.style.cursor = h || overToggle ? "pointer" : "grab";
    on.hover(overToggle ? `desk lamp · switch ${lampROn ? "off" : "on"}` : h && h !== selected ? h.label : null, e.clientX, e.clientY);
    dirty = true;
  }
  function onUp(e: PointerEvent) {
    if (drag && e.pointerId === drag.id) drag = null;
  }
  function onLeave() {
    clearHover();
    overToggle = false;
    par.set(0, 0);
    dirty = true;
  }
  function onClick(e: MouseEvent) {
    // The click that ends a drag is not a choice.
    if (dragged) {
      dragged = false;
      return;
    }
    const o = pickRaw(e);
    on.hover(null, 0, 0);
    if (o?.userData.toggle) {
      lampROn = !lampROn;
      dirty = true;
      return;
    }
    const h = o?.userData.hot ? byId(o.userData.hot) : null;
    on.select(h && h !== selected ? h.id : null);
  }
  canvas.addEventListener("pointerdown", onDown);
  canvas.addEventListener("pointermove", onMove);
  canvas.addEventListener("pointerup", onUp);
  canvas.addEventListener("pointercancel", onUp);
  canvas.addEventListener("pointerleave", onLeave);
  canvas.addEventListener("click", onClick);
  // After a lost GPU context comes back, the reduced-motion path (which only
  // draws on change) needs telling that the canvas is blank.
  const onRestore = () => {
    dirty = true;
  };
  canvas.addEventListener("webglcontextrestored", onRestore);

  // ── loop ───────────────────────────────────────────────────────────────
  // Dark theme is the evening in the photos; the light theme opens the curtain.
  let day = document.documentElement.getAttribute("data-theme") === "light" ? 1 : 0;
  const themeWatch = new MutationObserver(() => (dirty = true));
  themeWatch.observe(document.documentElement, { attributes: true, attributeFilter: ["data-theme"] });

  let visible = true;
  const io = new IntersectionObserver((es) => {
    visible = es[0].isIntersecting;
  });
  io.observe(stage);
  const ro = new ResizeObserver(resize);
  ro.observe(stage);
  // Keeps the lock-screen clock current under reduced motion.
  const minute = window.setInterval(() => (dirty = true), 20_000);

  resize();
  // Start pulled back and ease in.
  camera.position.copy(home.pos).add(new THREE.Vector3(reduced ? 0 : -0.25, reduced ? 0 : 0.15, reduced ? 0 : 1.2));
  look.copy(home.look);

  const orbitOff = new THREE.Vector3();
  const clock = new THREE.Clock();
  let time = 0;
  let raf = 0;
  let settle = 0;
  function frame() {
    raf = requestAnimationFrame(frame);
    if (!visible || document.hidden) {
      clock.getDelta();
      return;
    }
    const dt = Math.min(clock.getDelta(), 0.05);
    time += dt;
    if (reduced) {
      // Reduced motion: no ambient animation; draw only when something changed.
      if (!dirty && settle <= 0) return;
      if (dirty) settle = 1.2;
      settle -= dt;
      dirty = false;
    }
    const k = reduced ? 1 : 1 - Math.exp(-dt * 3.2);

    // camera
    const px = selected || reduced ? 0 : par.x * 0.1;
    const py = selected || reduced ? 0 : par.y * 0.05;
    // The dragged view eases back to centre once the visitor lets go.
    if (!drag?.moved) {
      const back = reduced ? 0 : Math.exp(-dt * 0.35);
      orbit.yaw *= back;
      orbit.pitch *= back;
    }
    const ko = reduced ? 1 : 1 - Math.exp(-dt * 9);
    orbit.nowYaw += (orbit.yaw - orbit.nowYaw) * ko;
    orbit.nowPitch += (orbit.pitch - orbit.nowPitch) * ko;
    orbitOff.copy(want.pos).sub(want.look);
    const flat = Math.hypot(orbitOff.x, orbitOff.z);
    const len = orbitOff.length();
    const yaw0 = Math.atan2(orbitOff.x, orbitOff.z) + orbit.nowYaw;
    const pitch0 = Math.min(1.45, Math.atan2(orbitOff.y, flat) + orbit.nowPitch);
    orbitOff.set(Math.sin(yaw0) * Math.cos(pitch0) * len, Math.sin(pitch0) * len, Math.cos(yaw0) * Math.cos(pitch0) * len);
    camera.position.x += (want.look.x + orbitOff.x + px - camera.position.x) * k;
    camera.position.y += (want.look.y + orbitOff.y + py - camera.position.y) * k;
    camera.position.z += (want.look.z + orbitOff.z - camera.position.z) * k;
    // Stay in front of the wall however far the view is dragged.
    camera.position.z = Math.max(camera.position.z, WALL_Z + 0.3);
    look.lerp(want.look, k);
    camera.lookAt(look);

    // books ease out of the stack on hover / select
    for (const h of hots) {
      if (h.slide) {
        const target = h === selected ? 0.11 : h === hovered ? 0.022 : 0;
        h.slideNow! += (target - h.slideNow!) * (reduced ? 1 : 1 - Math.exp(-dt * 7));
        h.slide.position.z = h.slideBase! + h.slideNow!;
      }
      if (h.lift) {
        const target = h === hovered && h !== selected ? 0.007 : 0;
        h.liftNow! += (target - h.liftNow!) * (reduced ? 1 : 1 - Math.exp(-dt * 10));
        h.lift.position.y = h.liftBase! + h.liftNow!;
      }
      if (h.beacon) {
        const pulse = reduced ? 0.8 : 0.55 + 0.45 * Math.sin(time * 2.2 + h.pos.x * 9);
        h.beacon.opacity = selected ? 0 : pulse * (h === hovered ? 1 : 0.85);
      }
    }

    // Lamps breathe very slightly; daylight fades in for the light theme.
    const wantDay = document.documentElement.getAttribute("data-theme") === "light" ? 1 : 0;
    day += (wantDay - day) * (reduced ? 1 : 1 - Math.exp(-dt * 4));
    const breathe = reduced ? 1 : 1 + Math.sin(time * 1.3) * 0.015;
    hemi.intensity = 0.3 + day * 1.5;
    sun.intensity = day * 1.5;
    lampRLevel += ((lampROn && (reduced || time > 1.25) ? 1 : 0) - lampRLevel) * (reduced ? 1 : 1 - Math.exp(-dt * 12));
    // Opening beat: the room is dark, then the table lamp stutters on, the
    // desk lamp follows, and the monitor wakes.
    const ramp = (t0: number, dur: number) => (reduced ? 1 : THREE.MathUtils.clamp((time - t0) / dur, 0, 1));
    const flick = reduced || time > 1.15 ? 1 : Math.sin(time * 85) > -0.2 ? 1 : 0.3;
    const L = ramp(0.55, 0.1) * flick;
    const S = ramp(1.9, 0.8);
    lampLLight.intensity = 1.05 * breathe * L;
    lampLDown.intensity = 1.6 * L;
    (shade.material as THREE.MeshBasicMaterial).color.setScalar(0.22 + 0.78 * L);
    (screen.material as THREE.MeshBasicMaterial).color.setScalar(S);
    monLight.intensity = 0.4 * S;
    backLight.intensity = 0.12 * S;
    phoneTop.color.setScalar(reduced ? 1 : 0.72 + 0.28 * Math.max(0, Math.sin(time * 0.9)) ** 6);
    fill.intensity = 0.34 * (0.35 + 0.65 * Math.max(L, lampRLevel));

    // Ambient life: steam, dust, and a slow sway in the curtain.
    for (const p of steam) {
      const u = reduced ? 0.35 : (time * 0.22 + p.phase) % 1;
      p.sprite.position.set(Math.sin(u * 5 + p.phase * 9) * 0.012 * (0.4 + u), 0.09 + u * 0.16, Math.cos(u * 4 + p.phase * 5) * 0.008);
      p.sprite.scale.setScalar(0.03 + u * 0.06);
      p.mat.opacity = Math.sin(u * Math.PI) * 0.16;
    }
    if (!reduced) {
      for (let i = 0; i < DUST; i++) {
        const sd = dustSeed[i];
        dustPos[i * 3] += Math.sin(time * 0.25 + sd) * dt * 0.006;
        dustPos[i * 3 + 1] += dt * (0.004 + (sd % 3) * 0.003);
        dustPos[i * 3 + 2] += Math.cos(time * 0.2 + sd * 2) * dt * 0.004;
        if (dustPos[i * 3 + 1] > TOP + 0.95) dustPos[i * 3 + 1] = TOP;
      }
      dustGeo.attributes.position.needsUpdate = true;
      if (curtain) {
        const cp = curtain.attributes.position;
        for (let i = 0; i < cp.count; i++) {
          const x = cp.getX(i);
          const free = cp.getY(i) < 0 ? 1 : 0.25; // the hem moves more than the top
          cp.setZ(i, Math.sin(x * 46) * 0.028 + Math.sin(x * 13) * 0.02 + Math.sin(time * 0.7 + x * 3.2) * 0.012 * free);
        }
        cp.needsUpdate = true;
      }
    }
    dustMat.opacity = 0.42 * Math.max(L, lampRLevel) * (1 - day * 0.6);
    const dim = 1 - day * 0.55;
    lampRLight.intensity = 0.8 * breathe * lampRLevel;
    shadeGlow.opacity = (0.42 - day * 0.22) * L;
    bulbGlow.opacity = (0.8 - day * 0.35) * lampRLevel;
    bulbCore.opacity = 0.15 + 0.85 * lampRLevel;
    poolWallL.mat.opacity = 0.3 * dim * L;
    poolDeskL.mat.opacity = 0.28 * dim * L;
    poolWallR.mat.opacity = 0.27 * dim * lampRLevel;
    poolDeskR.mat.opacity = 0.22 * dim * lampRLevel;
    (scene.background as THREE.Color).copy(bgDark).lerp(bgLight, day);
    (scene.fog as THREE.Fog).color.copy(scene.background as THREE.Color);

    drawScreen(time, selected?.id === "console");
    renderer.render(scene, camera);
  }
  frame();

  return {
    select(id) {
      const next = byId(id);
      if (next?.id === "console" && selected?.id !== "console") termSince = time;
      selected = next;
      clearHover();
      place();
      dirty = true;
    },
    dispose() {
      cancelAnimationFrame(raf);
      clearInterval(minute);
      io.disconnect();
      ro.disconnect();
      themeWatch.disconnect();
      canvas.removeEventListener("pointerdown", onDown);
      canvas.removeEventListener("pointermove", onMove);
      canvas.removeEventListener("pointerup", onUp);
      canvas.removeEventListener("pointercancel", onUp);
      canvas.removeEventListener("pointerleave", onLeave);
      canvas.removeEventListener("click", onClick);
      canvas.removeEventListener("webglcontextrestored", onRestore);
      disposables.forEach((d) => d.dispose());
      renderer.dispose();
    },
  };
}
