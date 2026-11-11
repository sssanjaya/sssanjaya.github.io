// The 3D home page: a real desk in the evening, modelled on photographs of
// it. A white IKEA sit/stand desk, a 32-inch BenQ monitor on its silver
// column with a laptop docked on the base, a second laptop with a pair of
// glasses on it, a NuPhy keyboard and wrist rest, a mouse, a phone, a
// pleated table lamp, a small succulent and an IKEA gooseneck lamp. Nothing
// else: no props that are not on the real desk.
//
// Things work the way they do there: the monitor unlocks to a desktop of
// files (DeskOS.astro), both lamps switch, the desk rises, the keys dip as
// you type. The monitor, plant, keyboard, laptop and phone each open a part
// of the site.
//
// Everything is built here, from photographs and the makers' dimensions.
// The monitor's wallpaper is a photograph (public/wallpaper.webp), a
// same-origin file, so the CSP stays 'self'-only. Loaded lazily by
// Rack.astro, only on devices that can run it.
import * as THREE from "three";
import { RoomEnvironment } from "three/examples/jsm/environments/RoomEnvironment.js";
import { RoundedBoxGeometry } from "three/examples/jsm/geometries/RoundedBoxGeometry.js";
import { EffectComposer } from "three/examples/jsm/postprocessing/EffectComposer.js";
import { OutputPass } from "three/examples/jsm/postprocessing/OutputPass.js";
import { RenderPass } from "three/examples/jsm/postprocessing/RenderPass.js";
import { ShaderPass } from "three/examples/jsm/postprocessing/ShaderPass.js";
import { UnrealBloomPass } from "three/examples/jsm/postprocessing/UnrealBloomPass.js";
import { site } from "../data/site.ts";
import { deskFiles, dockFiles, DESK_W, DESK_H } from "../data/desktop.ts";
import { paintWallpaper } from "./wallpaper.ts";
import { LM } from "../data/lightmap.ts";
import { PAD, chartsOf, chartSpans, pack, placeCharts, type Chart, type Rect } from "./lightmap.ts";

const OK = "#39e58c";
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
};

/** Where the monitor's screen sits on the stage, in CSS pixels. */
export type ScreenRect = { x: number; y: number; w: number; h: number };

