// The 3D hero: a desk in the evening, lit by two warm lamps and a monitor.
// Things on it work the way they do on a real desk: the monitor unlocks to a
// desktop of files, both lamps switch, the standing desk rises, the keys dip
// as you type. Objects with a soft glow above them open a piece of the site.
// Geometry and textures are all generated here, so there are no model or
// image downloads and the CSP stays 'self'-only. Loaded lazily by Rack.astro,
// only on devices that can run it.
import * as THREE from "three";
import { RoomEnvironment } from "three/examples/jsm/environments/RoomEnvironment.js";
import { RoundedBoxGeometry } from "three/examples/jsm/geometries/RoundedBoxGeometry.js";
import { EffectComposer } from "three/examples/jsm/postprocessing/EffectComposer.js";
import { OutputPass } from "three/examples/jsm/postprocessing/OutputPass.js";
import { RenderPass } from "three/examples/jsm/postprocessing/RenderPass.js";
import { ShaderPass } from "three/examples/jsm/postprocessing/ShaderPass.js";
import { UnrealBloomPass } from "three/examples/jsm/postprocessing/UnrealBloomPass.js";
import { site } from "../data/site.ts";
import { experience } from "../data/experience.ts";
import { deskFiles, dockFiles } from "../data/desktop.ts";

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

/** Where the monitor's screen sits on the stage, in CSS pixels. */
export type ScreenRect = { x: number; y: number; w: number; h: number };

export interface RackController {
  select(id: string | null): void;
  /** The monitor's wallpaper, for the full-stage desktop on phones. */
  wallpaper: HTMLCanvasElement;
  dispose(): void;
}

