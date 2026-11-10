// The 3D hero: a server rack at night. Every unit with a light on is a piece
// of the site (roles, stack, signals, contact). Geometry and textures are all
// generated here, so there are no model or image downloads and the CSP stays
// 'self'-only. Loaded lazily by Rack.astro, only on devices that can run it.
import * as THREE from "three";
import { site } from "../data/site.ts";
import { experience } from "../data/experience.ts";

const C = {
  ok: "#39e58c",
  warn: "#ffb02e",
  crit: "#ff5f56",
  info: "#62b6ff",
  fg: "#e6ebf2",
  mut: "#8d99ab",
};
const DISPLAY = '"Space Grotesk", system-ui, sans-serif';
const MONO = '"JetBrains Mono", ui-monospace, monospace';

type Led = { mat: THREE.MeshBasicMaterial; glow: THREE.SpriteMaterial; mode: "steady" | "blink" | "activity" | "canary"; phase: number; on: number; boot: number };
type Hot = {
  id: string;
  label: string;
  pos: THREE.Vector3;
  normal: THREE.Vector3;
  dist: number;
  slide?: THREE.Group;
  slideNow?: number;
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
  renderer.toneMappingExposure = 1.15;
  const maxAniso = renderer.capabilities.getMaxAnisotropy();

  const scene = new THREE.Scene();
  const bgDark = new THREE.Color("#05070b");
  const bgLight = new THREE.Color("#1d2632");
  scene.background = bgDark.clone();
  scene.fog = new THREE.Fog(scene.background as THREE.Color, 5, 13);

  const camera = new THREE.PerspectiveCamera(36, 1, 0.1, 40);

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
  const std = (color: string, rough = 0.7, metal = 0.3) =>
    track(new THREE.MeshStandardMaterial({ color, roughness: rough, metalness: metal }));
  function box(w: number, h: number, d: number, mat: THREE.Material | THREE.Material[], x = 0, y = 0, z = 0, parent: THREE.Object3D = scene) {
    const m = new THREE.Mesh(track(new THREE.BoxGeometry(w, h, d)), mat);
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
  const ledGeo = track(new THREE.CircleGeometry(0.006, 12));
  const leds: Led[] = [];
  const farLeds: THREE.PointsMaterial[] = [];
  let bootIndex = 0;
  function led(parent: THREE.Object3D, x: number, y: number, z: number, color: string, mode: Led["mode"] = "steady", size = 1) {
    const mat = track(new THREE.MeshBasicMaterial({ color, toneMapped: false }));
    const m = new THREE.Mesh(ledGeo, mat);
    m.position.set(x, y, z + 0.001);
    m.scale.setScalar(size);
    parent.add(m);
    const glow = track(
      new THREE.SpriteMaterial({ map: glowTex, color, blending: THREE.AdditiveBlending, depthWrite: false, transparent: true, opacity: 0.8 }),
    );
    const s = new THREE.Sprite(glow);
    s.position.set(x, y, z + 0.004);
    s.scale.setScalar(0.07 * size);
    parent.add(s);
    const l: Led = { mat, glow, mode, phase: Math.random() * 10, on: 1, boot: 0.5 + bootIndex++ * 0.035 };
    leds.push(l);
    return l;
  }

  // ── room ───────────────────────────────────────────────────────────────
  const floorTex = tex(256, 256, (g, w, h) => {
    g.fillStyle = "#12161c";
    g.fillRect(0, 0, w, h);
    g.strokeStyle = "#05070a";
    g.lineWidth = 5;
    g.strokeRect(0, 0, w, h);
    g.fillStyle = "rgba(255,255,255,0.025)";
    for (let i = 0; i < 260; i++) g.fillRect(Math.random() * w, Math.random() * h, 2, 2);
  });
  floorTex.wrapS = floorTex.wrapT = THREE.RepeatWrapping;
  floorTex.repeat.set(40, 40);
  const floor = new THREE.Mesh(
    track(new THREE.PlaneGeometry(24, 24)),
    track(new THREE.MeshStandardMaterial({ map: floorTex, roughness: 0.32, metalness: 0.5 })),
  );
  floor.rotation.x = -Math.PI / 2;
  scene.add(floor);

  const WALL_Z = -0.62;
  const wallMat = std("#141a22", 0.95, 0);
  const wallDark = new THREE.Color("#141a22");
  const wallLight = new THREE.Color("#3d4856");
  const wall = new THREE.Mesh(track(new THREE.PlaneGeometry(24, 5)), wallMat);
  wall.position.set(0, 2.5, WALL_Z);
  scene.add(wall);
  // Overhead cable tray with fibre runs.
  box(12, 0.03, 0.34, std("#1b222c", 0.6, 0.7), 0, 2.38, -0.2);
  for (const [i, col] of ["#f2c230", "#f2c230", "#3aa0ff", "#f2c230"].entries()) {
    box(12, 0.018, 0.018, std(col, 0.6, 0), 0, 2.405, -0.32 + i * 0.07);
  }

  // ── the rack ───────────────────────────────────────────────────────────
  const RX = 0.78;
  const RW = 0.62;
  const RH = 1.96;
  const RD = 0.9;
  const FRONT = WALL_Z + 0.05 + RD; // z of the rack's front plane
  const rack = new THREE.Group();
  rack.position.set(RX, 0, FRONT - RD / 2);
  scene.add(rack);
  const frameMat = std("#161b22", 0.5, 0.8);
  const shellMat = std("#0c1015", 0.8, 0.5);
  for (const sx of [-1, 1]) {
    box(0.035, RH, 0.035, frameMat, (sx * (RW - 0.035)) / 2, RH / 2, RD / 2 - 0.0175, rack);
    box(0.012, RH, RD - 0.04, shellMat, (sx * (RW - 0.012)) / 2, RH / 2, -0.02, rack);
  }
  box(RW, 0.04, RD, frameMat, 0, RH - 0.02, 0, rack);
  box(RW, 0.06, RD, frameMat, 0, 0.03, 0, rack);
  box(RW - 0.03, RH - 0.1, 0.01, shellMat, 0, RH / 2, -RD / 2 + 0.02, rack);

  const UW = RW - 0.075; // unit width between the posts
  const UD = 0.74;
  const unitSide = std("#1a2029", 0.55, 0.75);
  const hots: Hot[] = [];
  const hitTargets: THREE.Object3D[] = [];
  const markHot = (o: THREE.Object3D, id: string) => {
    o.userData.hot = id;
    hitTargets.push(o);
  };

  function faceplate(w: number, h: number, draw: (g: CanvasRenderingContext2D, W: number, H: number) => void) {
    const W = 1024;
    const H = Math.round((W * h) / w);
    return tex(W, H, (g) => {
      const grad = g.createLinearGradient(0, 0, 0, H);
      grad.addColorStop(0, "#262d38");
      grad.addColorStop(1, "#171c24");
      g.fillStyle = grad;
      g.fillRect(0, 0, W, H);
      g.strokeStyle = "rgba(255,255,255,0.07)";
      g.lineWidth = 3;
      g.strokeRect(1.5, 1.5, W - 3, H - 3);
      // rack ears + screws
      g.fillStyle = "#11151b";
      g.fillRect(0, 0, 40, H);
      g.fillRect(W - 40, 0, 40, H);
      g.fillStyle = "#3a4350";
      for (const x of [20, W - 20])
        for (const y of [H * 0.22, H * 0.78]) {
          g.beginPath();
          g.arc(x, y, 7, 0, Math.PI * 2);
          g.fill();
        }
      draw(g, W, H);
    });
  }

  function unit(h: number, y: number, face: THREE.Texture) {
    const grp = new THREE.Group();
    grp.position.set(0, y + h / 2, RD / 2 - UD / 2 - 0.004);
    rack.add(grp);
    const front = track(new THREE.MeshStandardMaterial({ map: face, roughness: 0.55, metalness: 0.35 }));
    const body = box(UW, h, UD, [unitSide, unitSide, unitSide, unitSide, front, unitSide], 0, 0, 0, grp);
    return { grp, body, fz: UD / 2 };
  }
  const worldOf = (o: THREE.Object3D, x = 0, y = 0, z = 0) => o.localToWorld(new THREE.Vector3(x, y, z));

  let y = RH - 0.07;
  const gap = 0.012;

  // Patch panel + switch → the stack.
  {
    y -= 0.05;
    const pp = unit(
      0.05,
      y,
      faceplate(UW, 0.05, (g, W, H) => {
        g.fillStyle = "#0a0d11";
        for (let i = 0; i < 24; i++) g.fillRect(70 + i * 37, H * 0.3, 26, H * 0.4);
      }),
    );
    // Patch cords dropping from the panel into the switch below.
    const cordCols = [C.info, "#f2c230", C.info, C.ok, "#f2c230", C.info];
    cordCols.forEach((col, i) => {
      const x0 = -UW / 2 + 0.05 + i * 0.062 + (i % 2) * 0.02;
      const curve = new THREE.CatmullRomCurve3([
        new THREE.Vector3(x0, 0, pp.fz),
        new THREE.Vector3(x0 + 0.01, -0.02, pp.fz + 0.035),
        new THREE.Vector3(x0 + 0.03, -0.055, pp.fz + 0.03),
        new THREE.Vector3(x0 + 0.035, -0.066, pp.fz),
      ]);
      const m = new THREE.Mesh(track(new THREE.TubeGeometry(curve, 12, 0.004, 6)), std(col, 0.6, 0));
      pp.grp.add(m);
    });
    y -= gap + 0.055;
    const sw = unit(
      0.055,
      y,
      faceplate(UW, 0.055, (g, W, H) => {
        g.fillStyle = "#0a0d11";
        for (let i = 0; i < 16; i++) g.fillRect(70 + i * 37, H * 0.42, 26, H * 0.4);
        g.fillStyle = C.mut;
        g.font = `700 26px ${MONO}`;
        g.textAlign = "right";
        g.textBaseline = "middle";
        g.fillText("CORE-SW · STACK", W - 60, H * 0.5);
      }),
    );
    for (let i = 0; i < 16; i++) {
      const x = -UW / 2 + (83 + i * 37) / 1024 * UW;
      led(sw.grp, x, 0.016, sw.fz, i % 5 === 3 ? C.warn : C.ok, "activity", 0.55);
    }
    markHot(sw.body, "stack");
    markHot(pp.body, "stack");
    hots.push({ id: "stack", label: "core switch · stack", pos: worldOf(sw.grp, 0, 0.03, sw.fz), normal: new THREE.Vector3(0, 0, 1), dist: 1.25 });
  }

  // One server per role, newest on top.
  const SH = 0.27;
  experience.forEach((role, i) => {
    y -= gap + SH + (i === 0 ? 0.03 : 0);
    const current = i === 0;
    const u = unit(
      SH,
      y,
      faceplate(UW, SH, (g, W, H) => {
        // intake grille
        g.fillStyle = "#0b0e13";
        g.fillRect(64, 40, 150, H - 80);
        g.fillStyle = "#1d232c";
        for (let r = 0; r < 12; r++) for (let c = 0; c < 6; c++) g.fillRect(74 + c * 23, 52 + r * ((H - 104) / 12), 14, 8);
        // drive bays
        for (let b = 0; b < 4; b++) {
          const bx = W - 64 - 96 * (b % 2 === 0 ? 2 : 1);
          const by = b < 2 ? 44 : H / 2 + 6;
          g.fillStyle = "#0b0e13";
          g.fillRect(bx, by, 84, H / 2 - 50);
          g.strokeStyle = "#333c49";
          g.lineWidth = 2;
          g.strokeRect(bx + 1, by + 1, 82, H / 2 - 52);
        }
        const tx = 250;
        const tw = W - 64 - 200 - tx - 20;
        g.textBaseline = "alphabetic";
        g.textAlign = "left";
        g.fillStyle = C.mut;
        g.font = `500 30px ${MONO}`;
        g.fillText(`U${String(experience.length - i).padStart(2, "0")} · ${role.year.replace(/\s/g, " ")}`, tx, 96);
        g.fillStyle = C.fg;
        const name = role.company.toUpperCase();
        fit(g, name, 700, DISPLAY, 92, tw);
        g.fillText(name, tx, H / 2 + 46);
        g.fillStyle = current ? C.ok : C.mut;
        fit(g, role.title, 500, MONO, 32, tw);
        g.fillText(role.title, tx, H - 70);
      }),
    );
    const lx = -UW / 2 + (250 / 1024) * UW;
    led(u.grp, lx + 0.008, -SH / 2 + 0.026, u.fz, C.ok, current ? "blink" : "steady");
    led(u.grp, lx + 0.03, -SH / 2 + 0.026, u.fz, C.info, "activity", 0.8);
    for (let b = 0; b < 4; b++) {
      const bx = UW / 2 - ((64 + 96 * (b % 2 === 0 ? 2 : 1) - 70) / 1024) * UW;
      led(u.grp, bx, b < 2 ? SH / 2 - 0.03 : -0.012, u.fz, C.ok, current ? "activity" : "steady", 0.5);
    }
    markHot(u.body, `role-${i}`);
    hots.push({
      id: `role-${i}`,
      label: `${role.company} · ${role.year}`,
      pos: worldOf(u.grp, 0, 0, u.fz),
      normal: new THREE.Vector3(0, 0, 1),
      dist: 1.55,
      slide: u.grp,
      slideNow: 0,
    });
  });

  // AIOps: the canary unit.
  {
    y -= gap + 0.085;
    const u = unit(
      0.085,
      y,
      faceplate(UW, 0.085, (g, W, H) => {
        g.textBaseline = "middle";
        g.fillStyle = C.warn;
        g.font = `700 44px ${DISPLAY}`;
        g.fillText(site.learning.toUpperCase(), 120, H / 2 + 2);
        g.fillStyle = C.mut;
        g.font = `500 28px ${MONO}`;
        g.fillText("canary · not in prod yet", 300, H / 2 + 2);
        g.fillStyle = "#0b0e13";
        g.fillRect(W - 260, 18, 200, H - 36);
      }),
    );
    led(u.grp, -UW / 2 + 0.047, 0, u.fz, C.warn, "canary", 1.1);
    markHot(u.body, "aiops");
    hots.push({ id: "aiops", label: "AIOps · canary", pos: worldOf(u.grp, 0, 0, u.fz), normal: new THREE.Vector3(0, 0, 1), dist: 1.2, slide: u.grp, slideNow: 0 });
  }

  // UPS at the bottom → the signals.
  {
    const h = y - gap - 0.075;
    y = 0.07;
    const years = `${new Date().getFullYear() - site.opsStart}`;
    const u = unit(
      h,
      y,
      faceplate(UW, h, (g, W, H) => {
        g.fillStyle = "#0b0e13";
        for (let r = 0; r < 9; r++) g.fillRect(70, 40 + r * ((H - 80) / 9), 360, (H - 80) / 9 - 12);
        // LCD
        const lx = 480;
        const lw = W - lx - 70;
        g.fillStyle = "#04130b";
        g.fillRect(lx, 50, lw, H - 100);
        g.strokeStyle = "#2c3644";
        g.lineWidth = 4;
        g.strokeRect(lx, 50, lw, H - 100);
        g.fillStyle = C.ok;
        g.textBaseline = "alphabetic";
        g.font = `500 28px ${MONO}`;
        g.fillText("TIME IN PRODUCTION", lx + 26, 104);
        g.font = `700 120px ${DISPLAY}`;
        g.fillText(`${years}y`, lx + 24, H - 150);
        g.font = `500 28px ${MONO}`;
        g.fillText("RESTARTS 0", lx + 26, H - 104);
        g.fillText("SIGNALS  nominal", lx + 26, H - 70);
      }),
    );
    led(u.grp, -UW / 2 + 0.05, h / 2 - 0.022, u.fz, C.ok, "steady");
    markHot(u.body, "signals");
    hots.push({ id: "signals", label: "UPS · signals", pos: worldOf(u.grp, 0, 0, u.fz), normal: new THREE.Vector3(0, 0, 1), dist: 1.45 });
  }

  // ── neighbouring racks, receding into the dark ─────────────────────────
  {
    const xs = [1.46, 2.12, 2.78, 3.44, 4.1, 4.76, -2.5, -3.16, -3.82, -4.48];
    const doorTex = tex(128, 512, (g, w, h) => {
      g.fillStyle = "#0b0f14";
      g.fillRect(0, 0, w, h);
      g.fillStyle = "#11161d";
      for (let r = 0; r < 34; r++) g.fillRect(10, 10 + r * 14.6, w - 20, 9);
      g.strokeStyle = "#1c232d";
      g.lineWidth = 4;
      g.strokeRect(2, 2, w - 4, h - 4);
    });
    const doorMat = track(new THREE.MeshStandardMaterial({ map: doorTex, roughness: 0.6, metalness: 0.6 }));
    const side = std("#0b0f14", 0.7, 0.5);
    const groups: number[][] = [[], [], []];
    const colors: number[][] = [[], [], []];
    const col = new THREE.Color();
    for (const x of xs) {
      box(RW, RH, RD, [side, side, side, side, doorMat, side], x, RH / 2, FRONT - RD / 2);
      for (let i = 0; i < 26; i++) {
        const k = Math.floor(Math.random() * 3);
        groups[k].push(x + (Math.random() - 0.5) * (RW - 0.14), 0.15 + Math.random() * (RH - 0.3), FRONT + 0.004);
        col.set(Math.random() < 0.12 ? C.warn : Math.random() < 0.3 ? C.info : C.ok);
        colors[k].push(col.r, col.g, col.b);
      }
    }
    groups.forEach((g, k) => {
      const geo = track(new THREE.BufferGeometry());
      geo.setAttribute("position", new THREE.Float32BufferAttribute(g, 3));
      geo.setAttribute("color", new THREE.Float32BufferAttribute(colors[k], 3));
      const mat = track(
        new THREE.PointsMaterial({ size: 0.035, map: glowTex, vertexColors: true, transparent: true, depthWrite: false, blending: THREE.AdditiveBlending, toneMapped: false }),
      );
      const pts = new THREE.Points(geo, mat);
      pts.userData.k = k;
      scene.add(pts);
      farLeds.push(mat);
    });
  }

  // ── crash cart: console, keyboard, pager ───────────────────────────────
  const cart = new THREE.Group();
  cart.position.set(-0.86, 0, 0.12);
  cart.rotation.y = 0.2;
  scene.add(cart);
  const cartMat = std("#1a2029", 0.5, 0.7);
  const TOP = 0.92;
  box(0.95, 0.03, 0.6, std("#222a35", 0.45, 0.6), 0, TOP, 0, cart);
  box(0.95, 0.025, 0.6, cartMat, 0, 0.32, 0, cart);
  for (const sx of [-1, 1])
    for (const sz of [-1, 1]) {
      box(0.03, TOP, 0.03, cartMat, sx * 0.45, TOP / 2, sz * 0.27, cart);
      const wheel = new THREE.Mesh(track(new THREE.CylinderGeometry(0.035, 0.035, 0.025, 14)), std("#07090c", 0.9, 0));
      wheel.rotation.z = Math.PI / 2;
      wheel.position.set(sx * 0.45, 0.035, sz * 0.27);
      cart.add(wheel);
    }
  // spare gear on the lower shelf
  box(0.42, 0.09, 0.4, std("#11161d", 0.6, 0.6), -0.2, 0.38, 0, cart);
  box(0.22, 0.16, 0.3, std("#0d1116", 0.7, 0.4), 0.26, 0.415, 0.02, cart);

  // Console monitor: a chunky KVM display with a live terminal on it.
  const SW = 0.56;
  const SHt = 0.4;
  const mon = new THREE.Group();
  mon.position.set(-0.08, TOP + 0.015, -0.08);
  cart.add(mon);
  const monMat = std("#20262f", 0.5, 0.4);
  box(0.26, 0.02, 0.2, monMat, 0, 0.01, 0, mon);
  box(0.06, 0.09, 0.05, monMat, 0, 0.06, -0.02, mon);
  const monBody = box(SW + 0.06, SHt + 0.07, 0.07, monMat, 0, 0.1 + SHt / 2 + 0.02, 0, mon);
  const scr = document.createElement("canvas");
  scr.width = 1024;
  scr.height = Math.round((1024 * SHt) / SW);
  const sg = scr.getContext("2d")!;
  const scrTex = track(new THREE.CanvasTexture(scr));
  scrTex.colorSpace = THREE.SRGBColorSpace;
  scrTex.anisotropy = maxAniso;
  const screen = new THREE.Mesh(track(new THREE.PlaneGeometry(SW, SHt)), track(new THREE.MeshBasicMaterial({ map: scrTex, toneMapped: false })));
  screen.position.set(0, 0.1 + SHt / 2 + 0.03, 0.036);
  mon.add(screen);
  led(mon, SW / 2 - 0.01, 0.1 + 0.012, 0.036, C.ok, "steady", 0.6);
  markHot(monBody, "console");
  markHot(screen, "console");

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
  let lastTermKey = "";
  function drawTerm(time: number) {
    const prog = reduced ? termChars : Math.max(0, (time - 1.6) * 34);
    const caret = Math.floor(time * 2) % 2 === 0;
    const key = `${Math.min(prog, termChars) | 0}:${caret}`;
    if (key === lastTermKey) return;
    lastTermKey = key;
    const W = scr.width;
    const H = scr.height;
    sg.fillStyle = "#050a0d";
    sg.fillRect(0, 0, W, H);
    sg.fillStyle = "#0e151c";
    sg.fillRect(0, 0, W, 58);
    sg.textBaseline = "middle";
    sg.font = `500 26px ${MONO}`;
    sg.fillStyle = C.mut;
    sg.fillText(`${site.handle}@prod: ~`, 28, 30);
    sg.textAlign = "right";
    sg.fillStyle = C.ok;
    sg.fillText(`● ${site.region}`, W - 28, 30);
    sg.textAlign = "left";
    const LH = 52;
    let yy = 104;
    let left = prog;
    let done = true;
    sg.font = `500 33px ${MONO}`;
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
    // scanlines
    sg.fillStyle = "rgba(0,0,0,0.16)";
    for (let s = 0; s < H; s += 4) sg.fillRect(0, s, W, 1);
    scrTex.needsUpdate = true;
  }
  drawTerm(0);

  // Keyboard.
  const kbTex = tex(512, 180, (g, w, h) => {
    g.fillStyle = "#171c23";
    g.fillRect(0, 0, w, h);
    g.fillStyle = "#2a323e";
    for (let r = 0; r < 5; r++) for (let c = 0; c < 15; c++) g.fillRect(12 + c * 33 + (r % 2) * 6, 12 + r * 32, 26, 25);
  });
  const kbTop = track(new THREE.MeshStandardMaterial({ map: kbTex, roughness: 0.7, metalness: 0.2 }));
  box(0.4, 0.018, 0.14, [cartMat, cartMat, kbTop, cartMat, cartMat, cartMat], -0.1, TOP + 0.024, 0.19, cart);

  // Pager → contact.
  const pager = new THREE.Group();
  pager.position.set(0.3, TOP + 0.027, 0.16);
  pager.rotation.y = -0.35;
  cart.add(pager);
  const pagerTop = track(
    new THREE.MeshStandardMaterial({
      map: tex(256, 180, (g, w, h) => {
        g.fillStyle = "#1c222b";
        g.fillRect(0, 0, w, h);
        g.fillStyle = "#b9d6a3";
        g.fillRect(22, 22, w - 44, 84);
        g.fillStyle = "#16230f";
        g.font = `700 40px ${MONO}`;
        g.textBaseline = "middle";
        g.fillText("PAGE ME", 36, 66);
        g.fillStyle = "#39424f";
        for (let i = 0; i < 3; i++) g.fillRect(22 + i * 54, 128, 42, 28);
      }),
      roughness: 0.5,
      metalness: 0.2,
    }),
  );
  const pagerMat = std("#1c222b", 0.5, 0.2);
  const pagerBody = box(0.115, 0.024, 0.08, [pagerMat, pagerMat, pagerTop, pagerMat, pagerMat, pagerMat], 0, 0, 0, pager);
  const pagerLed = new THREE.Group();
  pagerLed.rotation.x = -Math.PI / 2;
  pagerLed.position.set(0.04, 0.0125, 0.024);
  pager.add(pagerLed);
  led(pagerLed, 0, 0, 0, C.crit, "canary", 0.8);
  const pagerHit = box(0.2, 0.12, 0.16, new THREE.MeshBasicMaterial({ visible: false }), 0, 0.04, 0, pager);
  markHot(pagerBody, "contact");
  markHot(pagerHit, "contact");

  // Console cable from the cart to the rack.
  {
    const a = worldOf(mon, 0.2, 0.05, -0.04);
    const b = new THREE.Vector3(RX - RW / 2 + 0.03, 1.05, FRONT - 0.02);
    const curve = new THREE.CatmullRomCurve3([a, new THREE.Vector3(a.x + 0.25, 0.35, a.z - 0.05), new THREE.Vector3(b.x - 0.3, 0.08, b.z + 0.12), new THREE.Vector3(b.x - 0.03, 0.5, b.z + 0.03), b]);
    scene.add(new THREE.Mesh(track(new THREE.TubeGeometry(curve, 48, 0.007, 8)), std("#2b7fd6", 0.5, 0)));
  }

  // Whiteboard → principles.
  const board = new THREE.Mesh(
    track(new THREE.PlaneGeometry(1.4, 0.75)),
    track(
      new THREE.MeshStandardMaterial({
        map: tex(1200, 640, (g, w, h) => {
          g.fillStyle = "#dfe5ea";
          g.fillRect(0, 0, w, h);
          g.strokeStyle = "#7c8794";
          g.lineWidth = 16;
          g.strokeRect(8, 8, w - 16, h - 16);
          g.fillStyle = "#b02a2a";
          g.font = `700 44px ${MONO}`;
          g.fillText("HOUSE RULES", 70, 110);
          g.fillRect(70, 128, 300, 5);
          site.principles.forEach((p, i) => {
            g.save();
            g.translate(70, 230 + i * 130);
            g.rotate((i - 1) * 0.012);
            g.fillStyle = i === 1 ? "#0b5cad" : "#18222d";
            fit(g, p, 600, DISPLAY, 62, w - 150);
            g.fillText(`${i + 1}. ${p}`, 0, 0);
            g.restore();
          });
        }),
        roughness: 0.4,
        metalness: 0,
        emissive: "#ffffff",
        emissiveIntensity: 0,
      }),
    ),
  );
  (board.material as THREE.MeshStandardMaterial).emissiveMap = (board.material as THREE.MeshStandardMaterial).map;
  board.position.set(-1.0, 1.93, WALL_Z + 0.012);
  scene.add(board);
  markHot(board, "principles");

  scene.updateMatrixWorld(true);
  const cartN = new THREE.Vector3(0, 0, 1).applyAxisAngle(new THREE.Vector3(0, 1, 0), cart.rotation.y);
  hots.push(
    { id: "console", label: "console · about", pos: screen.getWorldPosition(new THREE.Vector3()), normal: cartN, dist: 1.35 },
    { id: "contact", label: "pager · contact", pos: pager.getWorldPosition(new THREE.Vector3()), normal: new THREE.Vector3(0, 0.75, 0.66).normalize(), dist: 0.85 },
    { id: "principles", label: "whiteboard · house rules", pos: board.position.clone(), normal: new THREE.Vector3(0, 0, 1), dist: 2.5 },
  );

  // ── light ──────────────────────────────────────────────────────────────
  const hemi = new THREE.HemisphereLight("#9fb4d6", "#0a0d12", 1.0);
  scene.add(hemi);
  const key = new THREE.DirectionalLight("#bcd2ff", 1.7);
  key.position.set(-1.5, 4, 5);
  scene.add(key);
  const monLight = new THREE.PointLight("#58e0a0", 0.9, 3, 1.6);
  monLight.position.copy(screen.getWorldPosition(new THREE.Vector3())).addScaledVector(cartN, 0.35);
  scene.add(monLight);
  const rackLight = new THREE.PointLight("#3ad98a", 0.8, 3, 1.8);
  rackLight.position.set(RX, 1.1, FRONT + 0.6);
  scene.add(rackLight);
  // Cold aisle strip light: rakes down the front of the rack row.
  const aisle = new THREE.SpotLight("#a9c8ff", 14, 6, 0.75, 0.9, 1.3);
  aisle.position.set(RX - 0.2, 3.1, FRONT + 1.5);
  aisle.target.position.set(RX, 0.9, FRONT);
  scene.add(aisle, aisle.target);
  const rim = new THREE.PointLight("#4f7dff", 1.4, 5, 1.5);
  rim.position.set(-2.2, 1.6, 0.9);
  scene.add(rim);
  const boardLight = new THREE.SpotLight("#ffe9c4", 2.2, 4, 0.6, 0.7, 1.4);
  boardLight.position.set(-1.0, 2.36, 0.5);
  boardLight.target = board;
  scene.add(boardLight);

  // ── camera ─────────────────────────────────────────────────────────────
  const home = { pos: new THREE.Vector3(), look: new THREE.Vector3() };
  const want = { pos: new THREE.Vector3(), look: new THREE.Vector3() };
  const look = new THREE.Vector3();
  let aspect = 1;
  let selected: Hot | null = null;
  const tanV = Math.tan(THREE.MathUtils.degToRad(camera.fov / 2));

  function place() {
    const portrait = aspect < 0.9;
    // Fit ~3.1 m of scene width (2.1 m on phones: rack + console only).
    const dist = Math.max(3.8, (portrait ? 1.1 : 1.6) / (tanV * aspect));
    const cx = portrait ? 0.12 : -0.2;
    // On phones the name sits above the scene, so the room is framed low.
    home.look.set(cx, portrait ? 1.5 : 1.14, 0);
    home.pos.set(cx - 0.2, portrait ? 1.62 : 1.34, dist);
    if (!selected) {
      want.pos.copy(home.pos);
      want.look.copy(home.look);
      return;
    }
    const h = selected;
    const d = h.dist * (portrait ? 1.25 : 1);
    const p = h.pos.clone();
    if (h.slide) p.z += 0.3;
    const right = new THREE.Vector3(h.normal.z, 0, -h.normal.x).normalize();
    const shift = new THREE.Vector3();
    if (portrait) shift.y = -0.24 * 2 * d * tanV; // sheet covers the bottom half
    else shift.copy(right).multiplyScalar(0.22 * 2 * d * tanV * aspect); // panel on the right
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

  function pick(e: PointerEvent | MouseEvent) {
    const r = canvas.getBoundingClientRect();
    ptr.set(((e.clientX - r.left) / r.width) * 2 - 1, -((e.clientY - r.top) / r.height) * 2 + 1);
    ray.setFromCamera(ptr, camera);
    const hit = ray.intersectObjects(hitTargets, false)[0];
    return hit ? byId(hit.object.userData.hot) : null;
  }
  function onMove(e: PointerEvent) {
    if (e.pointerType === "touch") return;
    const h = pick(e);
    par.copy(ptr);
    if (h !== hovered) {
      hovered = h;
      canvas.style.cursor = h ? "pointer" : "";
    }
    on.hover(h && h !== selected ? h.label : null, e.clientX, e.clientY);
    dirty = true;
  }
  function onLeave() {
    hovered = null;
    par.set(0, 0);
    on.hover(null, 0, 0);
    dirty = true;
  }
  function onClick(e: MouseEvent) {
    const h = pick(e);
    on.hover(null, 0, 0);
    on.select(h && h !== selected ? h.id : null);
  }
  canvas.addEventListener("pointermove", onMove);
  canvas.addEventListener("pointerleave", onLeave);
  canvas.addEventListener("click", onClick);
  // After a lost GPU context comes back, the reduced-motion path (which only
  // draws on change) needs telling that the canvas is blank.
  const onRestore = () => {
    dirty = true;
  };
  canvas.addEventListener("webglcontextrestored", onRestore);

  // ── loop ───────────────────────────────────────────────────────────────
  let lights = document.documentElement.getAttribute("data-theme") === "light" ? 1 : 0;
  const themeWatch = new MutationObserver(() => (dirty = true));
  themeWatch.observe(document.documentElement, { attributes: true, attributeFilter: ["data-theme"] });

  let visible = true;
  const io = new IntersectionObserver((es) => {
    visible = es[0].isIntersecting;
  });
  io.observe(stage);
  const ro = new ResizeObserver(resize);
  ro.observe(stage);

  resize();
  // Start pulled back and dolly in.
  camera.position.copy(home.pos).add(new THREE.Vector3(reduced ? 0 : -0.5, reduced ? 0 : 0.25, reduced ? 0 : 2.2));
  look.copy(home.look);

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
    const px = selected || reduced ? 0 : par.x * 0.16;
    const py = selected || reduced ? 0 : par.y * 0.07;
    camera.position.x += (want.pos.x + px - camera.position.x) * k;
    camera.position.y += (want.pos.y + py - camera.position.y) * k;
    camera.position.z += (want.pos.z - camera.position.z) * k;
    look.lerp(want.look, k);
    camera.lookAt(look);

    // units slide out on hover / select
    for (const h of hots) {
      if (!h.slide) continue;
      const target = h === selected ? 0.3 : h === hovered ? 0.035 : 0;
      h.slideNow! += (target - h.slideNow!) * (reduced ? 1 : 1 - Math.exp(-dt * 7));
      h.slide.position.z = RD / 2 - UD / 2 - 0.004 + h.slideNow!;
    }

    // LEDs
    for (const l of leds) {
      let v = 1;
      if (!reduced) {
        if (time < l.boot) v = 0;
        else if (l.mode === "blink") v = Math.sin(time * 3 + l.phase) > -0.2 ? 1 : 0.25;
        else if (l.mode === "activity") v = Math.sin(time * (9 + (l.phase % 7)) + l.phase) * Math.sin(time * 2.3 + l.phase * 3) > -0.15 ? 1 : 0.12;
        else if (l.mode === "canary") v = 0.35 + 0.65 * Math.abs(Math.sin(time * 1.6 + l.phase));
      }
      l.mat.color.copy(l.glow.color).multiplyScalar(0.25 + 0.75 * v);
      l.glow.opacity = 0.85 * v;
    }
    farLeds.forEach((m, i) => {
      m.opacity = reduced ? 0.8 : 0.45 + 0.55 * (Math.sin(time * (1.7 + i * 1.3) + i * 2) > 0 ? 1 : 0.3);
    });

    // "lights on" for the light theme
    const wantLights = document.documentElement.getAttribute("data-theme") === "light" ? 1 : 0;
    lights += (wantLights - lights) * (reduced ? 1 : 1 - Math.exp(-dt * 4));
    hemi.intensity = 1.0 + lights * 2.0;
    key.intensity = 1.7 + lights * 1.6;
    (scene.background as THREE.Color).copy(bgDark).lerp(bgLight, lights);
    (scene.fog as THREE.Fog).color.copy(scene.background as THREE.Color);
    wallMat.color.copy(wallDark).lerp(wallLight, lights);

    drawTerm(time);
    renderer.render(scene, camera);
  }
  frame();

  return {
    select(id) {
      selected = byId(id);
      place();
      dirty = true;
    },
    dispose() {
      cancelAnimationFrame(raf);
      io.disconnect();
      ro.disconnect();
      themeWatch.disconnect();
      canvas.removeEventListener("pointermove", onMove);
      canvas.removeEventListener("pointerleave", onLeave);
      canvas.removeEventListener("click", onClick);
      canvas.removeEventListener("webglcontextrestored", onRestore);
      disposables.forEach((d) => d.dispose());
      renderer.dispose();
    },
  };
}