export interface RackController {
  select(id: string | null): void;
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
  // Phones get a lighter pipeline: lower pixel ratio, smaller shadow maps,
  // no ambient occlusion or depth of field.
  const small = matchMedia("(max-width: 760px)").matches;
  renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, small ? 1.5 : 2));
  renderer.outputColorSpace = THREE.SRGBColorSpace;
  // Neutral leaves colours as they are until they are nearly white, so the
  // photograph on the screen is not washed out.
  renderer.toneMapping = THREE.NeutralToneMapping;
  renderer.toneMappingExposure = 1.0;
  const maxAniso = renderer.capabilities.getMaxAnisotropy();

  const scene = new THREE.Scene();
  const bgDark = new THREE.Color("#0b0a09");
  const bgLight = new THREE.Color("#8f8a82");
  scene.background = bgDark.clone();
  scene.fog = new THREE.Fog(scene.background as THREE.Color, 6, 14);
  // The desk top and everything on it hang off `rig`, so the desk can rise.
  // `root` is where the helpers below add things: the room, then the rig.
  const rig = new THREE.Group();
  scene.add(rig);
  let root: THREE.Object3D = scene;

  const camera = new THREE.PerspectiveCamera(30, 1, 0.05, 40);

  // Metres. The desk is 120 × 80 cm; x runs along it, +z is toward the chair.
  const WALL_Z = -0.46;
  const TOP = 0.72; // desk surface, sitting
  const DW = 1.2;
  const DD = 0.8;
  const RISE = 0.38; // sitting to standing

  // Set when something has changed and a frame is owed (reduced motion only draws then).
  let dirty = true;

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
    const m = new THREE.Mesh(track(new RoundedBoxGeometry(w, h, d, 4, r)), mat);
    m.position.set(x, y, z);
    parent.add(m);
    return m;
  }
  function cyl(rt: number, rb: number, h: number, mat: THREE.Material, x = 0, y = 0, z = 0, parent: THREE.Object3D = root, seg = 48, open = false) {
    const m = new THREE.Mesh(track(new THREE.CylinderGeometry(rt, rb, h, seg, 1, open)), mat);
    m.position.set(x, y, z);
    parent.add(m);
    return m;
  }
  /** A rounded rectangle path, for extruded shapes. */
  function roundRect(p: THREE.Path, hw: number, hd: number, r: number) {
    p.moveTo(-hw + r, -hd);
    p.lineTo(hw - r, -hd);
    p.absarc(hw - r, -hd + r, r, -Math.PI / 2, 0, false);
    p.lineTo(hw, hd - r);
    p.absarc(hw - r, hd - r, r, 0, Math.PI / 2, false);
    p.lineTo(-hw + r, hd);
    p.absarc(-hw + r, hd - r, r, Math.PI / 2, Math.PI, false);
    p.lineTo(-hw, -hd + r);
    p.absarc(-hw + r, -hd + r, r, Math.PI, Math.PI * 1.5, false);
    return p;
  }
  /**
   * A slab lying flat: w × d seen from above with corner radius r, h tall,
   * its top and bottom edges softened. Desk top, mat, laptops, phone.
   */
  function slab(w: number, d: number, h: number, r: number, mat: THREE.Material, x = 0, y = 0, z = 0, parent: THREE.Object3D = root, bevel = 0.0012) {
    const b = Math.min(bevel, h / 2.2);
    const hw = w / 2 - b;
    const hd = d / 2 - b;
    const shape = roundRect(new THREE.Shape(), hw, hd, Math.max(0.0005, Math.min(r - b, hw, hd)));
    const geo = track(
      new THREE.ExtrudeGeometry(shape, { depth: h - 2 * b, bevelEnabled: true, bevelThickness: b, bevelSize: b, bevelSegments: 3, curveSegments: 14 }),
    );
    geo.userData.lm = "slab";
    geo.rotateX(-Math.PI / 2); // lie flat: the extrusion becomes +y
    geo.translate(0, b - h / 2, 0); // centre it on its height
    const m = new THREE.Mesh(geo, mat);
    m.position.set(x, y, z);
    parent.add(m);
    return m;
  }
  /**
   * A flat sheet in the xy plane with vertices at the given xs and ys. `uv`
   * places its texture; `pu` and `pv` (one per x, one per y) say where each
   * column and row falls in its lightmap, so the middle of a big wall can
   * have most of the detail.
   */
  function sheet(xs: number[], ys: number[], pu: number[], pv: number[], uv: (x: number, y: number) => [number, number]) {
    const pos: number[] = [];
    const uvs: number[] = [];
    const par: number[] = [];
    const idx: number[] = [];
    ys.forEach((y, j) =>
      xs.forEach((x, i) => {
        pos.push(x, y, 0);
        uvs.push(...uv(x, y));
        par.push(pu[i], pv[j]);
        if (i && j) {
          const a = (j - 1) * xs.length + i - 1;
          const b = j * xs.length + i - 1;
          idx.push(a, a + 1, b, a + 1, b + 1, b);
        }
      }),
    );
    const geo = track(new THREE.BufferGeometry());
    geo.setAttribute("position", new THREE.Float32BufferAttribute(pos, 3));
    geo.setAttribute("uv", new THREE.Float32BufferAttribute(uvs, 2));
    geo.setIndex(idx);
    geo.computeVertexNormals();
    geo.userData.lmParam = new Float32Array(par);
    return geo;
  }
  /** A turned shape: [radius, height] pairs from the bottom up. */
  function lathe(profile: [number, number][], mat: THREE.Material, x = 0, y = 0, z = 0, parent: THREE.Object3D = root, seg = 56) {
    const m = new THREE.Mesh(track(new THREE.LatheGeometry(profile.map(([r, h]) => new THREE.Vector2(r, h)), seg)), mat);
    m.position.set(x, y, z);
    parent.add(m);
    return m;
  }
  /** A cable or rod through the given points. */
  function tube(points: [number, number, number][], r: number, mat: THREE.Material, parent: THREE.Object3D = root, seg = 48) {
    const curve = new THREE.CatmullRomCurve3(points.map((p) => new THREE.Vector3(p[0], p[1], p[2])));
    const m = new THREE.Mesh(track(new THREE.TubeGeometry(curve, seg, r, 10)), mat);
    parent.add(m);
    return m;
  }

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
  /** The same, for the things that switch rather than open. */
  const switchBox = (w: number, h: number, d: number, x: number, y: number, z: number, what: string, parent: THREE.Object3D = root) => {
    const m = box(w, h, d, hitMat, x, y, z, parent);
    m.userData.toggle = what;
    hitTargets.push(m);
  };
  const worldOf = (o: THREE.Object3D, x = 0, y = 0, z = 0) => o.localToWorld(new THREE.Vector3(x, y, z));

  // Soft reflections on metal, glass and glazed surfaces, from a generated
  // room (no image download).
  {
    const pmrem = new THREE.PMREMGenerator(renderer);
    const room = new RoomEnvironment();
    scene.environment = track(pmrem.fromScene(room, 0.04).texture);
    scene.environmentIntensity = 0.1;
    room.dispose();
    pmrem.dispose();
  }

  // ── room ───────────────────────────────────────────────────────────────
  // Pale floor tiles with dark grout.
  const floorTex = tex(256, 256, (g, w, h) => {
    g.fillStyle = "#cbc8c1";
    g.fillRect(0, 0, w, h);
    for (let i = 0; i < 500; i++) {
      g.fillStyle = `rgba(${Math.random() < 0.5 ? "0,0,0" : "255,255,255"},${Math.random() * 0.03})`;
      g.fillRect(Math.random() * w, Math.random() * h, 2 + Math.random() * 10, 2 + Math.random() * 10);
    }
    g.strokeStyle = "#5b5650";
    g.lineWidth = 4;
    g.strokeRect(0, 0, w, h);
  });
  floorTex.wrapS = floorTex.wrapT = THREE.RepeatWrapping;
  // Most of the lightmap goes to the part of the floor and wall near the desk.
  const NEAR = 2.6;
  const floor = new THREE.Mesh(
    sheet([-7, -NEAR, NEAR, 7], [-7, -3.6, -WALL_Z], [0, 0.03, 0.97, 1], [1, 0.06, 0], (x, y) => [x / 0.32, y / 0.32]),
    track(new THREE.MeshStandardMaterial({ map: floorTex, roughness: 0.42 })),
  );
  floor.material.userData.bake = "#c4c1ba";
  floor.rotation.x = -Math.PI / 2;
  floor.userData.lmSize = [820, 660];
  scene.add(floor);

  // A plain painted wall.
  const wallTex = tex(512, 512, (g, w, h) => {
    g.fillStyle = "#ffffff";
    g.fillRect(0, 0, w, h);
    // faint roller marks in the paint
    for (let i = 0; i < 2600; i++) {
      g.fillStyle = `rgba(${Math.random() < 0.5 ? "0,0,0" : "255,255,255"},${Math.random() * 0.012})`;
      g.fillRect(Math.random() * w, Math.random() * h, 2 + Math.random() * 26, 1 + Math.random() * 3);
    }
  });
  wallTex.wrapS = wallTex.wrapT = THREE.RepeatWrapping;
  // The lamps and the monitor ride on the desk, so when it rises their light
  // on the wall goes up with it: everything above `UNDER` slides in the
  // lightmap, and the stretch is taken up below the desk, where it is dark.
  const WALL_H = 4.2;
  const UNDER = 0.55;
  const wall = new THREE.Mesh(
    sheet([-7, -NEAR, NEAR, 7], [0, UNDER, WALL_H], [0, 0.03, 0.97, 1], [1, 1 - UNDER / WALL_H, 0], (x, y) => [(x / 14) * 10, (y / WALL_H) * 3]),
    track(new THREE.MeshStandardMaterial({ color: "#cdc8c1", roughness: 0.96, map: wallTex })),
  );
  wall.position.set(0, 0, WALL_Z);
  wall.userData.lmSize = [1560, 1250];
  wall.userData.lmRise = WALL_H;
  scene.add(wall);
  rbox(14, 0.1, 0.016, 0.004, std("#eeece7", 0.6), 0, 0.05, WALL_Z + 0.008).userData.lmDensity = 60;

  // Outlet under the desk, with the plug in it. The power lead hangs to it
  // and pays out as the desk rises.
  rbox(0.07, 0.115, 0.008, 0.003, std("#f3f1ec", 0.5), 0.07, 0.4, WALL_Z + 0.005);
  rbox(0.036, 0.04, 0.03, 0.006, std("#f6f4ef", 0.45), 0.07, 0.385, WALL_Z + 0.024);
  const lead = new THREE.Mesh(new THREE.BufferGeometry(), std("#eeece6", 0.55));
  scene.add(lead);
  track({ dispose: () => lead.geometry.dispose() });
  function hangLead(y: number) {
    lead.geometry.dispose();
    lead.geometry = new THREE.TubeGeometry(
      new THREE.CatmullRomCurve3([
        new THREE.Vector3(-0.03, TOP - 0.035 + y, -0.3),
        new THREE.Vector3(-0.07, 0.42 + y * 0.45, -0.34),
        new THREE.Vector3(-0.04, 0.18 + y * 0.1, -0.38),
        new THREE.Vector3(0.05, 0.25, WALL_Z + 0.05),
        new THREE.Vector3(0.07, 0.385, WALL_Z + 0.04),
      ]),
      48,
      0.0035,
      8,
    );
    // Same shape of tube every time, so the same place in the lightmap.
    if (lead.userData.lmUv) lead.geometry.setAttribute("uv1", lead.userData.lmUv);
  }
  hangLead(0);

  // The curtain on the right: heavy blue-grey fabric from ceiling to floor,
  // coming in behind the end of the desk. It sways a little.
  let curtain: THREE.BufferGeometry | null = null;
  const CURTAIN_X = 1.39;
  const CURTAIN_H = 3.2;
  const fold = (x: number) => Math.sin(x * 34) * 0.016 + Math.sin(x * 11 + 1) * 0.012;
  {
    const cols = Array.from({ length: 121 }, (_, i) => -0.85 + (i / 120) * 1.7);
    const geo = sheet(
      cols,
      [0, UNDER, CURTAIN_H],
      cols.map((_, i) => i / 120),
      [1, 1 - UNDER / CURTAIN_H, 0],
      (x, y) => [(x / 1.7 + 0.5) * 9, (y / CURTAIN_H) * 16],
    );
    const p = geo.attributes.position;
    for (let i = 0; i < p.count; i++) p.setZ(i, fold(p.getX(i)));
    geo.computeVertexNormals();
    const weave = tex(256, 256, (g, w, h) => {
      g.fillStyle = "#ffffff";
      g.fillRect(0, 0, w, h);
      for (let i = 0; i < 9000; i++) {
        g.fillStyle = `rgba(0,0,0,${Math.random() * 0.07})`;
        g.fillRect(Math.random() * w, Math.random() * h, 1, 2 + Math.random() * 5);
      }
    });
    weave.wrapS = weave.wrapT = THREE.RepeatWrapping;
    const m = new THREE.Mesh(geo, track(new THREE.MeshStandardMaterial({ color: "#687079", map: weave, roughness: 0.97, side: THREE.DoubleSide })));
    m.position.set(CURTAIN_X, 0, WALL_Z + 0.035);
    m.userData.lmSize = [430, 820];
    m.userData.lmRise = CURTAIN_H;
    m.userData.bakeRole = "curtain";
    scene.add(m);
    curtain = geo;
  }

  // ── desk ───────────────────────────────────────────────────────────────
  // IKEA sit/stand desk: a white top with rounded corners on two round
  // columns. The feet and outer columns stay on the floor; the top, the
  // inner columns and everything on the desk ride on the rig.
  const white = std("#f2f0eb", 0.5);
  const LEG_X = 0.485;
  const TOP_T = 0.016;
  // Each leg is three tubes, the widest on top. The bottom one stands on the
  // foot, the top one hangs from the desk, and the middle one travels at half
  // speed between them.
  const legMid = new THREE.Group();
  scene.add(legMid);
  // At sitting height the two lower tubes are mostly inside the top one, so
  // they cannot be given their own baked light. They borrow it from a stand-in
  // the full height of the leg, which is never drawn.
  const PROBE_H = 1.1;
  for (const sx of [-1, 1]) {
    slab(0.09, 0.64, 0.02, 0.045, white, sx * LEG_X, 0.01, 0);
    const probe = cyl(0.0362, 0.0362, PROBE_H, white, sx * LEG_X, PROBE_H / 2, 0, scene, 24, true);
    probe.visible = false;
    probe.userData.lmDensity = 420;
    cyl(0.0275, 0.0275, 0.58, white, sx * LEG_X, 0.31, 0).userData.lmFrom = probe;
    cyl(0.031, 0.031, 0.56, white, sx * LEG_X, 0.424, 0, legMid).userData.lmFrom = probe;
  }
  root = rig;
  slab(DW, DD, TOP_T, 0.06, white, 0, TOP - TOP_T / 2, 0, rig, 0.004).userData.lmDensity = 1000;
  for (const sx of [-1, 1]) {
    cyl(0.035, 0.035, 0.56, white, sx * LEG_X, TOP - TOP_T - 0.28, 0).userData.lmDensity = 420;
    rbox(0.1, 0.028, 0.6, 0.008, white, sx * LEG_X, TOP - TOP_T - 0.014, 0).userData.lmDensity = 300;
  }
  rbox(2 * LEG_X, 0.028, 0.06, 0.008, white, 0, TOP - TOP_T - 0.014, -0.03).userData.lmDensity = 300;
  // A black lead looped under the top.
  tube(
    [
      [-0.06, TOP - 0.04, -0.2],
      [-0.05, 0.5, -0.24],
      [0.0, 0.43, -0.27],
      [0.05, 0.5, -0.27],
      [0.07, TOP - 0.04, -0.24],
    ],
    0.0028,
    std("#141516", 0.6),
  );

  // The height controller under the front-right edge: a small white pad with
  // an up and a down button. A click on it raises or lowers the desk.
  {
    const ctrl = new THREE.Group();
    ctrl.position.set(0.47, TOP - TOP_T - 0.0075, DD / 2 - 0.03);
    rig.add(ctrl);
    rbox(0.08, 0.015, 0.04, 0.004, std("#eceae5", 0.45), 0, 0, 0, ctrl);
    const arrow = track(new THREE.ConeGeometry(0.0055, 0.008, 3));
    const btn = std("#9aa0a6", 0.5);
    for (const [bx, flip] of [[-0.014, 0], [0.014, Math.PI]] as const) {
      const m = new THREE.Mesh(arrow, btn);
      m.scale.z = 0.25;
      m.rotation.z = flip;
      m.position.set(bx, 0, 0.0203);
      ctrl.add(m);
    }
    switchBox(0.16, 0.06, 0.1, 0, 0, 0.01, "desk", ctrl);
  }

  // Desk mat: dark green leather, 80 × 40 cm.
  const MAT_T = 0.003;
  const MAT_Z = 0.145;
  {
    const grain = tex(256, 256, (g, w, h) => {
      g.fillStyle = "#808080";
      g.fillRect(0, 0, w, h);
      for (let i = 0; i < 6000; i++) {
        g.fillStyle = Math.random() < 0.5 ? "rgba(0,0,0,0.22)" : "rgba(255,255,255,0.22)";
        g.fillRect(Math.random() * w, Math.random() * h, 1.5, 1.5);
      }
    });
    grain.wrapS = grain.wrapT = THREE.RepeatWrapping;
    grain.repeat.set(26, 26);
    slab(0.8, 0.4, MAT_T, 0.025, track(new THREE.MeshStandardMaterial({ color: "#19221e", roughness: 0.8, bumpMap: grain, bumpScale: 0.5 })), 0, TOP + MAT_T / 2, MAT_Z, rig, 0.0008).userData.lmDensity = 1000;
  }
  const ON_MAT = TOP + MAT_T;

  // ── monitor → the computer ─────────────────────────────────────────────
  // BenQ MA320U: a 31.5-inch 16:9 panel with thin black bezels on a round
  // silver column and a flat silver base.
  const SW = 0.6973;
  const SH = (SW * DESK_H) / DESK_W;
  const mon = new THREE.Group();
  mon.position.set(0, TOP, -0.25);
  rig.add(mon);
  const silver = std("#c9ccd0", 0.36, 0.85);
  const charcoal = std("#3c3d3f", 0.5, 0.15);
  const PANEL_Y = 0.155; // bottom edge of the panel above the desk
  const BEZEL = 0.0086;
  const CHIN = 0.0235;
  const PW = SW + 2 * BEZEL; // 714.5 mm
  const PH = SH + BEZEL + CHIN; // 424 mm
  const PANEL_Z = 0.012; // the panel's front face, from the middle of the base
  const SCY = PANEL_Y + CHIN + SH / 2;
  const COL_Z = -0.06;
  // The base: a flat silver plate, 290 × 220 mm, with a grey pad at the front.
  slab(0.29, 0.22, 0.007, 0.01, silver, 0, 0.0035, 0, mon, 0.0015);
  slab(0.275, 0.06, 0.0006, 0.006, std("#8c8e91", 0.7), 0, 0.0072, 0.074, mon, 0.0002);
  // The column, with its cable ring, and the short neck to the back of the panel.
  const COL_H = PANEL_Y + PH * 0.5;
  cyl(0.024, 0.024, COL_H, silver, 0, COL_H / 2 + 0.007, COL_Z, mon);
  cyl(0.0262, 0.0262, 0.016, std("#77797d", 0.5, 0.3), 0, 0.05, COL_Z, mon);
  rbox(0.07, 0.07, 0.05, 0.012, silver, 0, PANEL_Y + PH * 0.42, COL_Z + 0.03, mon);
  // The back shell is silver and bulges at the middle; the edge band is charcoal.
  {
    const back = new THREE.Mesh(track(new THREE.SphereGeometry(1, 40, 20, 0, Math.PI * 2, 0, Math.PI / 2)), silver);
    back.scale.set(PW * 0.47, 0.034, PH * 0.47);
    back.rotation.x = -Math.PI / 2;
    back.position.set(0, PANEL_Y + PH / 2, PANEL_Z - 0.019);
    back.userData.lmDensity = 300;
    mon.add(back);
  }
  const monBody = rbox(PW, PH, 0.019, 0.004, charcoal, 0, PANEL_Y + PH / 2, PANEL_Z - 0.0095, mon);
  monBody.userData.lmDensity = 500;
  // Thin black border round the glass; the chin under it stays charcoal.
  box(PW - 0.003, SH + BEZEL + 0.002, 0.0006, std("#08090a", 0.35), 0, SCY + (BEZEL - 0.002) / 2, PANEL_Z + 0.0001, mon).userData.lmDensity = 250;
  // Under the chin: the joystick, the power button (lit) and a dongle.
  rbox(0.009, 0.005, 0.009, 0.002, std("#141517", 0.5), 0, PANEL_Y - 0.0025, PANEL_Z - 0.008, mon);
  cyl(0.004, 0.004, 0.003, track(new THREE.MeshBasicMaterial({ color: "#eef4ff", toneMapped: false })), 0.035, PANEL_Y - 0.0015, PANEL_Z - 0.008, mon, 16);
  rbox(0.014, 0.012, 0.006, 0.002, std("#101113", 0.5), 0.08, PANEL_Y - 0.006, PANEL_Z - 0.008, mon);

  // The screen is a canvas, drawn at twice the desktop's logical size so it
  // stays sharp when the camera is close.
  const SCR = 2;
  const scr = document.createElement("canvas");
  scr.width = DESK_W * SCR;
  scr.height = DESK_H * SCR;
  const sg = scr.getContext("2d")!;
  const scrTex = track(new THREE.CanvasTexture(scr));
  scrTex.colorSpace = THREE.SRGBColorSpace;
  scrTex.anisotropy = maxAniso;
  const screen = new THREE.Mesh(track(new THREE.PlaneGeometry(SW, SH)), track(new THREE.MeshBasicMaterial({ map: scrTex, toneMapped: false })));
  screen.position.set(0, SCY, PANEL_Z + 0.0006);
  mon.add(screen);
  screen.userData.emit = "M";
  markHot(monBody, "console");
  markHot(screen, "console");
  {
    // The screen is glass: a faint sheen across one corner.
    const sheen = new THREE.Mesh(
      track(new THREE.PlaneGeometry(SW, SH)),
      track(
        new THREE.MeshBasicMaterial({
          map: tex(256, 256, (g, w, h) => {
            const gr = g.createLinearGradient(0, 0, w * 0.8, h);
            gr.addColorStop(0, "rgba(255,255,255,0.07)");
            gr.addColorStop(0.3, "rgba(255,255,255,0.015)");
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
    sheen.position.set(0, SCY, PANEL_Z + 0.001);
    mon.add(sheen);
  }

  // The wallpaper is a photograph; it repaints the screen when it arrives.
  const paper = document.createElement("canvas");
  paintWallpaper(paper, SCR, () => {
    screenKey = "";
    dirty = true;
  });
  const initials = site.name
    .split(" ")
    .map((s) => s[0])
    .join("")
    .slice(0, 2)
    .toUpperCase();
  const fmtDate = new Intl.DateTimeFormat("en-CA", { weekday: "short", month: "short", day: "numeric" });
  const clockText = (now: Date) => `${now.getHours() % 12 || 12}:${String(now.getMinutes()).padStart(2, "0")}`;
  /** Start a screen drawing: logical desktop pixels, wallpaper down. */
  function beginScreen() {
    sg.setTransform(SCR, 0, 0, SCR, 0, 0);
    sg.drawImage(paper, 0, 0, DESK_W, DESK_H);
    sg.textBaseline = "alphabetic";
  }
  function drawLock(now: Date, dots: number) {
    const W = DESK_W;
    const H = DESK_H;
    beginScreen();
    sg.textAlign = "center";
    sg.shadowColor = "rgba(0,20,40,0.25)";
    sg.shadowBlur = 12;
    sg.fillStyle = "rgba(255,255,255,0.95)";
    sg.font = `600 22px ${DISPLAY}`;
    sg.fillText(fmtDate.format(now).replace(",", ""), W / 2, 70);
    sg.fillStyle = "rgba(206,240,250,0.94)";
    sg.font = `700 96px ${DISPLAY}`;
    sg.fillText(clockText(now), W / 2, 156);
    sg.shadowBlur = 0;
    // status items, top right
    sg.textAlign = "right";
    sg.fillStyle = "rgba(255,255,255,0.9)";
    sg.font = `500 10.5px ${DISPLAY}`;
    sg.fillText("100%  ▮   ◉", W - 14, 16);
    sg.textAlign = "center";
    // avatar, name, password field
    sg.fillStyle = "rgba(96,108,128,0.9)";
    sg.beginPath();
    sg.arc(W / 2, H - 104, 18, 0, Math.PI * 2);
    sg.fill();
    sg.fillStyle = "#fff";
    sg.font = `700 14px ${DISPLAY}`;
    sg.fillText(initials, W / 2, H - 99);
    sg.font = `500 11.5px ${DISPLAY}`;
    sg.fillText(site.name, W / 2, H - 72);
    sg.fillStyle = "rgba(255,255,255,0.26)";
    sg.beginPath();
    sg.roundRect(W / 2 - 76, H - 62, 152, 22, 11);
    sg.fill();
    if (dots > 0) {
      sg.fillStyle = "rgba(255,255,255,0.95)";
      for (let i = 0; i < dots; i++) {
        sg.beginPath();
        sg.arc(W / 2 - 56 + i * 16, H - 51, 3.6, 0, Math.PI * 2);
        sg.fill();
      }
    } else {
      sg.textAlign = "left";
      sg.fillStyle = "rgba(255,255,255,0.72)";
      sg.font = `500 10.5px ${DISPLAY}`;
      sg.fillText("Enter Password", W / 2 - 64, H - 47.5);
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
    if (kind === "dir" || kind === "album") {
      g.fillStyle = "#5aa9f0";
      g.beginPath();
      g.roundRect(3, 11, 38, 33, 3);
      g.fill();
      g.shadowColor = "transparent";
      g.fillStyle = "#7fc1ff";
      g.beginPath();
      g.roundRect(3, 21, 38, 23, 3);
      g.fill();
      if (kind === "album") {
        g.fillStyle = "rgba(255,255,255,0.92)";
        g.beginPath();
        g.moveTo(10, 39);
        g.lineTo(18, 29);
        g.lineTo(23, 35);
        g.lineTo(27, 31);
        g.lineTo(34, 39);
        g.closePath();
        g.fill();
        g.beginPath();
        g.arc(30, 27, 2.6, 0, Math.PI * 2);
        g.fill();
      }
    } else if (kind === "term") {
      g.fillStyle = "#15181c";
      g.beginPath();
      g.roundRect(3, 8, 38, 36, 7);
      g.fill();
      g.shadowColor = "transparent";
      g.strokeStyle = OK;
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
    const W = DESK_W;
    const H = DESK_H;
    beginScreen();
    // menu bar
    sg.fillStyle = "rgba(18,18,22,0.42)";
    sg.fillRect(0, 0, W, 26);
    sg.textBaseline = "middle";
    sg.textAlign = "left";
    sg.fillStyle = OK;
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
    // files: a column down the right edge, wrapping leftward (as in DeskOS)
    sg.textAlign = "center";
    sg.font = `500 11.5px ${DISPLAY}`;
    const perColumn = Math.max(1, Math.floor((H - 38 - 70 + 6) / 82));
    [...deskFiles.map((f) => ({ name: f.name as string, kind: f.kind as string })), { name: "blog ↗", kind: "txt" }].forEach((f, i) => {
      const cx = W - 58 - Math.floor(i / perColumn) * 96;
      const y = 44 + (i % perColumn) * 82;
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
    else if (osOn) beginScreen();
    else drawDesktop(now);
    scrTex.needsUpdate = true;
  }
  drawScreen();

  // The laptop docked on the monitor's base, lid shut, and the two display
  // leads running from it to the other laptop.
  const DOCK = { x: 0, y: TOP + 0.0072, z: -0.171 };
  const dockLap = slab(0.3126, 0.2212, 0.0155, 0.012, std("#2a2b2e", 0.42, 0.7), DOCK.x, DOCK.y + 0.00775, DOCK.z, rig, 0.0018);
  box(0.3, 0.0006, 0.0006, std("#101112", 0.6), DOCK.x, DOCK.y + 0.0105, DOCK.z + 0.1107);
  markHot(dockLap, "console");
  {
    const cable = std("#111214", 0.55);
    for (const dz of [0, 0.022]) {
      tube(
        [
          [0.157, DOCK.y + 0.006, -0.262 + dz],
          [0.178, DOCK.y + 0.012, -0.275 + dz],
          [0.205, TOP + 0.012, -0.268 + dz],
          [0.226, TOP + 0.006, -0.25 + dz],
          [0.238, TOP + 0.0055, -0.236 + dz],
        ],
        0.0024,
        cable,
      );
    }
  }

  // ── table lamp (left) ──────────────────────────────────────────────────
  // A pleated fabric shade on a white stem and a round wooden foot.
  const lampL = new THREE.Group();
  lampL.position.set(-0.455, TOP, -0.28);
  rig.add(lampL);
  {
    const wood = track(
      new THREE.MeshStandardMaterial({
        userData: { bake: "#c9a878" },
        roughness: 0.62,
        map: tex(256, 256, (g, w, h) => {
          g.fillStyle = "#d6b382";
          g.fillRect(0, 0, w, h);
          for (let i = 0; i < 110; i++) {
            const y = Math.random() * h;
            g.strokeStyle = `rgba(${(105 + Math.random() * 45) | 0},${(66 + Math.random() * 30) | 0},28,${0.05 + Math.random() * 0.15})`;
            g.lineWidth = 0.5 + Math.random() * 2;
            g.beginPath();
            g.moveTo(0, y);
            g.bezierCurveTo(w * 0.3, y + (Math.random() - 0.5) * 16, w * 0.7, y + (Math.random() - 0.5) * 16, w, y + (Math.random() - 0.5) * 8);
            g.stroke();
          }
        }),
      }),
    );
    const R = 0.052;
    cyl(R - 0.001, R - 0.001, 0.0016, std("#1b1a19", 0.9), 0, 0.0008, 0, lampL);
    lathe(
      [
        [R - 0.001, 0.0016],
        [R, 0.004],
        [R, 0.029],
        [R - 0.0025, 0.0315],
      ],
      wood,
      0,
      0,
      0,
      lampL,
    );
    // The top is a separate disc so the grain runs straight across it.
    const lid = new THREE.Mesh(track(new THREE.CircleGeometry(R - 0.0025, 56)), wood);
    lid.rotation.x = -Math.PI / 2;
    lid.position.y = 0.0315;
    lampL.add(lid);
    cyl(0.0085, 0.0095, 0.005, white, 0, 0.034, 0, lampL, 24);
    cyl(0.006, 0.006, 0.16, white, 0, 0.112, 0, lampL, 20);
  }
  const shadeTex = tex(1024, 256, (g, w, h) => {
    g.fillStyle = "#f1e6cf";
    g.fillRect(0, 0, w, h);
    // Wide pleats, each catching the light on one side and shading the next.
    const n = 30;
    for (let i = 0; i < n; i++) {
      const x0 = (i / n) * w;
      const pw = w / n;
      const lean = (i % 2 ? 1 : -1) * (3 + Math.random() * 5);
      const pl = g.createLinearGradient(x0, 0, x0 + pw, 0);
      const dark = 0.16 + Math.random() * 0.16;
      pl.addColorStop(0, `rgba(120,78,24,${dark})`);
      pl.addColorStop(0.25, "rgba(255,250,236,0.5)");
      pl.addColorStop(0.7, "rgba(255,246,224,0.25)");
      pl.addColorStop(1, `rgba(120,78,24,${dark * 0.8})`);
      g.fillStyle = pl;
      g.beginPath();
      g.moveTo(x0 + lean, 0);
      g.lineTo(x0 + pw + lean, 0);
      g.lineTo(x0 + pw - lean, h);
      g.lineTo(x0 - lean, h);
      g.closePath();
      g.fill();
    }
    // The bulb shows through the cloth as a brighter patch, on the side that
    // faces the room.
    const glow = g.createRadialGradient(w / 2, h * 0.52, 0, w / 2, h * 0.52, w * 0.2);
    glow.addColorStop(0, "rgba(255,244,214,0.75)");
    glow.addColorStop(0.5, "rgba(255,236,196,0.3)");
    glow.addColorStop(1, "rgba(255,236,196,0)");
    g.fillStyle = glow;
    g.fillRect(0, 0, w, h);
    // the wire rings at the top and bottom
    g.fillStyle = "rgba(70,52,30,0.55)";
    g.fillRect(0, 0, w, 3);
    g.fillRect(0, h - 3, w, 3);
  });
  const shade = new THREE.Mesh(
    track(new THREE.CylinderGeometry(0.048, 0.077, 0.135, 72, 1, true)),
    track(new THREE.MeshBasicMaterial({ map: shadeTex, side: THREE.DoubleSide, toneMapped: false })),
  );
  // Turned so the texture's seam is at the back.
  shade.rotation.y = Math.PI;
  shade.position.set(0, 0.2045, 0);
  shade.userData.emit = "L";
  lampL.add(shade);
  const bulbLMat = track(new THREE.MeshBasicMaterial({ color: "#fff3d6", toneMapped: false }));
  const bulbL = new THREE.Mesh(track(new THREE.SphereGeometry(0.019, 20, 14)), bulbLMat);
  bulbL.position.set(0, 0.2, 0);
  bulbL.userData.emit = "Lbulb";
  lampL.add(bulbL);
  switchBox(0.18, 0.3, 0.18, 0, 0.15, 0, "lampL", lampL);

  // ── succulent → AIOps, still growing ───────────────────────────────────
  // A small rosette, just showing over the rim of a ribbed grey-blue pot on
  // its saucer.
  const plant = new THREE.Group();
  plant.position.set(-0.335, TOP, -0.285);
  rig.add(plant);
  {
    const glaze = std("#b9c4c4", 0.46);
    const POT = { r0: 0.0345, r1: 0.0425, h: 0.078, y: 0.005 };
    lathe(
      [
        [0, 0],
        [0.04, 0],
        [0.0455, 0.003],
        [0.0465, 0.0075],
        [0.044, 0.0082],
        [0.039, 0.005],
        [0, 0.005],
      ],
      glaze,
      0,
      0,
      0,
      plant,
    );
    // Fine ribs run up the pot and stop under a plain band at the rim.
    const potGeo = track(new THREE.CylinderGeometry(POT.r1, POT.r0, POT.h, 184, 14, true));
    const pp = potGeo.attributes.position;
    for (let i = 0; i < pp.count; i++) {
      const up = pp.getY(i) / POT.h + 0.5;
      const rib = Math.cos(Math.atan2(pp.getZ(i), pp.getX(i)) * 46) * 0.012 * (up < 0.86 ? 1 : 0);
      pp.setX(i, pp.getX(i) * (1 + rib));
      pp.setZ(i, pp.getZ(i) * (1 + rib));
    }
    potGeo.computeVertexNormals();
    const pot = new THREE.Mesh(potGeo, glaze);
    pot.position.y = POT.y + POT.h / 2;
    plant.add(pot);
    cyl(POT.r1 - 0.004, POT.r0 - 0.004, POT.h - 0.004, track(new THREE.MeshStandardMaterial({ color: "#aab5b5", roughness: 0.5, side: THREE.BackSide })), 0, POT.y + POT.h / 2 + 0.002, 0, plant, 48, true);
    const rim = new THREE.Mesh(track(new THREE.TorusGeometry(POT.r1 - 0.002, 0.0023, 10, 72)), glaze);
    rim.rotation.x = Math.PI / 2;
    rim.position.y = POT.y + POT.h;
    plant.add(rim);
    cyl(POT.r0, POT.r0, 0.002, glaze, 0, POT.y + 0.001, 0, plant);
    // soil
    const SOIL = POT.y + POT.h - 0.009;
    const soil = new THREE.Mesh(
      track(new THREE.CircleGeometry(POT.r1 - 0.0045, 40)),
      track(
        new THREE.MeshStandardMaterial({
          userData: { bake: "#2a211b" },
          roughness: 1,
          map: tex(128, 128, (g, w, h) => {
            g.fillStyle = "#2a211b";
            g.fillRect(0, 0, w, h);
            for (let i = 0; i < 900; i++) {
              g.fillStyle = `rgba(${Math.random() < 0.5 ? "0,0,0" : "120,96,74"},${0.15 + Math.random() * 0.4})`;
              g.fillRect(Math.random() * w, Math.random() * h, 1 + Math.random() * 3, 1 + Math.random() * 3);
            }
          }),
        }),
      ),
    );
    soil.rotation.x = -Math.PI / 2;
    soil.position.y = SOIL;
    plant.add(soil);
    // The leaves: plump, pointed, a little flattened, in two small rosettes.
    const leafGeo = track(
      new THREE.LatheGeometry(
        [
          [0, 0],
          [0.0021, 0.0015],
          [0.0042, 0.006],
          [0.005, 0.0115],
          [0.0043, 0.0165],
          [0.0024, 0.0205],
          [0, 0.0225],
        ].map(([r, y]) => new THREE.Vector2(r, y)),
        14,
      ),
    );
    leafGeo.scale(1, 1, 0.42);
    const rosettes = [
      { x: -0.007, z: 0.003, n: 15, size: 1, lean: 0.12 },
      { x: 0.014, z: -0.008, n: 9, size: 0.68, lean: -0.2 },
    ];
    const leaves = new THREE.InstancedMesh(leafGeo, std("#ffffff", 0.48), rosettes.reduce((a, r) => a + r.n, 0));
    const at = new THREE.Object3D();
    at.rotation.order = "YXZ";
    const tint = new THREE.Color();
    let li = 0;
    for (const r of rosettes) {
      for (let i = 0; i < r.n; i++) {
        const inward = i / (r.n - 1); // 0 = outermost, oldest leaf
        const a = i * 2.39996;
        const out = (1 - inward) * 0.0075 * r.size;
        at.position.set(r.x + Math.sin(a) * out, SOIL + 0.001 + inward * 0.008 * r.size, r.z + Math.cos(a) * out);
        at.rotation.set(1.05 - inward * 0.85 + r.lean * Math.cos(a), a, 0);
        at.scale.setScalar(r.size * (1.05 - inward * 0.5));
        at.updateMatrix();
        leaves.setMatrixAt(li, at.matrix);
        leaves.setColorAt(li++, tint.setHSL(0.27 + inward * 0.03, 0.34 + Math.random() * 0.08, 0.32 + inward * 0.1 + Math.random() * 0.04));
      }
    }
    plant.add(track(leaves));
  }
  hitBox(0.12, 0.15, 0.12, 0, 0.07, 0, "aiops", plant);

  // The power adapter in front of the pot, with a carabiner on its loop and
  // the white lead that runs to the docked laptop.
  {
    const AD = { x: -0.3, z: -0.105 };
    rbox(0.058, 0.026, 0.058, 0.0085, std("#e8e7e3", 0.42), AD.x, TOP + 0.013, AD.z);
    slab(0.045, 0.045, 0.0008, 0.006, std("#d6d5d0", 0.5), AD.x, TOP + 0.0263, AD.z, rig, 0.0002);
    rbox(0.011, 0.0055, 0.006, 0.0015, std("#f4f3f0", 0.4), AD.x, TOP + 0.011, AD.z + 0.031);
    tube(
      [
        [AD.x, TOP + 0.011, AD.z + 0.033],
        [AD.x - 0.004, ON_MAT + 0.0035, AD.z + 0.085],
        [AD.x + 0.03, ON_MAT + 0.0022, AD.z + 0.125],
        [AD.x + 0.075, ON_MAT + 0.0022, AD.z + 0.1],
        [AD.x + 0.1, TOP + 0.004, AD.z + 0.02],
        [AD.x + 0.112, TOP + 0.0035, -0.19],
        [-0.172, TOP + 0.006, -0.238],
        [-0.157, DOCK.y + 0.006, -0.245],
      ],
      0.0019,
      std("#ebe9e4", 0.5),
      rig,
      72,
    );
    // strap and carabiner
    rbox(0.012, 0.003, 0.008, 0.001, std("#8b8d90", 0.7), AD.x - 0.034, TOP + 0.006, AD.z + 0.004);
    const clip = new THREE.Mesh(track(new THREE.TorusGeometry(0.0105, 0.0017, 10, 40)), std("#3b3c3f", 0.35, 0.85));
    clip.rotation.x = Math.PI / 2;
    clip.scale.set(1.75, 1, 1);
    clip.position.set(AD.x - 0.058, TOP + 0.0018, AD.z + 0.006);
    rig.add(clip);
  }

  // ── keyboard + wrist rest → stack ──────────────────────────────────────
  // NuPhy Kick75: a 75% board in a pale frosted case. One real keycap per
  // key; the caps dip when the visitor types on their own keyboard.
  const kb = new THREE.Group();
  kb.position.set(0, ON_MAT, 0.07);
  rig.add(kb);
  const kbTilt = new THREE.Group();
  kbTilt.rotation.x = 0.087;
  kbTilt.position.y = 0.0064;
  kb.add(kbTilt);
  // 333 × 143 mm, in frosted polycarbonate with well-rounded corners.
  const kbBody = slab(0.333, 0.1433, 0.017, 0.018, std("#dfe5e4", 0.32), 0, 0.0085, 0, kbTilt, 0.003);
  const U = 0.01905;
  const CAP_H = 0.0078;
  const CAP_Y = 0.0204;
  const lightKey = "#f1f1ee";
  const modKey = "#b0b9b5";
  const key = (u: number, c: string, t: string, code: string) => ({ u, c, t, code });
  /** Empty space in a row. */
  const gap = (u: number) => key(u, "", "", "");
  // "legend|KeyboardEvent.code"; letters, digits and F-keys name their own code.
  const run = (c: string, spec: string) =>
    spec.split(" ").map((p) => {
      const [t, code] = p.split("|");
      return key(1, c, t, code ?? (/^[A-Z]$/.test(t) ? `Key${t}` : /^[0-9]$/.test(t) ? `Digit${t}` : t));
    });
  const light = (spec: string) => run(lightKey, spec);
  const rows = [
    [key(1, "#3fae49", "esc", "Escape"), gap(0.25), ...light("F1 F2 F3 F4"), gap(0.25), ...run(modKey, "F5 F6 F7 F8"), gap(0.25), ...light("F9 F10 F11 F12"), gap(0.25), key(1, modKey, "del", "Delete")],
    [...light("`|Backquote 1 2 3 4 5 6 7 8 9 0 -|Minus =|Equal"), key(2, modKey, "backspace", "Backspace"), gap(0.25), key(1, modKey, "home", "Home")],
    [key(1.5, modKey, "tab", "Tab"), ...light("Q W E R T Y U I O P [|BracketLeft ]|BracketRight"), key(1.5, lightKey, "\\", "Backslash"), gap(0.25), key(1, modKey, "pgup", "PageUp")],
    [key(1.75, modKey, "caps", "CapsLock"), ...light("A S D F G H J K L ;|Semicolon '|Quote"), key(2.25, "#2f62d0", "enter", "Enter"), gap(0.25), key(1, modKey, "pgdn", "PageDown")],
    [key(2.25, modKey, "shift", "ShiftLeft"), ...light("Z X C V B N M ,|Comma .|Period /|Slash"), key(1.75, modKey, "shift", "ShiftRight"), gap(0.25), key(1, modKey, "↑", "ArrowUp")],
    [
      key(1.25, modKey, "ctrl", "ControlLeft"),
      key(1.25, modKey, "opt", "AltLeft"),
      key(1.25, modKey, "cmd", "MetaLeft"),
      key(6.25, "#f2b92a", "", "Space"),
      key(1, modKey, "cmd", "MetaRight"),
      key(1, modKey, "fn", "AltRight"),
      gap(1.25),
      key(1, modKey, "←", "ArrowLeft"),
      key(1, modKey, "↓", "ArrowDown"),
      key(1, modKey, "→", "ArrowRight"),
    ],
  ];
  const KEYS_W = 16.25; // the block, the gap and the navigation column, in key units
  const keys = rows.flatMap((row, r) => {
    let x = 0;
    return row.flatMap((k) => {
      const placed = { ...k, r, x: x + k.u / 2 };
      x += k.u;
      return k.c ? [placed] : [];
    });
  });
  let legendMat: THREE.MeshBasicMaterial | null = null;
  const caps = new THREE.InstancedMesh(track(new RoundedBoxGeometry(1, 1, 1, 3, 0.2)), std("#ffffff", 0.5), keys.length);
  const m4 = new THREE.Matrix4();
  // How far down each key is (0..1), what is drawn, and which are held.
  const keyDown = new Float32Array(keys.length);
  const keySeat = new Float32Array(keys.length);
  const held = new Map<number, number>();
  const codeToKey = new Map(keys.map((k, i) => [k.code, i]));
  const letterKeys = keys.flatMap((k, i) => (/^Key/.test(k.code) ? [i] : []));
  function seatKey(i: number) {
    const k = keys[i];
    m4.makeScale(k.u * U - 0.0021, CAP_H, U - 0.0021);
    m4.setPosition((k.x - KEYS_W / 2) * U, CAP_Y - keyDown[i] * 0.0026, (k.r - 2.5) * U);
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
    kbTilt.add(track(caps));
    markHot(caps, "stack");
    // The legends are printed on one clear sheet that lies on the keycaps.
    const PX = 96;
    const legend = new THREE.Mesh(
      track(new THREE.PlaneGeometry(KEYS_W * U, 6 * U)),
      track(
        new THREE.MeshBasicMaterial({
          transparent: true,
          depthWrite: false,
          map: tex(KEYS_W * PX, 6 * PX, (g) => {
            g.textAlign = "center";
            g.textBaseline = "middle";
            for (const k of keys) {
              if (!k.t) continue;
              g.fillStyle = k.c === lightKey ? "rgba(70,78,90,0.9)" : "rgba(255,255,255,0.95)";
              const long = k.t.length > 1;
              g.font = `${long ? 500 : 600} ${k.t.length > 5 ? 17 : k.t.length > 3 ? 19 : long ? 22 : 33}px ${long ? MONO : DISPLAY}`;
              g.fillText(k.t, k.x * PX, (k.r + 0.5) * PX + 2);
            }
          }),
        }),
      ),
    );
    legendMat = legend.material;
    legend.rotation.x = -Math.PI / 2;
    legend.position.set(0, CAP_Y + CAP_H / 2 + 0.00025, 0);
    kbTilt.add(legend);
  }
  {
    // The red volume knob in the top right corner: a round base with a cross.
    const knob = std("#e23b35", 0.45);
    const kx = (KEYS_W / 2 - 0.5) * U;
    const kz = -2.5 * U;
    cyl(0.0092, 0.0096, 0.009, knob, kx, 0.0215, kz, kbTilt, 28);
    for (const a of [Math.PI / 4, -Math.PI / 4]) rbox(0.019, 0.006, 0.0062, 0.0028, knob, kx, 0.0275, kz, kbTilt).rotation.y = a;
  }
  // The wrist rest: a soft grey cushion on a thin tray, with its yellow pull
  // tab. 355 × 84 × 19 mm.
  const REST_Z = 0.118;
  const rest = new THREE.Mesh(new THREE.SphereGeometry(1, 96, 40), std("#8b9097", 0.96));
  {
    track(rest.geometry);
    const W = 0.351;
    const H = 0.0165;
    const D = 0.08;
    const pw = (v: number, e: number) => Math.sign(v) * Math.abs(v) ** e;
    const p = rest.geometry.attributes.position;
    for (let i = 0; i < p.count; i++) {
      const x = p.getX(i);
      const y = p.getY(i);
      const z = p.getZ(i);
      // A ball pushed out into a pill-cornered pillow.
      const r = Math.hypot(x, z) || 1e-6;
      const X = (pw(x / r, 0.2) * r ** 0.45 * W) / 2;
      const Z = (pw(z / r, 0.42) * r ** 0.45 * D) / 2;
      // The cover sits loose: a few soft folds across the top.
      const fold = y > 0 ? (Math.sin(X * 58 + Math.sin(Z * 66) * 1.4) * 0.55 + Math.sin(X * 21 + 1.7) * 0.45) * 0.0012 * y : 0;
      p.setXYZ(i, X, (pw(y, 0.7) * H) / 2 + fold, Z);
    }
    rest.geometry.computeVertexNormals();
    rest.position.set(0, 0.004 + H / 2, REST_Z);
    kb.add(rest);
  }
  slab(0.3552, 0.0838, 0.004, 0.014, std("#dfe3e5", 0.35), 0, 0.002, REST_Z, kb, 0.001);
  rbox(0.018, 0.003, 0.016, 0.001, std("#e7b53a", 0.7), -0.184, 0.0075, REST_Z + 0.006, kb);
  markHot(kbBody, "stack");
  markHot(rest, "stack");

  // The mouse: 107 × 61 × 38 mm, highest behind the middle, in graphite with
  // a darker rubber band round the sides.
  {
    const mouse = new THREE.Group();
    mouse.position.set(0.265, ON_MAT, 0.16);
    mouse.rotation.y = 0.16;
    rig.add(mouse);
    const geo = track(new THREE.SphereGeometry(1, 56, 36));
    const p = geo.attributes.position;
    const shade = new Float32Array(p.count * 3);
    for (let i = 0; i < p.count; i++) {
      const x = p.getX(i);
      const y = p.getY(i);
      const z = p.getZ(i); // +z is the palm end
      const high = 0.76 + 0.24 * Math.cos((z - 0.28) * 1.85);
      const wide = 1 - 0.13 * Math.max(0, -z) ** 2;
      // Steeper sides than a ball has. It is widest a little above the mat
      // and tucks in underneath.
      const side = Math.sign(x) * Math.abs(x) ** 0.8;
      const tuck = y < 0 ? 1 - 0.17 * Math.min(1, -y * 2) : 1;
      const Y = y > 0 ? 0.007 + y ** 0.85 * high * 0.031 : 0.007 * Math.max(0, 1 + y * 2);
      p.setXYZ(i, side * wide * tuck * 0.0305, Y, z * tuck * 0.0535);
      const band = THREE.MathUtils.smoothstep(y, 0.1, 0.28);
      shade.set([0.55 + 0.45 * band, 0.55 + 0.45 * band, 0.57 + 0.43 * band], i * 3);
    }
    geo.setAttribute("color", new THREE.BufferAttribute(shade, 3));
    geo.computeVertexNormals();
    const body = new THREE.Mesh(geo, track(new THREE.MeshStandardMaterial({ color: "#6b6f77", roughness: 0.42, vertexColors: true })));
    mouse.add(body);
    cyl(0.0078, 0.0078, 0.0062, std("#8a8e96", 0.4, 0.3), 0, 0.0262, -0.026, mouse, 24).rotation.z = Math.PI / 2;
  }

  // ── laptop + glasses → signals ─────────────────────────────────────────
  // The silver laptop, lid shut, with a pair of black glasses resting on it.
  const lap = new THREE.Group();
  lap.position.set(0.39, TOP, -0.16);
  lap.rotation.y = -0.035;
  rig.add(lap);
  const LAP_T = 0.0113;
  const lapMetal = std("#cdd0d4", 0.42, 0.82);
  const lapBody = slab(0.3041, 0.2124, 0.0072, 0.012, lapMetal, 0, 0.0036, 0, lap, 0.0014);
  const lapLid = slab(0.3041, 0.2124, 0.0038, 0.012, lapMetal, 0, LAP_T - 0.0019, 0, lap, 0.0011);
  slab(0.302, 0.2104, 0.0006, 0.011, std("#1a1b1d", 0.6), 0, 0.00735, 0, lap, 0.0001);
  markHot(lapBody, "signals");
  markHot(lapLid, "signals");
  {
    // Black acetate glasses, folded, lying back on their arms with the
    // lenses turned up toward the chair.
    const frame = std("#0d0e10", 0.3);
    const LENS = { w: 0.026, h: 0.0205, x: 0.0325 };
    const gl = new THREE.Group();
    gl.position.set(0.02, LAP_T + 0.0162, 0.04);
    gl.rotation.order = "YXZ";
    gl.rotation.set(-0.96, 0.14, 0);
    lap.add(gl);
    const rimShape = roundRect(new THREE.Shape(), LENS.w, LENS.h, 0.0142);
    rimShape.holes.push(roundRect(new THREE.Path(), LENS.w - 0.0026, LENS.h - 0.0026, 0.0118));
    const rimGeo = track(new THREE.ExtrudeGeometry(rimShape, { depth: 0.0026, bevelEnabled: true, bevelThickness: 0.0004, bevelSize: 0.0004, bevelSegments: 2, curveSegments: 16 }));
    rimGeo.userData.lm = "slab";
    const lensGeo = track(new THREE.ShapeGeometry(roundRect(new THREE.Shape(), LENS.w - 0.002, LENS.h - 0.002, 0.0122), 16));
    const lensMat = track(new THREE.MeshStandardMaterial({ color: "#eaf2fb", roughness: 0.04, transparent: true, opacity: 0.1, depthWrite: false }));
    [-1, 1].forEach((sx, k) => {
      const r = new THREE.Mesh(rimGeo, frame);
      r.position.set(sx * LENS.x, 0, -0.0013);
      gl.add(r);
      const lens = new THREE.Mesh(lensGeo, lensMat);
      lens.position.set(sx * LENS.x, 0, 0.0004);
      gl.add(lens);
      // hinge, then the arm folded across behind the lenses, one over the other
      const hx = sx * (LENS.x + LENS.w + 0.0008);
      const back = -0.02 - k * 0.0042;
      rbox(0.0045, 0.0065, 0.007, 0.0012, frame, hx, 0.011, -0.004, gl);
      tube(
        [
          [hx, 0.011, -0.006],
          [hx - sx * 0.006, 0.0108, -0.015 - k * 0.003],
          [hx - sx * 0.06, 0.0095, back],
          [hx - sx * 0.112, 0.007, back - 0.001],
          [hx - sx * 0.128, 0.001, back - 0.0015],
        ],
        0.0017,
        frame,
        gl,
        40,
      );
    });
    rbox(0.0145, 0.0036, 0.0026, 0.001, frame, 0, 0.009, 0, gl);
    hitBox(0.16, 0.06, 0.17, 0.02, LAP_T + 0.03, -0.02, "signals", lap);
  }

  // ── phone → contact ────────────────────────────────────────────────────
  // An iPhone in grey titanium, face up on the mat, showing the time.
  const phone = new THREE.Group();
  phone.position.set(-0.28, ON_MAT, 0.15);
  phone.rotation.y = 0.22;
  rig.add(phone);
  const PHONE = { w: 0.0716, d: 0.1476, t: 0.0083 };
  const phoneScr = document.createElement("canvas");
  phoneScr.width = 300;
  phoneScr.height = 620;
  const phoneTex = track(new THREE.CanvasTexture(phoneScr));
  phoneTex.colorSpace = THREE.SRGBColorSpace;
  phoneTex.anisotropy = maxAniso;
  let phoneKey = "";
  function drawPhone() {
    const now = new Date();
    const stamp = `${now.getHours()}:${now.getMinutes()}`;
    if (stamp === phoneKey) return;
    phoneKey = stamp;
    const g = phoneScr.getContext("2d")!;
    const w = phoneScr.width;
    const h = phoneScr.height;
    g.fillStyle = "#020203";
    g.fillRect(0, 0, w, h);
    // always-on display: dimmed date and time
    g.textAlign = "center";
    g.fillStyle = "rgba(255,255,255,0.5)";
    g.font = `500 22px ${DISPLAY}`;
    g.fillText(fmtDate.format(now).replace(",", ""), w / 2, 112);
    g.fillStyle = "rgba(255,255,255,0.66)";
    g.font = `700 88px ${DISPLAY}`;
    g.fillText(clockText(now), w / 2, 204);
    // the island
    g.fillStyle = "#000";
    g.beginPath();
    g.roundRect(w / 2 - 44, 22, 88, 26, 13);
    g.fill();
    phoneTex.needsUpdate = true;
  }
  drawPhone();
  const phoneBody = slab(PHONE.w, PHONE.d, PHONE.t, 0.0115, std("#8b8c89", 0.34, 0.9), 0, PHONE.t / 2, 0, phone, 0.0014);
  slab(PHONE.w - 0.0022, PHONE.d - 0.0022, 0.0006, 0.0105, std("#050506", 0.12), 0, PHONE.t + 0.0001, 0, phone, 0.0002);
  {
    const glass = new THREE.Mesh(track(new THREE.PlaneGeometry(PHONE.w - 0.006, PHONE.d - 0.006)), track(new THREE.MeshBasicMaterial({ map: phoneTex, toneMapped: false })));
    glass.rotation.x = -Math.PI / 2;
    glass.position.y = PHONE.t + 0.00048;
    phone.add(glass);
  }
  markHot(phoneBody, "contact");
  hitBox(0.11, 0.045, 0.18, 0, 0.02, 0, "contact", phone);

  // ── desk lamp (right) ──────────────────────────────────────────────────
  // IKEA gooseneck: a flared white foot, a thin white stem, a yellow
  // flexible neck bent over, a small white cone of a head, and a yellow cord
  // with an inline switch.
  const lampR = new THREE.Group();
  lampR.position.set(0.5, TOP, -0.335);
  rig.add(lampR);
  const yellow = std("#e3aa1e", 0.6);
  const lampWhite = std("#f3f1ec", 0.4);
  // 12 cm weighted foot: a low cone that flares out to a thin rim.
  lathe(
    [
      [0, 0],
      [0.059, 0],
      [0.0605, 0.0025],
      [0.0595, 0.006],
      [0.05, 0.0105],
      [0.036, 0.0165],
      [0.024, 0.0235],
      [0.015, 0.032],
      [0.0095, 0.041],
      [0.0066, 0.05],
      [0, 0.05],
    ],
    lampWhite,
    0,
    0,
    0,
    lampR,
  );
  const STEM_TOP = 0.305;
  cyl(0.006, 0.006, STEM_TOP - 0.045, lampWhite, 0, (STEM_TOP + 0.045) / 2, 0, lampR, 20);
  // The gooseneck goes up, over and down toward the keyboard: most of a half
  // circle, in a plane turned a little to the left of straight ahead.
  const NECK: [number, number, number][] = [
    [0, STEM_TOP - 0.004, 0],
    [0, STEM_TOP + 0.03, 0],
  ];
  {
    const R = 0.07;
    const dx = -0.35;
    const dz = 0.937;
    for (const deg of [30, 60, 90, 120, 150]) {
      const t = THREE.MathUtils.degToRad(deg);
      const out = R * (1 - Math.cos(t));
      NECK.push([dx * out, STEM_TOP + 0.03 + R * Math.sin(t), dz * out]);
    }
  }
  tube(NECK, 0.0064, yellow, lampR, 56);
  // The head carries on from the end of the neck.
  const headAt = new THREE.Vector3(...NECK[NECK.length - 1]);
  const headDir = headAt.clone().sub(new THREE.Vector3(...NECK[NECK.length - 2])).normalize();
  const HEAD = 0.085; // neck to mouth
  const bulbRMat = track(new THREE.MeshBasicMaterial({ color: "#fff1cf", toneMapped: false }));
  {
    const head = new THREE.Group();
    head.name = "head";
    head.position.copy(headAt);
    head.quaternion.setFromUnitVectors(new THREE.Vector3(0, 1, 0), headDir);
    lampR.add(head);
    // A trumpet: 13 mm at the neck, 50 mm at the mouth, ending in a straight band.
    lathe(
      [
        [0.0064, -0.006],
        [0.0068, 0],
        [0.0085, 0.016],
        [0.0125, 0.034],
        [0.0185, 0.052],
        [0.0245, 0.069],
        [0.025, 0.072],
        [0.025, HEAD],
      ],
      track(new THREE.MeshStandardMaterial({ color: "#f3f1ec", roughness: 0.4, side: THREE.DoubleSide })),
      0,
      0,
      0,
      head,
      40,
    );
    // The LED sits behind a lens, a little way inside the mouth.
    const bulb = new THREE.Mesh(track(new THREE.CircleGeometry(0.0235, 32)), bulbRMat);
    bulb.rotation.x = -Math.PI / 2;
    bulb.position.y = HEAD - 0.01;
    bulb.userData.emit = "R";
    head.add(bulb);
  }
  {
    // The cord runs along the back of the desk and drops behind it.
    tube(
      [
        [0.5, TOP + 0.005, -0.392],
        [0.43, TOP + 0.004, -0.376],
        [0.33, TOP + 0.004, -0.362],
        [0.24, TOP + 0.004, -0.37],
        [0.17, TOP + 0.004, -0.385],
        [0.14, TOP - 0.03, -0.41],
      ],
      0.0026,
      yellow,
    );
    rbox(0.07, 0.018, 0.025, 0.006, lampWhite, 0.24, TOP + 0.009, -0.37);
  }
  switchBox(0.16, 0.44, 0.24, -0.02, 0.22, 0.07, "lampR", lampR);

  scene.updateMatrixWorld(true);
  const up = (y: number, z: number) => new THREE.Vector3(0, y, z).normalize();
  hots.push(
    { id: "console", label: "monitor · unlock", pos: screen.getWorldPosition(new THREE.Vector3()), normal: new THREE.Vector3(0, 0, 1), dist: 1.2, w: 0.76 },
    { id: "aiops", label: "succulent · AIOps, still growing", pos: worldOf(plant, 0, 0.06, 0), normal: up(0.45, 0.9), dist: 0.48 },
    { id: "stack", label: "keyboard · stack", pos: worldOf(kb, 0, 0.01, 0.045), normal: up(0.8, 0.6), dist: 0.66, w: 0.44 },
    { id: "signals", label: "laptop · signals", pos: worldOf(lap, 0, 0.02, 0), normal: up(0.7, 0.72), dist: 0.8, w: 0.36 },
    { id: "contact", label: "phone · contact", pos: worldOf(phone, 0, 0.01, 0), normal: up(0.86, 0.5), dist: 0.5 },
  );

  // ── light ──────────────────────────────────────────────────────────────
  // Baked: see lightmap.ts. Four greyscale lightmaps for the room and four
  // for the desk and what is on it, one per source: the table lamp, the desk
  // lamp, the monitor and the window. The shader adds them up, each times a
  // colour that says how bright that source is now.
  const SOURCES = ["l", "r", "m", "a"] as const;
  const grey = document.createElement("canvas");
  grey.width = grey.height = 1;
  const lmTex = [0, 1].map(() =>
    SOURCES.map(() => {
      const t = track(new THREE.Texture(grey));
      t.format = THREE.RedFormat;
      t.flipY = false;
      t.generateMipmaps = false;
      t.minFilter = t.magFilter = THREE.LinearFilter;
      t.channel = 1;
      return t;
    }),
  );
  const lmSlots = lmTex.map((set) => set.map((t) => ({ value: t })));
  const lmLevel = SOURCES.map(() => ({ value: new THREE.Color(0, 0, 0) }));
  const LM_CHUNK = THREE.ShaderChunk.lights_fragment_maps.replace(
    "vec3 lightMapIrradiance = lightMapTexel.rgb * lightMapIntensity;",
    // Stored as a square root, so the dark end keeps its detail.
    `float lmL = texture2D( tLmL, vLightMapUv ).r; float lmR = texture2D( tLmR, vLightMapUv ).r; float lmM = texture2D( tLmM, vLightMapUv ).r;
		vec3 lightMapIrradiance = lmL * lmL * uLmL + lmR * lmR * uLmR + lmM * lmM * uLmM + lightMapTexel.r * lightMapTexel.r * uLmA;`,
  );
  function bakedLight(mat: THREE.MeshStandardMaterial, atlas: number) {
    mat.lightMap = lmTex[atlas][3];
    mat.onBeforeCompile = (shader) => {
      shader.uniforms.tLmL = lmSlots[atlas][0];
      shader.uniforms.tLmR = lmSlots[atlas][1];
      shader.uniforms.tLmM = lmSlots[atlas][2];
      shader.uniforms.uLmL = lmLevel[0];
      shader.uniforms.uLmR = lmLevel[1];
      shader.uniforms.uLmM = lmLevel[2];
      shader.uniforms.uLmA = lmLevel[3];
      shader.fragmentShader =
        "uniform sampler2D tLmL; uniform sampler2D tLmR; uniform sampler2D tLmM; uniform vec3 uLmL; uniform vec3 uLmR; uniform vec3 uLmM; uniform vec3 uLmA;\n" +
        shader.fragmentShader.replace("#include <lights_fragment_maps>", LM_CHUNK);
    };
    mat.customProgramCacheKey = () => "baked";
  }
  // A material used in the room and on the desk needs a copy for each lightmap.
  const lmOwner = new Map<THREE.Material, number>();
  const lmCopy = new Map<THREE.Material, THREE.MeshStandardMaterial>();
  function litMaterial(mat: THREE.MeshStandardMaterial, atlas: number) {
    const owner = lmOwner.get(mat);
    if (owner === undefined) {
      lmOwner.set(mat, atlas);
      bakedLight(mat, atlas);
      return mat;
    }
    if (owner === atlas) return mat;
    let copy = lmCopy.get(mat);
    if (!copy) {
      copy = track(mat.clone());
      bakedLight(copy, atlas);
      lmCopy.set(mat, copy);
    }
    return copy;
  }
  // Keycaps and leaves are instanced, so they cannot each have a place in the
  // lightmap. Each one is tinted with the light that reaches it instead.
  const white1 = track(new THREE.DataTexture(new Uint8Array([255, 255, 255, 255]), 1, 1));
  white1.needsUpdate = true;

  // Every lit mesh, in scene order: the order the lightmap data is stored in.
  type Lit = { mesh: THREE.Mesh; atlas: number; charts: Chart[]; from?: THREE.Mesh; each: number; base?: Float32Array };
  const lit: Lit[] = [];
  {
    const taken = new Set<THREE.BufferGeometry>();
    scene.traverse((o) => {
      const m = o as THREE.Mesh;
      const mat = m.material as THREE.MeshStandardMaterial;
      if (!m.isMesh || !mat.isMeshStandardMaterial || mat.transparent) return;
      let atlas = 0;
      for (let p = m.parent; p; p = p.parent) if (p === rig) atlas = 1;
      const inst = m as THREE.InstancedMesh;
      const from = m.userData.lmFrom as THREE.Mesh | undefined;
      const charts = from ? [] : chartsOf(m.geometry);
      if (inst.isInstancedMesh) {
        mat.lightMap = white1;
        mat.lightMapIntensity = Math.PI;
        lit.push({ mesh: m, atlas, charts, each: inst.count, base: inst.instanceColor ? Float32Array.from(inst.instanceColor.array as Float32Array) : undefined });
        return;
      }
      // Two meshes sharing a geometry each need their own place in the lightmap.
      if (taken.has(m.geometry)) m.geometry = track(m.geometry.clone());
      taken.add(m.geometry);
      m.material = litMaterial(mat, atlas);
      lit.push({ mesh: m, atlas, charts, from, each: 0 });
    });
  }
  const baking = import.meta.env.DEV && new URLSearchParams(location.search).has("bake");
  let layout = LM.rects;
  if (baking) {
    // Bake time: size each chart from the surface it covers and pack them.
    const sizes: [number, number][][] = [[], []];
    const where: [number, number, number][] = []; // lit index, first slot, slots
    lit.forEach((e, i) => {
      const list = sizes[e.atlas];
      const first = list.length;
      if (e.each) for (let k = 0; k < e.each * e.charts.length; k++) list.push([8, 8]);
      else if (!e.from) {
        const fixed = e.mesh.userData.lmSize as [number, number] | undefined;
        const density = (e.mesh.userData.lmDensity as number | undefined) ?? (e.atlas ? 950 : 280);
        const slabby = e.mesh.geometry.userData.lm === "slab";
        chartSpans(e.mesh.geometry, e.charts, e.mesh.matrixWorld).forEach(([su, sv], k) => {
          // The underside of a slab is rarely seen; its edge is long and plain.
          const d = density * (slabby && k === 0 ? 0.3 : 1);
          const w = fixed ? fixed[0] : Math.min(slabby && k === 2 ? 900 : 1300, Math.max(2, Math.ceil(su * d)));
          const h = fixed ? fixed[1] : Math.min(1300, Math.max(2, Math.ceil(sv * d)));
          list.push([w + 2 * PAD, h + 2 * PAD]);
        });
      }
      where.push([i, first, list.length - first]);
    });
    sizes.forEach((list, a) => {
      const big = list.map(([w, h], k) => [w * h, w, h, k]).sort((p, q) => q[0] - p[0]).slice(0, 14);
      console.info(`lightmap ${a}: ${list.length} charts, ${(list.reduce((t, [w, h]) => t + w * h, 0) / LM.size ** 2 * 100).toFixed(0)}% of the area; largest ${big.map(([, w, h]) => `${w}x${h}`).join(" ")}`);
    });
    const packed = sizes.map((list) => pack(list, LM.size));
    layout = where.map(([i, first, n]) => packed[lit[i].atlas].slice(first, first + n).flat());
  }
  const stale = !baking && (layout.length !== lit.length || lit.some((e, i) => LM.verts[i] !== e.mesh.geometry.attributes.position.count));
  if (stale) console.warn("The lightmaps do not match the scene. Re-bake (tools/bake).");
  const rectsOf = (i: number): Rect[] => {
    const flat = layout[i] ?? [];
    return Array.from({ length: flat.length / 4 }, (_, k) => flat.slice(4 * k, 4 * k + 4) as Rect);
  };
  // Lightmap coordinates that slide as the desk rises (the wall, the curtain).
  const sliding: { attr: THREE.BufferAttribute; base: Float32Array; perMetre: number; rows: THREE.BufferAttribute }[] = [];
  if (!stale) {
    lit.forEach((e, i) => {
      if (e.each) return;
      const geo = e.mesh.geometry;
      const n = geo.attributes.position.count;
      let uv1: Float32Array;
      if (e.from) {
        // Round the stand-in's side at the same height above the floor.
        const [x, y, w, h] = rectsOf(lit.findIndex((o) => o.mesh === e.from))[0];
        const y0 = e.mesh.getWorldPosition(new THREE.Vector3()).y;
        uv1 = new Float32Array(n * 2);
        for (let v = 0; v < n; v++) {
          uv1[2 * v] = (x + PAD + geo.attributes.uv.getX(v) * (w - 2 * PAD)) / LM.size;
          uv1[2 * v + 1] = (y + PAD + THREE.MathUtils.clamp((y0 + geo.attributes.position.getY(v)) / PROBE_H, 0, 1) * (h - 2 * PAD)) / LM.size;
        }
      } else uv1 = placeCharts(n, e.charts, rectsOf(i), LM.size);
      const attr = new THREE.BufferAttribute(uv1, 2);
      geo.setAttribute("uv1", attr);
      e.mesh.userData.lmUv = attr;
      const rise = e.mesh.userData.lmRise as number | undefined;
      if (rise) sliding.push({ attr, base: uv1.slice(), perMetre: (rectsOf(i)[0][3] - 2 * PAD) / LM.size / rise, rows: geo.attributes.position as THREE.BufferAttribute });
    });
  }
  /** Move the wall's and curtain's light up with the desk. */
  function slideLight(y: number) {
    for (const s of sliding) {
      for (let v = 0; v < s.attr.count; v++) if (s.rows.getY(v) > 0.01) s.attr.setY(v, s.base[2 * v + 1] + y * s.perMetre);
      s.attr.needsUpdate = true;
    }
  }
  // The lightmaps themselves. Until they arrive, and if they never do, the
  // scene is lit flat.
  const lightmapsIn = Promise.all(
    ["room", "desk"].flatMap((name, a) =>
      SOURCES.map(
        (src, k) =>
          new Promise<void>((done) => {
            const img = new Image();
            img.onload = () => {
              lmTex[a][k].image = img;
              lmTex[a][k].needsUpdate = true;
              done();
            };
            img.onerror = () => done();
            img.src = `/lightmap/${name}-${src}.webp`;
          }),
      ),
    ),
  );
  {
    const g = grey.getContext("2d")!;
    g.fillStyle = "#555";
    g.fillRect(0, 0, 1, 1);
    for (const t of lmTex.flat()) t.needsUpdate = true;
  }
  // How bright each source is at full, and its colour.
  const GAIN = [5, 170, 9, 5];
  const TINT = [new THREE.Color(1, 0.8, 0.58), new THREE.Color(1, 0.82, 0.6), new THREE.Color(0.62, 0.8, 0.86), new THREE.Color(0.72, 0.8, 1)];
  const DAYLIGHT = new THREE.Color(1, 0.97, 0.92);
  const lightNow = [0, 0, 0, 0];
  let lightSig = "";
  const instTint = new THREE.Color();
  /** Set the four sources' levels (0..1; the window's is the daylight). */
  function setLight(L: number, R: number, S: number, day: number) {
    const amount = [L, R, S, 0.16 + day * 1.6];
    const key = amount.map((a) => a.toFixed(3)).join();
    if (key === lightSig) return;
    lightSig = key;
    amount.forEach((a, k) => {
      lightNow[k] = a * GAIN[k] * LM.k[k];
      lmLevel[k].value.copy(k === 3 ? instTint.copy(TINT[3]).lerp(DAYLIGHT, day) : TINT[k]).multiplyScalar(lightNow[k] * Math.PI);
    });
    // The instanced meshes: each instance's own colour times its light.
    let keysLit = 0;
    lit.forEach((e, i) => {
      if (!e.each || !e.base) return;
      const inst = e.mesh as THREE.InstancedMesh;
      const got = LM.inst[i];
      const out = inst.instanceColor!.array as Float32Array;
      for (let n = 0; n < e.each; n++) {
        instTint.setRGB(0, 0, 0);
        for (let k = 0; k < 4; k++) {
          const c = lmLevel[k].value;
          const amt = (got ? got[4 * n + k] : 0.1) / (LM.k[k] * Math.PI);
          instTint.r += c.r * amt;
          instTint.g += c.g * amt;
          instTint.b += c.b * amt;
        }
        out[3 * n] = e.base[3 * n] * instTint.r;
        out[3 * n + 1] = e.base[3 * n + 1] * instTint.g;
        out[3 * n + 2] = e.base[3 * n + 2] * instTint.b;
        if (inst === caps) keysLit += (instTint.r + instTint.g + instTint.b) / 3 / e.each;
      }
      inst.instanceColor!.needsUpdate = true;
    });
    legendMat?.color.setScalar(Math.min(1, keysLit * 1.6));
  }

  if (baking) {
    // tools/bake reads the whole scene through this: every lit mesh in world
    // space with its lightmap coordinates, and the things that give light.
    const b64 = (a: ArrayBufferView) => {
      const bytes = new Uint8Array(a.buffer, a.byteOffset, a.byteLength);
      let out = "";
      for (let i = 0; i < bytes.length; i += 0x8000) out += String.fromCharCode(...bytes.subarray(i, i + 0x8000));
      return btoa(out);
    };
    const shape = (mesh: THREE.Mesh, world: THREE.Matrix4, uv1: Float32Array | null) => {
      const geo = mesh.geometry;
      const n = geo.attributes.position.count;
      const pos = new Float32Array(n * 3);
      const nrm = new Float32Array(n * 3);
      const v = new THREE.Vector3();
      const nm = new THREE.Matrix3().getNormalMatrix(world);
      for (let i = 0; i < n; i++) {
        v.fromBufferAttribute(geo.attributes.position, i).applyMatrix4(world).toArray(pos, 3 * i);
        v.fromBufferAttribute(geo.attributes.normal, i).applyMatrix3(nm).normalize().toArray(nrm, 3 * i);
      }
      const idx = geo.index ? Uint32Array.from(geo.index.array) : Uint32Array.from({ length: n }, (_, i) => i);
      return { pos: b64(pos), nrm: b64(nrm), idx: b64(idx), uv: uv1 ? b64(uv1) : null };
    };
    (window as unknown as { __bake: () => unknown }).__bake = () => {
      scene.updateMatrixWorld(true);
      const meshes: unknown[] = [];
      const m4b = new THREE.Matrix4();
      lit.forEach((e, i) => {
        const mat = e.mesh.material as THREE.MeshStandardMaterial;
        const color = (mat.userData.bake as string | undefined) ?? `#${mat.color.getHexString()}`;
        const common = { i, atlas: e.atlas, color, role: (e.mesh.userData.bakeRole as string | undefined) ?? "" };
        if (e.each) {
          const inst = e.mesh as THREE.InstancedMesh;
          const per = e.charts.length;
          for (let n = 0; n < e.each; n++) {
            inst.getMatrixAt(n, m4b);
            m4b.premultiply(inst.matrixWorld);
            const rects = rectsOf(i).slice(n * per, (n + 1) * per);
            meshes.push({ ...common, kind: "target", inst: n, ...shape(inst, m4b, placeCharts(inst.geometry.attributes.position.count, e.charts, rects, LM.size)) });
          }
        } else {
          const kind = e.from ? "solid" : e.mesh.visible ? "target" : "probe";
          meshes.push({ ...common, kind, ...shape(e.mesh, e.mesh.matrixWorld, e.from ? null : (e.mesh.geometry.attributes.uv1.array as Float32Array)) });
        }
      });
      scene.traverse((o) => {
        const m = o as THREE.Mesh;
        if (m.isMesh && m.userData.emit) meshes.push({ i: -1, atlas: -1, color: "#ffffff", role: "", kind: `emit:${m.userData.emit}`, ...shape(m, m.matrixWorld, null) });
      });
      return {
        size: LM.size,
        pad: PAD,
        rects: layout,
        verts: lit.map((e) => e.mesh.geometry.attributes.position.count),
        each: lit.map((e) => [e.each, e.charts.length]),
        meshes,
      };
    };
  }

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
    // The desk fills the frame, with a little room either side, seen from
    // about where the photographs were taken. The view follows the desk most
    // of the way up when it is raised.
    const dist = Math.max(1.3, portrait ? 0.62 / (tanV * aspect) : DD / 2 + 0.66 / (tanV * aspect));
    const lift = rigY * 0.8;
    home.look.set(0, TOP + (portrait ? 0.08 : 0.2) + lift, -0.05);
    home.pos.set(-0.03, TOP + (portrait ? 0.3 : 0.42) + lift, dist);
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
  // Ambient occlusion grounds every object where it meets the desk; a mild
  // depth of field softens the room in close-ups only (the wide view is in
  // focus front to back, like the photographs); a little bloom lets the
  // lamps and the screen glow; a last pass darkens the corners slightly.
  const fine = !small;
  const target = track(new THREE.WebGLRenderTarget(4, 4, { type: THREE.HalfFloatType, samples: small ? 0 : 4 }));
  if (fine) target.depthTexture = new THREE.DepthTexture(4, 4);
  const composer = new EffectComposer(renderer, target);
  composer.addPass(new RenderPass(scene, camera));
  // The blur needs the depth of the frame it is blurring: that is in whichever
  // buffer the composer hands the pass to read.
  class DofPass extends ShaderPass {
    render(...args: Parameters<ShaderPass["render"]>) {
      this.uniforms.tDepth.value = args[2].depthTexture;
      super.render(...args);
    }
  }
  const VERT = "varying vec2 vUv; void main(){ vUv = uv; gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0); }";
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
      float coc(float d){ return min(abs(d - uFocus) / d * uAperture, 8.0); }
      void main(){
        float c0 = coc(dist(vUv));
        vec3 sum = texture2D(tDiffuse, vUv).rgb;
        float n = 1.0;
        for (int i = 1; i <= 32; i++){
          float f = float(i);
          float r = sqrt(f / 32.0) * c0;
          vec2 uv = vUv + vec2(cos(f * 2.39996), sin(f * 2.39996)) * r * uPx;
          float w = clamp(coc(dist(uv)) - r + 1.0, 0.0, 1.0);
          sum += texture2D(tDiffuse, uv).rgb * w;
          n += w;
        }
        gl_FragColor = vec4(sum / n, 1.0);
      }`,
  });
  if (fine) composer.addPass(dof);
  let focus = 2;
  let aperture = 0;
  // Only the bulbs are brighter than white, so only they glow.
  const bloom = new UnrealBloomPass(new THREE.Vector2(4, 4), 0.22, 0.5, 1);
  composer.addPass(bloom);
  composer.addPass(new OutputPass());
  const lens = new ShaderPass({
    uniforms: { tDiffuse: { value: null } },
    vertexShader: VERT,
    fragmentShader: `uniform sampler2D tDiffuse; varying vec2 vUv;
      void main(){
        vec4 c = texture2D(tDiffuse, vUv);
        vec2 d = vUv - 0.5;
        c.rgb *= mix(1.0, 0.72, smoothstep(0.25, 0.95, dot(d, d) * 2.2));
        gl_FragColor = c;
      }`,
  });
  composer.addPass(lens);

  let stageW = 1;
  let stageH = 1;
  // Lowered, a step at a time, if the device cannot keep up.
  let quality = 1;
  let stillSig = "";
  let stillAt = 0;
  let slow = 0;
  let timed = 0;
  function resize() {
    const w = stage.clientWidth;
    const h = stage.clientHeight;
    if (!w || !h) return;
    stageW = w;
    stageH = h;
    aspect = w / h;
    // A big, dense screen (4K at 2x) would mean eight million pixels a frame.
    // Past about three and a half million the extra is not visible in a scene
    // this soft, so the pixel ratio comes down to fit, and further if frames
    // are slow (see `quality`).
    const budget = Math.sqrt(3.5e6 / (w * h));
    renderer.setPixelRatio(Math.max(0.75, Math.min(window.devicePixelRatio || 1, small ? 1.5 : 2, budget) * quality));
    renderer.setSize(w, h, false);
    const pr = renderer.getPixelRatio();
    composer.setPixelRatio(pr);
    composer.setSize(w, h);
    // Blur is set in pixels of a 900px-tall frame, so it looks the same at any size.
    const ph = h * renderer.getPixelRatio();
    dof.uniforms.uPx.value.set(ph / 900 / (w * renderer.getPixelRatio()), 1 / 900);
    camera.aspect = aspect;
    camera.updateProjectionMatrix();
    place();
    dirty = true;
    stillSig = "";
  }

  // ── interaction ────────────────────────────────────────────────────────
  const ray = new THREE.Raycaster();
  const ptr = new THREE.Vector2(0, 0);
  const par = new THREE.Vector2(0, 0);
  const byId = (id: string | null) => hots.find((h) => h.id === id) ?? null;

  // The things that switch: both lamps and the desk's motor.
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
        : `standing desk · ${deskUp ? "lower it" : "raise it"}`;
  function toggle(t: string) {
    if (t === "lampR") lampROn = !lampROn;
    else if (t === "lampL") lampLOn = !lampLOn;
    else if (t === "desk") deskUp = !deskUp;
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
  const orbit = { yaw: 0, pitch: 0, nowYaw: 0, nowPitch: 0 };
  let drag: { x: number; y: number; id: number; moved: boolean } | null = null;
  let dragged = false;

  function pickRaw(e: PointerEvent | MouseEvent) {
    const r = canvas.getBoundingClientRect();
    ptr.set(((e.clientX - r.left) / r.width) * 2 - 1, -((e.clientY - r.top) / r.height) * 2 + 1);
    ray.setFromCamera(ptr, camera);
    return ray.intersectObjects(hitTargets, false)[0]?.object ?? null;
  }
  function clearHover() {
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
    // A second click on the monitor (a double-click, or an impatient one
    // while it unlocks) is not a request to leave it.
    if (h === consoleHot && selected === consoleHot) return;
    on.select(h && h !== selected ? h.id : null);
  }
  canvas.addEventListener("pointerdown", onDown);
  canvas.addEventListener("pointermove", onMove);
  canvas.addEventListener("pointerup", onUp);
  canvas.addEventListener("pointercancel", onUp);
  canvas.addEventListener("pointerleave", onLeave);
  canvas.addEventListener("click", onClick);
  window.addEventListener("keydown", onKeyDown);
  window.addEventListener("keyup", onKeyUp);
  window.addEventListener("blur", onBlur);
  // After a lost GPU context comes back, the reduced-motion path (which only
  // draws on change) needs telling that the canvas is blank.
  const onRestore = () => {
    dirty = true;
    stillSig = "";
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
  // Keeps the clocks current under reduced motion.
  const minute = window.setInterval(() => (dirty = true), 20_000);

  resize();
  // Start pulled back and ease in.
  camera.position.copy(home.pos).add(new THREE.Vector3(reduced ? 0 : -0.2, reduced ? 0 : 0.12, reduced ? 0 : 1.0));
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
  const shadeMat = shade.material as THREE.MeshBasicMaterial;
  const screenMat = screen.material as THREE.MeshBasicMaterial;
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
      legMid.position.y = rigY / 2;
      slideLight(rigY);
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
    const px = selected || reduced ? 0 : par.x * 0.08;
    const py = selected || reduced ? 0 : par.y * 0.04;
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

    // Keys spring back.
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

    // Light. The opening beat: the room is dim, the table lamp stutters on,
    // the desk lamp follows, and the monitor wakes.
    const wantDay = document.documentElement.getAttribute("data-theme") === "light" ? 1 : 0;
    day += (wantDay - day) * (reduced ? 1 : 1 - Math.exp(-dt * 4));
    const ease = reduced ? 1 : 1 - Math.exp(-dt * 12);
    lampRLevel += ((lampROn && (reduced || time > 1.25) ? 1 : 0) - lampRLevel) * ease;
    lampLLevel += ((lampLOn ? 1 : 0) - lampLLevel) * ease;
    const ramp = (t0: number, dur: number) => (reduced ? 1 : THREE.MathUtils.clamp((time - t0) / dur, 0, 1));
    const flick = reduced || time > 1.15 ? 1 : Math.sin(time * 85) > -0.2 ? 1 : 0.3;
    const L = ramp(0.55, 0.1) * flick * lampLLevel;
    const R = lampRLevel;
    const S = ramp(1.9, 0.8);
    setLight(L, R, S, day);
    shadeMat.color.setRGB(0.2 + 0.8 * L, 0.19 + 0.77 * L, 0.17 + 0.68 * L);
    bulbLMat.color.setRGB(0.16 + 1.5 * L, 0.14 + 1.3 * L, 0.1 + 0.95 * L);
    bulbRMat.color.setRGB(0.2 + 1.7 * R, 0.18 + 1.45 * R, 0.14 + 1.0 * R);
    screenMat.color.setScalar(S);
    (scene.background as THREE.Color).copy(bgDark).lerp(bgLight, day);
    (scene.fog as THREE.Fog).color.copy(scene.background as THREE.Color);

    // The curtain moves a little in the draught.
    if (!reduced && curtain) {
      const cp = curtain.attributes.position;
      for (let i = 0; i < cp.count; i++) {
        const x = cp.getX(i);
        const free = 1 - 0.75 * (cp.getY(i) / CURTAIN_H); // the hem moves more than the top
        cp.setZ(i, fold(x) + Math.sin(time * 0.7 + x * 3.2) * 0.008 * free);
      }
      cp.needsUpdate = true;
    }

    drawScreen();
    drawPhone();
    // At the computer the desktop covers the scene and nothing in it moves:
    // once the picture has stopped changing, stop drawing it.
    const sig = osOn ? `${screenKey}|${lightSig}|${rigY.toFixed(4)}|${camera.position.toArray().map((v) => v.toFixed(4))}` : "";
    if (sig && sig === stillSig) {
      if (time - stillAt > 0.5) return;
    } else {
      stillSig = sig;
      stillAt = time;
    }
    if (fine) {
      // Pull focus to whatever the camera is looking at. The lens is only
      // opened for close-ups; the wide view stays sharp throughout.
      const kf = reduced ? 1 : 1 - Math.exp(-dt * 5);
      focus += (camera.position.distanceTo(look) - focus) * kf;
      aperture += ((selected && !using ? 11 : 0) - aperture) * kf;
      dof.enabled = aperture > 0.4;
      dof.uniforms.uFocus.value = focus;
      dof.uniforms.uAperture.value = aperture;
    }
    composer.render();
    // If frames are slow once things have settled, give up some sharpness.
    if (!reduced && time > 4 && quality > 0.55) {
      slow += dt;
      if (++timed === 45) {
        if (slow / timed > 1 / 40) {
          quality *= 0.8;
          resize();
        }
        slow = timed = 0;
      }
    }
  }
  // Wait for the baked light, but not for ever.
  await Promise.race([lightmapsIn, new Promise((done) => setTimeout(done, 6000))]);
  frame();

  return {
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