export async function initRack(
  stage: HTMLElement,
  canvas: HTMLCanvasElement,
  on: {
    select(id: string | null): void;
    hover(label: string | null, x: number, y: number): void;
    /** Called every frame while the unlocked screen is in use; null when it is not. */
    screen(rect: ScreenRect | null): void;
  },
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
  // Phones get a lighter pipeline: lower pixel ratio, smaller shadow maps.
  const small = matchMedia("(max-width: 760px)").matches;
  renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, small ? 1.5 : 2));
  renderer.outputColorSpace = THREE.SRGBColorSpace;
  renderer.toneMapping = THREE.ACESFilmicToneMapping;
  renderer.toneMappingExposure = 1.0;
  renderer.shadowMap.enabled = true;
  renderer.shadowMap.type = THREE.PCFSoftShadowMap;
  const maxAniso = renderer.capabilities.getMaxAnisotropy();

  const scene = new THREE.Scene();
  const bgDark = new THREE.Color("#0c0907");
  const bgLight = new THREE.Color("#8d8377");
  scene.background = bgDark.clone();
  scene.fog = new THREE.Fog(scene.background as THREE.Color, 6, 14);
  // The desk top and everything on it hang off `rig`, so the desk can rise.
  // `root` is where the helpers below add things: the room, then the rig.
  const rig = new THREE.Group();
  scene.add(rig);
  let root: THREE.Object3D = scene;

  const camera = new THREE.PerspectiveCamera(30, 1, 0.05, 40);

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
  function box(w: number, h: number, d: number, mat: THREE.Material | THREE.Material[], x = 0, y = 0, z = 0, parent: THREE.Object3D = root) {
    const m = new THREE.Mesh(track(new THREE.BoxGeometry(w, h, d)), mat);
    m.position.set(x, y, z);
    parent.add(m);
    return m;
  }
  function rbox(w: number, h: number, d: number, r: number, mat: THREE.Material, x = 0, y = 0, z = 0, parent: THREE.Object3D = root) {
    const m = new THREE.Mesh(track(new RoundedBoxGeometry(w, h, d, 3, r)), mat);
    m.position.set(x, y, z);
    parent.add(m);
    return m;
  }
  function cyl(rt: number, rb: number, h: number, mat: THREE.Material, x = 0, y = 0, z = 0, parent: THREE.Object3D = root, seg = 24, open = false) {
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
  function disc(w: number, d: number, x: number, y: number, z: number, color: string, opacity: number, additive: boolean, parent: THREE.Object3D = root) {
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
  const shadow = (w: number, d: number, x: number, z: number, y = TOP + 0.0052, o = 0.5) => disc(w, d, x, y, z, "#000000", o * 0.45, false);

  const hots: Hot[] = [];
  const hitTargets: THREE.Object3D[] = [];
  const markHot = (o: THREE.Object3D, id: string) => {
    o.userData.hot = id;
    hitTargets.push(o);
  };
  /** An invisible, generous click target around small objects. */
  const hitMat = track(new THREE.MeshBasicMaterial({ visible: false }));
  const hitBox = (w: number, h: number, d: number, x: number, y: number, z: number, id: string, parent: THREE.Object3D = root) =>
    markHot(box(w, h, d, hitMat, x, y, z, parent), id);

  // Soft reflections on metal, glass and glazed surfaces, from a generated
  // room (no image download).
  {
    const pmrem = new THREE.PMREMGenerator(renderer);
    const room = new RoomEnvironment();
    const env = track(pmrem.fromScene(room, 0.04).texture);
    scene.environment = env;
    scene.environmentIntensity = 0.05;
    room.dispose();
    pmrem.dispose();
  }

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

  const wallMat = track(
    new THREE.MeshStandardMaterial({
      color: "#e3d6c2",
      roughness: 0.97,
      map: tex(512, 512, (g, w, h) => {
        g.fillStyle = "#ffffff";
        g.fillRect(0, 0, w, h);
        // faint roller marks and mottling in the paint
        for (let i = 0; i < 2600; i++) {
          g.fillStyle = `rgba(${Math.random() < 0.5 ? "0,0,0" : "255,255,255"},${Math.random() * 0.014})`;
          g.fillRect(Math.random() * w, Math.random() * h, 2 + Math.random() * 26, 1 + Math.random() * 3);
        }
      }),
    }),
  );
  (wallMat.map as THREE.Texture).wrapS = (wallMat.map as THREE.Texture).wrapT = THREE.RepeatWrapping;
  (wallMat.map as THREE.Texture).repeat.set(10, 3);
  const wall = new THREE.Mesh(track(new THREE.PlaneGeometry(16, 4.2)), wallMat);
  wall.position.set(0, 2.1, WALL_Z);
  scene.add(wall);
  box(16, 0.09, 0.015, std("#f1ede6", 0.7), 0, 0.045, WALL_Z + 0.008);
  // Outlet under the desk. The power lead hangs to it and pays out as the
  // desk rises.
  box(0.07, 0.11, 0.008, std("#f4f1ea", 0.6), 0.08, 0.42, WALL_Z + 0.005);
  const lead = new THREE.Mesh(new THREE.BufferGeometry(), std("#ecebe6", 0.6));
  scene.add(lead);
  track({ dispose: () => lead.geometry.dispose() });
  function hangLead(y: number) {
    lead.geometry.dispose();
    lead.geometry = new THREE.TubeGeometry(
      new THREE.CatmullRomCurve3([
        new THREE.Vector3(-0.02, TOP - 0.03 + y, -0.3),
        new THREE.Vector3(-0.04, 0.5 + y * 0.45, -0.33),
        new THREE.Vector3(0.0, 0.3 + y * 0.12, -0.36),
        new THREE.Vector3(0.07, 0.36, WALL_Z + 0.02),
        new THREE.Vector3(0.08, 0.42, WALL_Z + 0.012),
      ]),
      40,
      0.004,
      6,
    );
  }
  hangLead(0);

  // Curtain on the right: a pleated sheet from ceiling to floor. It sways.
  let curtain: THREE.PlaneGeometry | null = null;
  {
    const geo = track(new THREE.PlaneGeometry(1.5, 3.2, 90, 1));
    const p = geo.attributes.position;
    for (let i = 0; i < p.count; i++) p.setZ(i, Math.sin(p.getX(i) * 46) * 0.028 + Math.sin(p.getX(i) * 13) * 0.02);
    geo.computeVertexNormals();
    // A little dusk comes through the fabric from the window behind it.
    const m = new THREE.Mesh(
      geo,
      track(new THREE.MeshStandardMaterial({ color: "#7c8ba3", roughness: 0.95, side: THREE.DoubleSide, emissive: "#22355c", emissiveIntensity: 0.3 })),
    );
    m.position.set(1.56, 1.6, WALL_Z + 0.2);
    scene.add(m);
    curtain = geo;
  }

  // ── desk ───────────────────────────────────────────────────────────────
  // A standing desk. The feet and outer columns stay on the floor; the top,
  // the inner columns and everything on the desk ride on the rig.
  const DW = 1.44;
  const DD = 0.74;
  const RISE = 0.36; // sitting to standing
  const white = std("#f3f1ec", 0.55);
  for (const sx of [-1, 1]) {
    box(0.075, 0.024, 0.62, white, sx * 0.58, 0.012, 0);
    rbox(0.082, 0.6, 0.056, 0.008, white, sx * 0.58, 0.32, -0.02);
  }
  disc(2.3, 1.5, 0, 0.004, 0.02, "#000000", 0.55, false);
  disc(1.9, 0.5, 0, 0.5, WALL_Z + 0.012, "#000000", 0.28, false).mesh.rotation.x = 0;
  root = rig;
  rbox(DW, 0.026, DD, 0.012, white, 0, TOP - 0.013, 0);
  for (const sx of [-1, 1]) {
    rbox(0.064, 0.62, 0.04, 0.006, std("#e2dfd8", 0.45), sx * 0.58, TOP - 0.36, -0.02);
    box(0.09, 0.03, 0.5, white, sx * 0.58, TOP - 0.041, -0.02);
  }
  box(1.1, 0.03, 0.06, white, 0, TOP - 0.041, -0.02);
  // Desk mat.
  box(
    0.94,
    0.004,
    0.37,
    track(
      new THREE.MeshStandardMaterial({
        color: "#1d2622",
        roughness: 0.8,
        // leather grain
        bumpMap: tex(256, 256, (g, w, h) => {
          g.fillStyle = "#808080";
          g.fillRect(0, 0, w, h);
          for (let i = 0; i < 5000; i++) {
            g.fillStyle = Math.random() < 0.5 ? "rgba(0,0,0,0.25)" : "rgba(255,255,255,0.25)";
            g.fillRect(Math.random() * w, Math.random() * h, 1.5, 1.5);
          }
        }),
        bumpScale: 0.6,
      }),
    ),
    0,
    TOP + 0.002,
    0.14,
  );
  {
    // Stitched edge of the mat.
    const stitch = std("#3b4a43", 0.9);
    for (const sz of [-1, 1]) box(0.92, 0.0006, 0.0025, stitch, 0, TOP + 0.0044, 0.14 + sz * 0.176);
    for (const sx of [-1, 1]) box(0.0025, 0.0006, 0.352, stitch, sx * 0.461, TOP + 0.0044, 0.14);
  }
  // Height controller under the front-right edge. Its display shows the
  // desk height, and a click on it raises or lowers the desk.
  const ctrlScr = document.createElement("canvas");
  ctrlScr.width = 128;
  ctrlScr.height = 40;
  const ctrlTex = track(new THREE.CanvasTexture(ctrlScr));
  ctrlTex.colorSpace = THREE.SRGBColorSpace;
  function drawCtrl(y: number) {
    const g = ctrlScr.getContext("2d")!;
    g.fillStyle = "#0d0f12";
    g.fillRect(0, 0, 128, 40);
    g.fillStyle = "#ffcf8a";
    g.font = `700 28px ${MONO}`;
    g.textAlign = "center";
    g.textBaseline = "middle";
    g.fillText(`${Math.round((TOP + y) * 100)} cm`, 64, 22);
    ctrlTex.needsUpdate = true;
  }
  {
    const ctrl = new THREE.Group();
    ctrl.position.set(0.56, TOP - 0.037, 0.35);
    rig.add(ctrl);
    rbox(0.12, 0.022, 0.05, 0.004, std("#e9e6e0", 0.5), 0, 0, 0, ctrl);
    const face = new THREE.Mesh(track(new THREE.PlaneGeometry(0.045, 0.014)), track(new THREE.MeshBasicMaterial({ map: ctrlTex, toneMapped: false })));
    face.position.set(-0.03, 0, 0.0252);
    ctrl.add(face);
    const btn = std("#9aa0a6", 0.5);
    for (const bx of [0.012, 0.03, 0.048]) box(0.012, 0.009, 0.003, btn, bx, 0, 0.026, ctrl);
    const hit = box(0.18, 0.07, 0.1, hitMat, 0, 0, 0.012, ctrl);
    hit.userData.toggle = "desk";
    hitTargets.push(hit);
    drawCtrl(0);
  }

  const worldOf = (o: THREE.Object3D, x = 0, y = 0, z = 0) => o.localToWorld(new THREE.Vector3(x, y, z));

  // ── monitor → about ────────────────────────────────────────────────────
  const SW = 0.62;
  const SH = 0.36;
  const mon = new THREE.Group();
  mon.position.set(0, TOP, -0.2);
  rig.add(mon);
  const dark = std("#17191c", 0.5, 0.3);
  rbox(0.34, 0.012, 0.24, 0.005, dark, 0, 0.006, 0.02, mon);
  cyl(0.02, 0.02, 0.3, std("#b9bdc2", 0.3, 0.9), 0, 0.16, -0.03, mon);
  const SCY = 0.15 + SH / 2;
  const monBody = rbox(SW + 0.014, SH + 0.022, 0.028, 0.006, dark, 0, SCY - 0.004, 0, mon);
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
  {
    // The screen is glass: a faint sheen across one corner, and a webcam dot.
    const sheen = new THREE.Mesh(
      track(new THREE.PlaneGeometry(SW, SH)),
      track(
        new THREE.MeshBasicMaterial({
          map: tex(256, 256, (g, w, h) => {
            const gr = g.createLinearGradient(0, 0, w * 0.8, h);
            gr.addColorStop(0, "rgba(255,255,255,0.09)");
            gr.addColorStop(0.3, "rgba(255,255,255,0.02)");
            gr.addColorStop(0.45, "rgba(255,255,255,0)");
            g.fillStyle = gr;
            g.fillRect(0, 0, w, h);
          }),
          transparent: true,
          depthWrite: false,
          toneMapped: false,
        }),
      ),
    );
    sheen.position.set(0, SCY, 0.0149);
    mon.add(sheen);
    cyl(0.0022, 0.0022, 0.001, std("#05060a", 0.2, 0.6), 0, SCY + SH / 2 + 0.0045, 0.0142, mon, 12).rotation.x = Math.PI / 2;
  }
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
    rig.add(new THREE.Mesh(track(new THREE.TubeGeometry(c, 30, 0.0022, 6)), std("#111214", 0.6)));
  }

  // Sticky notes along the monitor's chin → house rules.
  const notes = new THREE.Group();
  notes.position.set(0, 0.139, 0.0158);
  mon.add(notes);
  site.principles.forEach((rule, i) => {
    const N = 0.076;
    const geo = track(new THREE.PlaneGeometry(N, N, 1, 8));
    const gp = geo.attributes.position;
    // Stuck by the top edge; the free end curls toward the room.
    for (let j = 0; j < gp.count; j++) {
      const v = 0.5 - gp.getY(j) / N;
      gp.setZ(j, v * v * (0.009 + (i % 2) * 0.005));
    }
    geo.computeVertexNormals();
    const paperCol = ["#ffe066", "#ff9db0", "#8fdcff"][i % 3];
    const m = new THREE.Mesh(
      geo,
      track(
        new THREE.MeshStandardMaterial({
          roughness: 0.92,
          side: THREE.DoubleSide,
          map: tex(384, 384, (g, w, h) => {
            g.fillStyle = paperCol;
            g.fillRect(0, 0, w, h);
            const strip = g.createLinearGradient(0, 0, 0, 70);
            strip.addColorStop(0, "rgba(0,0,0,0.1)");
            strip.addColorStop(1, "rgba(0,0,0,0)");
            g.fillStyle = strip;
            g.fillRect(0, 0, w, 70);
            g.fillStyle = "rgba(30,28,24,0.9)";
            g.textBaseline = "alphabetic";
            g.font = `700 22px ${MONO}`;
            g.fillText(`rule ${i + 1}`, 34, 78);
            g.font = `700 42px ${DISPLAY}`;
            let line = "";
            let y = 144;
            for (const word of rule.split(" ")) {
              const next = line ? `${line} ${word}` : word;
              if (line && g.measureText(next).width > w - 68) {
                g.fillText(line, 34, y);
                y += 52;
                line = word;
              } else line = next;
            }
            g.fillText(line, 34, y);
          }),
        }),
      ),
    );
    m.position.set((i - (site.principles.length - 1) / 2) * 0.088, -0.035, i * 0.0005);
    m.rotation.z = [0.05, -0.035, 0.03][i % 3];
    notes.add(m);
    markHot(m, "principles");
  });

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
  const initials = site.name
    .split(" ")
    .map((s) => s[0])
    .join("")
    .slice(0, 2)
    .toUpperCase();
  const fmtDate = new Intl.DateTimeFormat("en-CA", { weekday: "short", month: "short", day: "numeric" });
  function drawLock(now: Date, dots: number) {
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
    // Password field: a hint until the visitor clicks, then the dots.
    sg.fillStyle = "rgba(255,255,255,0.26)";
    sg.beginPath();
    sg.roundRect(W / 2 - 84, H - 60, 168, 26, 13);
    sg.fill();
    sg.fillStyle = "rgba(255,255,255,0.92)";
    if (dots > 0) {
      for (let i = 0; i < dots; i++) {
        sg.beginPath();
        sg.arc(W / 2 - 61 + i * 17.5, H - 47, 4, 0, Math.PI * 2);
        sg.fill();
      }
    } else {
      sg.font = `500 12.5px ${DISPLAY}`;
      sg.fillText("click to unlock", W / 2, H - 42.5);
    }
    sg.textAlign = "left";
  }

  // The unlocked desktop as the camera sees it from across the room. Up
  // close, DeskOS.astro lays the real, clickable one over the screen at the
  // same coordinates, and the canvas keeps only the wallpaper.
  const fmtBar = new Intl.DateTimeFormat("en-CA", { weekday: "short", month: "short", day: "numeric", hour: "numeric", minute: "2-digit" });
  function glyph(kind: string, x: number, y: number, w: number, h: number) {
    const g = sg;
    g.save();
    g.translate(x, y);
    g.scale(w / 44, h / 52);
    g.shadowColor = "rgba(0,0,0,0.4)";
    g.shadowBlur = 5;
    g.shadowOffsetY = 2;
    if (kind === "dir") {
      g.fillStyle = "#5aa9f0";
      g.beginPath();
      g.roundRect(3, 11, 38, 33, 3);
      g.fill();
      g.shadowColor = "transparent";
      g.fillStyle = "#7fc1ff";
      g.beginPath();
      g.roundRect(3, 21, 38, 23, 3);
      g.fill();
    } else if (kind === "term") {
      g.fillStyle = "#15181c";
      g.beginPath();
      g.roundRect(3, 8, 38, 36, 7);
      g.fill();
      g.shadowColor = "transparent";
      g.strokeStyle = C.ok;
      g.lineWidth = 2.6;
      g.lineCap = "round";
      g.lineJoin = "round";
      g.beginPath();
      g.moveTo(11, 20);
      g.lineTo(17, 26);
      g.lineTo(11, 32);
      g.moveTo(21, 33);
      g.lineTo(32, 33);
      g.stroke();
    } else if (kind === "card") {
      g.fillStyle = "#f4f4f1";
      g.beginPath();
      g.roundRect(4, 11, 36, 30, 4);
      g.fill();
      g.shadowColor = "transparent";
      g.fillStyle = "#8c97a3";
      g.beginPath();
      g.arc(15, 23, 5, 0, Math.PI * 2);
      g.fill();
      g.fillRect(8, 31, 14, 6);
      g.fillRect(26, 20, 10, 2);
      g.fillRect(26, 26, 10, 2);
    } else {
      g.fillStyle = "#f4f4f1";
      g.beginPath();
      g.moveTo(7, 3);
      g.lineTo(27, 3);
      g.lineTo(37, 13);
      g.lineTo(37, 49);
      g.lineTo(7, 49);
      g.closePath();
      g.fill();
      g.shadowColor = "transparent";
      g.fillStyle = "#cfd3d8";
      g.beginPath();
      g.moveTo(27, 3);
      g.lineTo(27, 13);
      g.lineTo(37, 13);
      g.closePath();
      g.fill();
      g.fillStyle = kind === "code" ? "#3f6fd0" : kind === "chart" ? "#2fae6d" : "#9aa3ad";
      if (kind === "chart") for (const [bx, bh] of [[13, 10], [19, 16], [25, 7], [31, 19]]) g.fillRect(bx, 40 - bh, 3.2, bh);
      else for (const ly of [22, 28, 34, 40]) g.fillRect(13, ly - 1, ly === 40 ? 11 : 18, 2);
    }
    g.restore();
  }
  function drawDesktop(now: Date) {
    const W = scr.width;
    const H = scr.height;
    sg.drawImage(paper, 0, 0);
    // menu bar
    sg.fillStyle = "rgba(18,18,22,0.42)";
    sg.fillRect(0, 0, W, 26);
    sg.textBaseline = "middle";
    sg.textAlign = "left";
    sg.fillStyle = C.ok;
    sg.font = `700 11px ${DISPLAY}`;
    sg.fillText("◆", 14, 14);
    sg.fillStyle = "rgba(255,255,255,0.95)";
    sg.font = `700 12.5px ${DISPLAY}`;
    sg.fillText("Finder", 40, 14);
    sg.font = `500 12.5px ${DISPLAY}`;
    let mx = 96;
    for (const item of ["File", "Edit", "View", "Go", "Window"]) {
      sg.fillText(item, mx, 14);
      mx += sg.measureText(item).width + 16;
    }
    sg.textAlign = "right";
    sg.fillText(fmtBar.format(now).replace(/,/g, ""), W - 14, 14);
    // files: a column down the right edge, wrapping leftward
    sg.textAlign = "center";
    sg.font = `500 11.5px ${DISPLAY}`;
    [...deskFiles.map((f) => ({ name: f.name as string, kind: f.kind as string })), { name: "blog ↗", kind: "txt" }].forEach((f, i) => {
      const cx = W - 58 - Math.floor(i / 6) * 96;
      const y = 44 + (i % 6) * 82;
      glyph(f.kind, cx - 19, y, 38, 45);
      sg.fillStyle = "rgba(0,0,0,0.55)";
      sg.fillText(f.name, cx + 0.5, y + 57.5);
      sg.fillStyle = "#fff";
      sg.fillText(f.name, cx, y + 56.5);
    });
    // dock
    const dw = dockFiles.length * 42 + 14;
    sg.fillStyle = "rgba(40,40,46,0.5)";
    sg.strokeStyle = "rgba(255,255,255,0.16)";
    sg.lineWidth = 1;
    sg.beginPath();
    sg.roundRect(W / 2 - dw / 2, H - 62, dw, 54, 16);
    sg.fill();
    sg.stroke();
    dockFiles.forEach((id, i) => {
      const f = deskFiles.find((x) => x.id === id)!;
      glyph(f.kind, W / 2 - dw / 2 + 10 + i * 42, H - 56, 36, 42);
    });
    sg.textAlign = "left";
    sg.textBaseline = "alphabetic";
  }

  // The monitor starts locked. The first visit to it types a password and
  // unlocks it; after that it stays a desktop.
  let unlocked = false;
  let unlockAt = -1;
  let typed = 0;
  /** True while the HTML desktop is laid over the screen. */
  let osOn = false;
  let screenKey = "";
  function drawScreen() {
    const now = new Date();
    const stamp = `${now.getHours()}:${now.getMinutes()}`;
    const key = !unlocked ? `l${stamp}:${typed}` : osOn ? "w" : `d${stamp}`;
    if (key === screenKey) return;
    screenKey = key;
    if (!unlocked) drawLock(now, typed);
    else if (osOn) sg.drawImage(paper, 0, 0);
    else drawDesktop(now);
    scrTex.needsUpdate = true;
  }
  drawScreen();

  // ── table lamp (left) ──────────────────────────────────────────────────
  const lampL = new THREE.Group();
  lampL.position.set(-0.56, TOP, -0.18);
  rig.add(lampL);
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
  const shadeGlow = glow(lampL, 0, 0.2, 0.02, "#ffae38", 0.4, 0.26);
  // Like the desk lamp, it is a real switch: click it to turn it off and on.
  {
    const hit = box(0.19, 0.28, 0.19, hitMat, 0, 0.14, 0, lampL);
    hit.userData.toggle = "lampL";
    hitTargets.push(hit);
  }
  // Finial, bulb, and the pools of light the shade throws on wall and desk.
  cyl(0.004, 0.006, 0.012, std("#d9c08a", 0.4, 0.6), 0, 0.258, 0, lampL, 10);
  const bulbL = glow(lampL, 0, 0.185, 0, "#fff0c8", 0.06, 0.9);
  const poolWallL = disc(1.25, 1.25, -0.56, TOP + 0.24, WALL_Z + 0.006, "#ffab40", 0.3, true);
  poolWallL.mesh.rotation.x = 0;
  const poolDeskL = disc(0.62, 0.5, -0.54, TOP + 0.0008, -0.12, "#ffab40", 0.28, true);
  shadow(0.14, 0.14, -0.56, -0.18, TOP + 0.0012, 0.45);

  // ── succulent → AIOps, still growing ───────────────────────────────────
  const plant = new THREE.Group();
  plant.position.set(-0.385, TOP, -0.2);
  rig.add(plant);
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
  rig.add(lampR);
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
  const bulbGlow = glow(lampR, -0.114, 0.3, 0.07, "#ffae38", 0.13, 0.55);
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
    rig.add(new THREE.Mesh(track(new THREE.TubeGeometry(c, 30, 0.003, 6)), std("#e8b53a", 0.6)));
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
  rig.add(kb);
  // A 75% board: translucent-white case, one real keycap per key. The caps
  // dip when the visitor types on their own keyboard.
  const kbTilt = new THREE.Group();
  kbTilt.rotation.x = 0.07;
  kbTilt.position.y = 0.003;
  kb.add(kbTilt);
  const kbBody = rbox(0.318, 0.02, 0.128, 0.006, std("#dfe2e6", 0.35), 0, 0.01, 0, kbTilt);
  const U = 0.0192;
  const lightKey = "#f2f1eb";
  const modKey = "#8c97a3";
  const key = (u: number, c: string, t: string, code: string) => ({ u, c, t, code });
  // "legend|KeyboardEvent.code"; letters, digits and F-keys name their own code.
  const light = (spec: string) =>
    spec.split(" ").map((p) => {
      const [t, code] = p.split("|");
      return key(1, lightKey, t, code ?? (/^[A-Z]$/.test(t) ? `Key${t}` : /^[0-9]$/.test(t) ? `Digit${t}` : t));
    });
  const rows = [
    [key(1, "#58b76a", "esc", "Escape"), ...light("F1 F2 F3 F4 F5 F6 F7 F8 F9 F10 F11 F12 ins|Insert"), key(1, "#e0463c", "del", "Delete")],
    [...light("`|Backquote 1 2 3 4 5 6 7 8 9 0 -|Minus =|Equal"), key(2, modKey, "⌫", "Backspace")],
    [key(1.5, modKey, "tab", "Tab"), ...light("Q W E R T Y U I O P [|BracketLeft ]|BracketRight"), key(1.5, lightKey, "\\", "Backslash")],
    [key(1.75, modKey, "caps", "CapsLock"), ...light("A S D F G H J K L ;|Semicolon '|Quote"), key(2.25, "#3f6fd0", "enter", "Enter")],
    [key(2.25, modKey, "shift", "ShiftLeft"), ...light("Z X C V B N M ,|Comma .|Period /|Slash"), key(1.75, modKey, "shift", "ShiftRight"), key(1, modKey, "↑", "ArrowUp")],
    [
      key(1.25, modKey, "ctrl", "ControlLeft"),
      key(1.25, modKey, "opt", "AltLeft"),
      key(1.25, modKey, "cmd", "MetaLeft"),
      key(6.25, "#f0c43c", "", "Space"),
      key(1, modKey, "cmd", "MetaRight"),
      key(1, modKey, "opt", "AltRight"),
      key(1, modKey, "←", "ArrowLeft"),
      key(1, modKey, "↓", "ArrowDown"),
      key(1, modKey, "→", "ArrowRight"),
    ],
  ];
  const keys = rows.flatMap((row, r) => {
    let x = 0;
    return row.map((k) => {
      const placed = { ...k, r, x: x + k.u / 2 };
      x += k.u;
      return placed;
    });
  });
  const caps = new THREE.InstancedMesh(track(new RoundedBoxGeometry(1, 1, 1, 2, 0.16)), std("#ffffff", 0.55), keys.length);
  const m4 = new THREE.Matrix4();
  // How far down each key is (0..1), what is drawn, and which are held.
  const keyDown = new Float32Array(keys.length);
  const keySeat = new Float32Array(keys.length);
  const held = new Map<number, number>();
  const codeToKey = new Map(keys.map((k, i) => [k.code, i]));
  const letterKeys = keys.flatMap((k, i) => (/^Key/.test(k.code) ? [i] : []));
  function seatKey(i: number) {
    const k = keys[i];
    m4.makeScale(k.u * U - 0.0022, 0.0075, U - 0.0022);
    m4.setPosition((k.x - 7.5) * U, 0.0225 - keyDown[i] * 0.0026, (k.r - 2.5) * U);
    caps.setMatrixAt(i, m4);
    keySeat[i] = keyDown[i];
  }
  {
    const col = new THREE.Color();
    keys.forEach((k, i) => {
      seatKey(i);
      caps.setColorAt(i, col.set(k.c));
    });
    caps.instanceMatrix.needsUpdate = true;
    if (caps.instanceColor) caps.instanceColor.needsUpdate = true;
    kbTilt.add(caps);
    markHot(caps, "stack");
    // The legends are printed on one clear sheet that lies on the keycaps.
    const PX = 96;
    const legend = new THREE.Mesh(
      track(new THREE.PlaneGeometry(15 * U, 6 * U)),
      track(
        new THREE.MeshStandardMaterial({
          roughness: 0.6,
          transparent: true,
          depthWrite: false,
          map: tex(15 * PX, 6 * PX, (g) => {
            g.textAlign = "center";
            g.textBaseline = "middle";
            for (const k of keys) {
              if (!k.t) continue;
              g.fillStyle = k.c === lightKey ? "rgba(44,50,58,0.92)" : "rgba(255,255,255,0.95)";
              const long = k.t.length > 1;
              g.font = `${long ? 500 : 600} ${k.t.length > 3 ? 20 : long ? 23 : 36}px ${long ? MONO : DISPLAY}`;
              g.fillText(k.t, k.x * PX, (k.r + 0.5) * PX + 2);
            }
          }),
        }),
      ),
    );
    legend.rotation.x = -Math.PI / 2;
    legend.position.set(0, 0.0225 + 0.00375 + 0.00025, 0);
    kbTilt.add(legend);
  }
  const rest = rbox(0.33, 0.02, 0.082, 0.009, std("#8a9099", 0.95), 0, 0.01, 0.118, kb);
  markHot(kbBody, "stack");
  markHot(rest, "stack");
  shadow(0.42, 0.3, 0, 0.16, TOP + 0.0046, 0.5);
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
    rig.add(new THREE.Mesh(track(new THREE.TubeGeometry(c, 40, 0.0025, 6)), std("#ecebe6", 0.6)));
    box(0.05, 0.022, 0.045, std("#eeece7", 0.4), -0.215, TOP + 0.011, -0.045);
  }

  // Mouse. It follows the visitor's pointer a little, and dips on a click.
  const MOUSE = { x: 0.31, y: TOP + 0.004, z: 0.17 };
  const mouse = new THREE.Group();
  mouse.position.set(MOUSE.x, MOUSE.y, MOUSE.z);
  rig.add(mouse);
  {
    const body = new THREE.Mesh(track(new THREE.SphereGeometry(0.03, 24, 16)), std("#1b1d20", 0.42));
    body.scale.set(1, 0.55, 1.6);
    body.position.y = 0.014;
    mouse.add(body);
    cyl(0.0045, 0.0045, 0.006, std("#3a3d42", 0.5), 0, 0.0262, -0.02, mouse, 12).rotation.z = Math.PI / 2;
    disc(0.1, 0.13, 0, 0.0007, 0.002, "#000000", 0.25, false, mouse);
  }

  // Mug of something hot, with steam curling off it. Click it for a sip.
  const steam: { mat: THREE.SpriteMaterial; sprite: THREE.Sprite; phase: number }[] = [];
  const MUG = { x: 0.215, y: TOP + 0.004, z: 0 };
  const mug = new THREE.Group();
  mug.position.set(MUG.x, MUG.y, MUG.z);
  rig.add(mug);
  let sipAt = -9;
  {
    const hit = box(0.1, 0.11, 0.1, hitMat, 0.008, 0.05, 0, mug);
    hit.userData.toggle = "mug";
    hitTargets.push(hit);
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
  rig.add(new THREE.Points(dustGeo, dustMat));

  // ── laptop + glasses → signals ─────────────────────────────────────────
  const lap = new THREE.Group();
  lap.position.set(0.43, TOP, -0.06);
  lap.rotation.y = -0.05;
  rig.add(lap);
  const lapBody = rbox(0.31, 0.013, 0.215, 0.006, std("#c9ccd0", 0.32, 0.9), 0, 0.0065, 0, lap);
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
  rig.add(phone);
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
    rig.add(grp);
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
    { id: "console", label: "monitor · unlock", pos: screen.getWorldPosition(new THREE.Vector3()), normal: new THREE.Vector3(0, 0, 1), dist: 1.2, w: 0.68 },
    { id: "aiops", label: "succulent · AIOps, still growing", pos: worldOf(plant, 0, 0.06, 0), normal: up(0.3, 0.95), dist: 0.5, lift: plant },
    { id: "stack", label: "keyboard · stack", pos: worldOf(kb, 0, 0.01, 0.04), normal: up(0.8, 0.6), dist: 0.66, w: 0.4, lift: kb },
    { id: "signals", label: "laptop · signals", pos: worldOf(lap, 0, 0.02, 0), normal: up(0.7, 0.72), dist: 0.8, w: 0.36, lift: lap },
    { id: "principles", label: "sticky notes · house rules", pos: worldOf(notes, 0, -0.035, 0), normal: up(0.12, 1), dist: 0.52, w: 0.3 },
    { id: "contact", label: "phone · contact", pos: worldOf(phone, 0, 0.01, 0), normal: up(0.86, 0.5), dist: 0.5, lift: phone },
  );
  for (const h of hots) if (h.lift) (h.liftBase = h.lift.position.y), (h.liftNow = 0);
  // A soft point of light above each thing that opens.
  const beaconY: Record<string, number> = { console: 0.23, aiops: 0.1, stack: 0.07, signals: 0.09, principles: -0.05, contact: 0.07 };
  for (const h of hots) {
    const isBook = h.id.startsWith("role-");
    if (isBook && h.id !== "role-0") continue; // one beacon for the stack of books
    const p = h.pos.clone();
    p.y += isBook ? 0.075 : (beaconY[h.id] ?? 0.08);
    if (isBook) p.z -= 0.08;
    h.beacon = glow(rig, p.x, p.y, p.z + 0.02, "#ffd27a", 0.024, 0.9);
  }

  // Everything solid casts and receives the lamps' shadows; flat blended
  // discs, glows and the lamps' own shades do not.
  scene.traverse((o) => {
    const m = o as THREE.Mesh;
    if (!m.isMesh) return;
    const mat = m.material as THREE.Material;
    if (Array.isArray(m.material) || (mat.visible && !mat.transparent && !(mat as THREE.MeshBasicMaterial).isMeshBasicMaterial)) {
      m.castShadow = true;
      m.receiveShadow = true;
    }
  });
  for (const lamp of [lampL, lampR]) lamp.traverse((o) => (o.castShadow = false));
  wall.castShadow = floor.castShadow = false;

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
  const lampLLight = new THREE.PointLight("#ffb347", 1.05, 2.0, 1.9);
  lampLLight.position.copy(worldOf(lampL, 0, 0.19, 0.03));
  rig.add(lampLLight);
  // The lamps also throw the scene's real shadows: the table lamp rakes
  // across the desk from the left, the desk lamp shines down on the right.
  const lampLDown = new THREE.SpotLight("#ffb955", 1.25, 3.2, 1.15, 0.9, 1.5);
  lampLDown.position.copy(worldOf(lampL, 0.02, 0.17, 0.02));
  lampLDown.target.position.set(0.25, TOP, 0.1);
  rig.add(lampLDown, lampLDown.target);
  const lampRSpot = new THREE.SpotLight("#ffb955", 1.1, 2.4, 0.95, 0.85, 1.5);
  lampRSpot.position.copy(worldOf(lampR, -0.112, 0.305, 0.068));
  lampRSpot.target.position.set(0.2, TOP, 0.12);
  rig.add(lampRSpot, lampRSpot.target);
  for (const l of [lampLDown, lampRSpot]) {
    l.castShadow = true;
    l.shadow.mapSize.set(small ? 512 : 1024, small ? 512 : 1024);
    l.shadow.camera.near = 0.05;
    l.shadow.camera.far = 3;
    l.shadow.bias = -0.0015;
    l.shadow.normalBias = 0.01;
    l.shadow.radius = 5;
  }
  const lampRLight = new THREE.PointLight("#ffb347", 0.8, 1.7, 1.9);
  lampRLight.position.copy(worldOf(lampR, -0.12, 0.29, 0.09));
  rig.add(lampRLight);
  const monLight = new THREE.PointLight("#a9cdfa", 0.3, 2.2, 1.6);
  monLight.position.copy(screen.getWorldPosition(new THREE.Vector3())).add(new THREE.Vector3(0, -0.05, 0.3));
  rig.add(monLight);
  // The cool spill behind the monitor onto the wall.
  const backLight = new THREE.PointLight("#9dbdf5", 0.12, 1.2, 1.6);
  backLight.position.copy(worldOf(mon, 0, SCY, -0.12));
  rig.add(backLight);

  // ── camera ─────────────────────────────────────────────────────────────
  const home = { pos: new THREE.Vector3(), look: new THREE.Vector3() };
  const want = { pos: new THREE.Vector3(), look: new THREE.Vector3() };
  const look = new THREE.Vector3();
  let aspect = 1;
  let selected: Hot | null = null;
  const tanV = Math.tan(THREE.MathUtils.degToRad(camera.fov / 2));

  // How far the desk has risen above sitting height.
  let rigY = 0;
  let rigT = 0;
  const consoleHot = hots.find((h) => h.id === "console")!;

  function place() {
    const portrait = aspect < 0.9;
    // The detail panel sits at the bottom up to 760px wide, else on the right.
    const sheetBottom = matchMedia("(max-width: 760px)").matches;
    // The desk fills the frame, with a little room either side. The view
    // follows it most of the way up when it is raised.
    const dist = Math.max(1.4, (portrait ? 0.72 : 0.8) / (tanV * aspect));
    const lift = rigY * 0.8;
    home.look.set(0, (portrait ? 0.84 : 0.88) + lift, 0);
    home.pos.set(-0.1, (portrait ? 1.06 : 1.12) + lift, dist);
    if (!selected) {
      want.pos.copy(home.pos);
      want.look.copy(home.look);
      return;
    }
    const h = selected;
    const p = h.pos.clone();
    p.y += rigY;
    if (h === consoleHot) {
      // Square on, with the screen filling most of the stage: the HTML
      // desktop is laid over it, so there is no panel to make room for.
      const d = Math.max(0.45, SW / (2 * tanV * aspect * 0.9), SH / (2 * tanV * 0.84));
      want.look.copy(p);
      want.pos.copy(p).addScaledVector(h.normal, d);
      return;
    }
    // Far enough back that the whole object fits in the part of the view the
    // panel leaves free (all of the width above a bottom sheet, about half
    // of it beside a side panel).
    const free = sheetBottom ? 0.9 : 0.52;
    const d = Math.max(h.dist * (sheetBottom ? 1.3 : 1), (h.w ?? 0.2) / (2 * tanV * aspect * free));
    const right = new THREE.Vector3(h.normal.z, 0, -h.normal.x).normalize();
    const shift = new THREE.Vector3();
    if (sheetBottom) shift.y = -0.22 * 2 * d * tanV; // sheet covers the bottom half
    else shift.copy(right).multiplyScalar(0.2 * 2 * d * tanV * aspect); // panel on the right
    want.look.copy(p).add(shift);
    want.pos.copy(p).addScaledVector(h.normal, d).add(shift);
    want.pos.y = Math.max(0.35, want.pos.y);
  }

  // ── lens ───────────────────────────────────────────────────────────────
  // A shallow depth of field keeps the eye on what the camera is looking at,
  // bloom lets the lamps and screen glow the way a camera sees them, and a
  // last pass adds a soft vignette and a little film grain.
  const target = track(new THREE.WebGLRenderTarget(4, 4, { type: THREE.HalfFloatType, samples: small ? 0 : 4 }));
  // Depth of field reads the scene's depth. Phones skip it.
  const dofOn = !small;
  if (dofOn) target.depthTexture = new THREE.DepthTexture(4, 4);
  const composer = new EffectComposer(renderer, target);
  composer.addPass(new RenderPass(scene, camera));
  const VERT = "varying vec2 vUv; void main(){ vUv = uv; gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0); }";
  class DofPass extends ShaderPass {
    // The composer swaps its two buffers; depth is in whichever was just drawn.
    render(...args: Parameters<ShaderPass["render"]>) {
      this.uniforms.tDepth.value = args[2].depthTexture;
      super.render(...args);
    }
  }
  const dof = new DofPass({
    uniforms: {
      tDiffuse: { value: null },
      tDepth: { value: null },
      uNear: { value: camera.near },
      uFar: { value: camera.far },
      uFocus: { value: 2 },
      uAperture: { value: 0 },
      uPx: { value: new THREE.Vector2(1, 1) },
    },
    vertexShader: VERT,
    // Each pixel gathers from a disc as wide as it is out of focus. A sample
    // only counts if it is at least that blurred itself, so sharp things do
    // not smear into the soft background behind them.
    fragmentShader: `uniform sampler2D tDiffuse; uniform sampler2D tDepth;
      uniform float uNear; uniform float uFar; uniform float uFocus; uniform float uAperture; uniform vec2 uPx;
      varying vec2 vUv;
      float dist(vec2 uv){ float z = texture2D(tDepth, uv).x * 2.0 - 1.0; return 2.0 * uNear * uFar / (uFar + uNear - z * (uFar - uNear)); }
      float coc(float d){ return min(abs(d - uFocus) / d * uAperture, 9.0); }
      void main(){
        float c0 = coc(dist(vUv));
        vec3 sum = texture2D(tDiffuse, vUv).rgb;
        float n = 1.0;
        for (int i = 1; i <= 22; i++){
          float f = float(i);
          float r = sqrt(f / 22.0) * c0;
          vec2 uv = vUv + vec2(cos(f * 2.39996), sin(f * 2.39996)) * r * uPx;
          float w = clamp(coc(dist(uv)) - r + 1.0, 0.0, 1.0);
          sum += texture2D(tDiffuse, uv).rgb * w;
          n += w;
        }
        gl_FragColor = vec4(sum / n, 1.0);
      }`,
  });
  if (dofOn) composer.addPass(dof);
  let focus = 2;
  let aperture = 0;
  const bloom = new UnrealBloomPass(new THREE.Vector2(4, 4), 0.2, 0.6, 0.92);
  composer.addPass(bloom);
  composer.addPass(new OutputPass());
  const lens = new ShaderPass({
    uniforms: { tDiffuse: { value: null }, uTime: { value: 0 }, uGrain: { value: reduced ? 0.0 : 0.035 } },
    vertexShader: VERT,
    fragmentShader: `uniform sampler2D tDiffuse; uniform float uTime; uniform float uGrain; varying vec2 vUv;
      float hash(vec2 p){ return fract(sin(dot(p, vec2(12.9898, 78.233)) + uTime) * 43758.5453); }
      void main(){
        vec4 c = texture2D(tDiffuse, vUv);
        vec2 d = vUv - 0.5;
        c.rgb *= mix(1.0, 0.5, smoothstep(0.2, 0.9, dot(d, d) * 2.2));
        c.rgb += (hash(vUv * 900.0) - 0.5) * uGrain;
        gl_FragColor = c;
      }`,
  });
  composer.addPass(lens);

  let stageW = 1;
  let stageH = 1;
  function resize() {
    const w = stage.clientWidth;
    const h = stage.clientHeight;
    if (!w || !h) return;
    stageW = w;
    stageH = h;
    aspect = w / h;
    renderer.setSize(w, h, false);
    composer.setPixelRatio(renderer.getPixelRatio());
    composer.setSize(w, h);
    // Blur is set in pixels of a 900px-tall frame, so it looks the same at any size.
    const ph = h * renderer.getPixelRatio();
    dof.uniforms.uPx.value.set(ph / 900 / (w * renderer.getPixelRatio()), 1 / 900);
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

  // The things that work: both lamps, the desk's motor, the mug.
  let lampROn = true;
  let lampRLevel = 1;
  let lampLOn = true;
  let lampLLevel = 1;
  let deskUp = false;
  let overToggle: string | null = null;
  const toggleHint = (t: string) =>
    t === "lampR"
      ? `desk lamp · switch ${lampROn ? "off" : "on"}`
      : t === "lampL"
        ? `table lamp · switch ${lampLOn ? "off" : "on"}`
        : t === "desk"
          ? `standing desk · ${deskUp ? "lower it" : "raise it"}`
          : "coffee · take a sip";
  function toggle(t: string) {
    if (t === "lampR") lampROn = !lampROn;
    else if (t === "lampL") lampLOn = !lampLOn;
    else if (t === "desk") deskUp = !deskUp;
    else if (t === "mug" && time - sipAt > 1.7) sipAt = time;
    dirty = true;
  }
  // The visitor's own keyboard works the one on the desk.
  function onKeyDown(e: KeyboardEvent) {
    const i = codeToKey.get(e.code);
    if (i === undefined) return;
    held.set(i, time);
    keyDown[i] = 1;
    dirty = true;
  }
  function onKeyUp(e: KeyboardEvent) {
    const i = codeToKey.get(e.code);
    // The OS swallows key-ups while Cmd is down; letting go of it frees all.
    if (e.key === "Meta") held.clear();
    else if (i !== undefined) held.delete(i);
    dirty = true;
  }
  const onBlur = () => held.clear();
  // Where the pointer is over the whole stage (-1..1), for the desk mouse.
  const mp = new THREE.Vector2(0, 0);
  let mouseDip = 0;
  function onStageMove(e: PointerEvent) {
    if (e.pointerType === "touch") return;
    const r = stage.getBoundingClientRect();
    mp.set(((e.clientX - r.left) / r.width) * 2 - 1, ((e.clientY - r.top) / r.height) * 2 - 1);
  }
  const onStageDown = () => {
    mouseDip = 1;
  };
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
    // At the computer the view stays square on to the screen.
    if (drag && e.pointerId === drag.id && selected !== consoleHot) {
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
    overToggle = (o?.userData.toggle as string | undefined) ?? null;
    par.copy(ptr);
    hovered = h;
    canvas.style.cursor = h || overToggle ? "pointer" : selected === consoleHot ? "" : "grab";
    on.hover(overToggle ? toggleHint(overToggle) : h && h !== selected ? h.label : null, e.clientX, e.clientY);
    dirty = true;
  }
  function onUp(e: PointerEvent) {
    if (drag && e.pointerId === drag.id) drag = null;
  }
  function onLeave() {
    clearHover();
    overToggle = null;
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
    const t = o?.userData.toggle as string | undefined;
    if (t) {
      toggle(t);
      // Under a mouse the hint stays up and now says the opposite.
      if (overToggle) on.hover(toggleHint(t), e.clientX, e.clientY);
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
  stage.addEventListener("pointermove", onStageMove);
  stage.addEventListener("pointerdown", onStageDown);
  window.addEventListener("keydown", onKeyDown);
  window.addEventListener("keyup", onKeyUp);
  window.addEventListener("blur", onBlur);
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
  const corner = new THREE.Vector3();
  /** The screen's outline on the stage, from its four corners. */
  function screenRect(): ScreenRect {
    let x0 = Infinity;
    let y0 = Infinity;
    let x1 = -Infinity;
    let y1 = -Infinity;
    for (const [sx, sy] of [[-1, -1], [1, -1], [-1, 1], [1, 1]]) {
      corner.set((sx * SW) / 2, (sy * SH) / 2, 0);
      screen.localToWorld(corner).project(camera);
      const x = (corner.x * 0.5 + 0.5) * stageW;
      const y = (-corner.y * 0.5 + 0.5) * stageH;
      x0 = Math.min(x0, x);
      y0 = Math.min(y0, y);
      x1 = Math.max(x1, x);
      y1 = Math.max(y1, y);
    }
    return { x: x0, y: y0, w: x1 - x0, h: y1 - y0 };
  }
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
    const using = selected === consoleHot;

    // The desk motor: a steady climb, eased at both ends. The camera, the
    // power lead and the controller's read-out all follow it.
    const rigWant = deskUp ? 1 : 0;
    if (rigT !== rigWant) {
      rigT = reduced ? rigWant : THREE.MathUtils.clamp(rigT + (Math.sign(rigWant - rigT) * dt) / 2.8, 0, 1);
      rigY = RISE * rigT * rigT * (3 - 2 * rigT);
      rig.position.y = rigY;
      hangLead(rigY);
      drawCtrl(rigY);
      place();
    }

    // First visit to the monitor: the password goes in a key at a time,
    // then it unlocks.
    if (using && !unlocked && unlockAt >= 0) {
      const since = time - unlockAt;
      const n = reduced ? 8 : THREE.MathUtils.clamp(Math.floor((since - 0.75) / 0.085), 0, 8);
      if (n > typed) {
        typed = n;
        keyDown[letterKeys[(Math.random() * letterKeys.length) | 0]] = 1;
      }
      if (reduced || since > 1.6) {
        unlocked = true;
        consoleHot.label = "monitor · use the computer";
      }
    }

    // camera
    const px = selected || reduced ? 0 : par.x * 0.1;
    const py = selected || reduced ? 0 : par.y * 0.05;
    // The dragged view eases back to centre once the visitor lets go, and
    // snaps back when they sit down at the computer.
    if (!drag?.moved || using) {
      const back = reduced || using ? 0 : Math.exp(-dt * 0.35);
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

    // Once the camera has arrived at the unlocked screen, the HTML desktop
    // goes over it and is kept glued to it from then on.
    const arrived = camera.position.distanceTo(want.pos) < 0.05 && Math.abs(orbit.nowYaw) + Math.abs(orbit.nowPitch) < 0.02;
    const show = using && unlocked && (osOn || arrived);
    if (show) {
      camera.updateMatrixWorld();
      on.screen(screenRect());
    } else if (osOn) on.screen(null);
    osOn = show;

    // Keys spring back; the mouse trails the pointer; the mug takes its sip.
    {
      const kk = reduced ? 1 : 1 - Math.exp(-dt * 26);
      let moved = false;
      for (let i = 0; i < keyDown.length; i++) {
        const since = held.get(i);
        if (since !== undefined && time - since > 2.5) held.delete(i);
        const to = held.has(i) ? 1 : 0;
        if (keyDown[i] !== to) {
          keyDown[i] += (to - keyDown[i]) * kk;
          if (Math.abs(to - keyDown[i]) < 0.02) keyDown[i] = to;
        }
        if (keyDown[i] !== keySeat[i]) {
          seatKey(i);
          moved = true;
        }
      }
      if (moved) caps.instanceMatrix.needsUpdate = true;
    }
    if (!reduced) {
      const km = 1 - Math.exp(-dt * 8);
      mouse.position.x += (MOUSE.x + mp.x * 0.035 - mouse.position.x) * km;
      mouse.position.z += (MOUSE.z + mp.y * 0.03 - mouse.position.z) * km;
      mouseDip *= Math.exp(-dt * 14);
      mouse.position.y = MOUSE.y - mouseDip * 0.0012;
    }
    const sip = reduced ? 0 : Math.sin(THREE.MathUtils.clamp((time - sipAt) / 1.7, 0, 1) * Math.PI);
    mug.position.set(MUG.x + sip * 0.01, MUG.y + sip * 0.085, MUG.z + sip * 0.07);
    mug.rotation.x = sip * sip * 0.55;

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
    hemi.intensity = 0.07 + day * 1.2;
    sun.intensity = day * 1.0;
    lampRLevel += ((lampROn && (reduced || time > 1.25) ? 1 : 0) - lampRLevel) * (reduced ? 1 : 1 - Math.exp(-dt * 12));
    lampLLevel += ((lampLOn ? 1 : 0) - lampLLevel) * (reduced ? 1 : 1 - Math.exp(-dt * 12));
    // Opening beat: the room is dark, then the table lamp stutters on, the
    // desk lamp follows, and the monitor wakes.
    const ramp = (t0: number, dur: number) => (reduced ? 1 : THREE.MathUtils.clamp((time - t0) / dur, 0, 1));
    const flick = reduced || time > 1.15 ? 1 : Math.sin(time * 85) > -0.2 ? 1 : 0.3;
    const L = ramp(0.55, 0.1) * flick * lampLLevel;
    const S = ramp(1.9, 0.8);
    lampLLight.intensity = 0.5 * breathe * L;
    lampLDown.intensity = 1.25 * L;
    lampRSpot.intensity = 1.1 * lampRLevel;
    (shade.material as THREE.MeshBasicMaterial).color.setRGB(0.22 + 0.78 * L, 0.2 + 0.68 * L, 0.16 + 0.44 * L);
    (screen.material as THREE.MeshBasicMaterial).color.setScalar(S);
    monLight.intensity = 0.3 * S;
    backLight.intensity = 0.12 * S;
    phoneTop.color.setScalar(reduced ? 1 : 0.72 + 0.28 * Math.max(0, Math.sin(time * 0.9)) ** 6);
    fill.intensity = 0.07 * (0.35 + 0.65 * Math.max(L, lampRLevel));

    // Ambient life: steam, dust, and a slow sway in the curtain.
    for (const p of steam) {
      const u = reduced ? 0.35 : (time * 0.22 + p.phase) % 1;
      p.sprite.position.set(Math.sin(u * 5 + p.phase * 9) * 0.012 * (0.4 + u), 0.09 + u * 0.16, Math.cos(u * 4 + p.phase * 5) * 0.008);
      p.sprite.scale.setScalar(0.03 + u * 0.06);
      p.mat.opacity = Math.sin(u * Math.PI) * 0.16 * (1 - sip);
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
    lampRLight.intensity = 0.4 * breathe * lampRLevel;
    shadeGlow.opacity = (0.26 - day * 0.14) * L;
    bulbL.opacity = 0.9 * L;
    bulbGlow.opacity = (0.55 - day * 0.25) * lampRLevel;
    bulbCore.opacity = 0.15 + 0.85 * lampRLevel;
    poolWallL.mat.opacity = 0.34 * dim * L;
    poolDeskL.mat.opacity = 0.1 * dim * L;
    poolWallR.mat.opacity = 0.3 * dim * lampRLevel;
    poolDeskR.mat.opacity = 0.08 * dim * lampRLevel;
    (scene.background as THREE.Color).copy(bgDark).lerp(bgLight, day);
    (scene.fog as THREE.Fog).color.copy(scene.background as THREE.Color);

    drawScreen();
    if (dofOn) {
      // Pull focus to whatever the camera is looking at; open the aperture
      // for close-ups, where a real lens would blur the room behind.
      const kf = reduced ? 1 : 1 - Math.exp(-dt * 5);
      focus += (camera.position.distanceTo(look) - focus) * kf;
      aperture += ((selected ? (using ? 8 : 16) : 7) - aperture) * kf;
      dof.uniforms.uFocus.value = focus;
      dof.uniforms.uAperture.value = aperture;
    }
    lens.uniforms.uTime.value = reduced ? 0 : time % 10;
    composer.render();
  }
  frame();

  return {
    wallpaper: paper,
    select(id) {
      const next = byId(id);
      // Sitting down at a locked monitor starts the unlock; walking away
      // before it finishes leaves it locked.
      if (!unlocked) {
        unlockAt = next === consoleHot ? (selected === consoleHot ? unlockAt : time) : -1;
        if (next !== consoleHot) typed = 0;
      }
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
      stage.removeEventListener("pointermove", onStageMove);
      stage.removeEventListener("pointerdown", onStageDown);
      window.removeEventListener("keydown", onKeyDown);
      window.removeEventListener("keyup", onKeyUp);
      window.removeEventListener("blur", onBlur);
      if (osOn) on.screen(null);
      disposables.forEach((d) => d.dispose());
      composer.dispose();
      bloom.dispose();
      renderer.dispose();
    },
  };
}
