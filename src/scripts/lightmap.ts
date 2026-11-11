// Baked lighting for the desk (rack.ts).
//
// The light in the scene is not worked out in the browser. It is path-traced
// once, offline, in Blender (tools/bake), and stored as lightmaps: for each
// of four light sources (the table lamp, the desk lamp, the monitor and the
// window) a greyscale image of how much light reaches every surface. The
// page adds the four together, each times how bright that source is right
// now, so the lamps still switch.
//
// Every lit mesh owns one or more rectangles ("charts") of a lightmap. This
// file decides how a mesh's surface is laid into its charts. That must come
// out the same in the browser as it did when the lightmaps were baked, on
// every machine, so which chart a vertex belongs to is decided by counting
// (index ranges, the geometry's own groups), never by comparing computed
// coordinates. Where the charts sit in the image is not computed here at
// all: it was fixed at bake time and is read from data/lightmap.ts.
import * as THREE from "three";

/** Unused border inside each chart, in texels, so neighbours do not bleed. */
export const PAD = 3;

export type Rect = [x: number, y: number, w: number, h: number];
/** Some of a geometry's vertices, and where each sits in the chart (0..1). */
export type Chart = { verts: Uint32Array; uv: Float32Array };

const range = (start: number, count: number) => Uint32Array.from({ length: count }, (_, i) => start + i);

/**
 * An extruded outline (the desk top, the mat, a laptop): the lid at each end
 * seen flat, and the edge unrolled into one strip.
 */
function slabCharts(geo: THREE.BufferGeometry): Chart[] {
  const pos = geo.attributes.position;
  const [lids, sides] = geo.groups;
  geo.computeBoundingBox();
  const box = geo.boundingBox!;
  const size = [box.max.x - box.min.x, box.max.y - box.min.y, box.max.z - box.min.z];
  const min = [box.min.x, box.min.y, box.min.z];
  // The thin way is the way it was extruded; the lids are flat across the other two.
  const thin = size.indexOf(Math.min(...size));
  const a = thin === 0 ? 1 : 0;
  const b = thin === 2 ? 1 : 2;
  const at = (i: number, k: number) => (k === 0 ? pos.getX(i) : k === 1 ? pos.getY(i) : pos.getZ(i));
  const half = lids.count / 2;
  const lid = (start: number): Chart => {
    const verts = range(start, half);
    const uv = new Float32Array(half * 2);
    verts.forEach((v, k) => {
      uv[2 * k] = (at(v, a) - min[a]) / size[a];
      uv[2 * k + 1] = (at(v, b) - min[b]) / size[b];
    });
    return { verts, uv };
  };
  // The edge is built quad by quad, round the outline, in layers from one lid
  // to the other: six vertices a quad, in the order a b d, b c d.
  const o = (geo as THREE.ExtrudeGeometry).parameters.options;
  const layers = (o.steps ?? 1) + 2 * (o.bevelEnabled === false ? 0 : (o.bevelSegments ?? 3));
  const round = sides.count / 6 / layers;
  const edge = range(sides.start, sides.count);
  const uv = new Float32Array(sides.count * 2);
  for (let k = 0; k < sides.count; k++) {
    const quad = Math.floor(k / 6);
    const corner = k % 6;
    const along = Math.floor(quad / layers) + (corner === 1 || corner === 3 || corner === 4 ? 1 : 0);
    const across = (quad % layers) + (corner === 2 || corner === 4 || corner === 5 ? 1 : 0);
    uv[2 * k] = along / round;
    uv[2 * k + 1] = across / layers;
  }
  return [lid(lids.start), lid(lids.start + half), { verts: edge, uv }];
}

/**
 * How a geometry is cut into charts.
 * - `userData.lmParam` (two numbers a vertex): one chart, laid out as given.
 * - `userData.lm === "slab"`: an extrusion, see above.
 * - with groups (boxes, capped cylinders): one chart a group, by its own UVs.
 * - otherwise one chart, by its own UVs (lathes, tubes, spheres, planes).
 */
export function chartsOf(geo: THREE.BufferGeometry): Chart[] {
  const n = geo.attributes.position.count;
  const given = geo.userData.lmParam as Float32Array | undefined;
  if (given) return [{ verts: range(0, n), uv: given }];
  if (geo.userData.lm === "slab") return slabCharts(geo);
  const uv = geo.attributes.uv as THREE.BufferAttribute;
  const pick = (verts: Uint32Array): Chart => {
    const out = new Float32Array(verts.length * 2);
    verts.forEach((v, k) => {
      out[2 * k] = uv.getX(v);
      out[2 * k + 1] = uv.getY(v);
    });
    return { verts, uv: out };
  };
  if (geo.groups.length < 2) return [pick(range(0, n))];
  return geo.groups.map((g) => {
    if (!geo.index) return pick(range(g.start, g.count));
    const seen = new Set<number>();
    for (let i = g.start; i < g.start + g.count; i++) seen.add(geo.index.getX(i));
    return pick(Uint32Array.from(seen));
  });
}

/** Where each vertex falls in the lightmap, given its charts' rectangles. */
export function placeCharts(count: number, charts: Chart[], rects: Rect[], size: number) {
  const out = new Float32Array(count * 2);
  charts.forEach((c, k) => {
    const [x, y, w, h] = rects[k];
    c.verts.forEach((v, j) => {
      out[2 * v] = (x + PAD + c.uv[2 * j] * (w - 2 * PAD)) / size;
      out[2 * v + 1] = (y + PAD + c.uv[2 * j + 1] * (h - 2 * PAD)) / size;
    });
  });
  return out;
}

// ── bake time only (the dev server, ?bake): sizing and packing the charts ──

/** How many metres one unit of each chart covers, along u and along v. */
export function chartSpans(geo: THREE.BufferGeometry, charts: Chart[], world: THREE.Matrix4): [number, number][] {
  const pos = geo.attributes.position;
  const n = pos.count;
  const which = new Int32Array(n).fill(-1);
  const pu = new Float32Array(n);
  const pv = new Float32Array(n);
  charts.forEach((c, k) =>
    c.verts.forEach((v, j) => {
      which[v] = k;
      pu[v] = c.uv[2 * j];
      pv[v] = c.uv[2 * j + 1];
    }),
  );
  const P = Array.from({ length: n }, (_, i) => new THREE.Vector3().fromBufferAttribute(pos, i).applyMatrix4(world));
  const acc = charts.map(() => [0, 0, 0]);
  const e1 = new THREE.Vector3();
  const e2 = new THREE.Vector3();
  const du = new THREE.Vector3();
  const dv = new THREE.Vector3();
  const tris = geo.index ? geo.index.count / 3 : n / 3;
  for (let t = 0; t < tris; t++) {
    const i0 = geo.index ? geo.index.getX(3 * t) : 3 * t;
    const i1 = geo.index ? geo.index.getX(3 * t + 1) : 3 * t + 1;
    const i2 = geo.index ? geo.index.getX(3 * t + 2) : 3 * t + 2;
    const k = which[i0];
    if (k < 0 || which[i1] !== k || which[i2] !== k) continue;
    const u1 = pu[i1] - pu[i0];
    const u2 = pu[i2] - pu[i0];
    const v1 = pv[i1] - pv[i0];
    const v2 = pv[i2] - pv[i0];
    const det = u1 * v2 - u2 * v1;
    if (Math.abs(det) < 1e-12) continue;
    e1.subVectors(P[i1], P[i0]);
    e2.subVectors(P[i2], P[i0]);
    du.copy(e1).multiplyScalar(v2).addScaledVector(e2, -v1).divideScalar(det);
    dv.copy(e2).multiplyScalar(u1).addScaledVector(e1, -u2).divideScalar(det);
    const w = Math.abs(det);
    acc[k][0] += w;
    acc[k][1] += w * du.length();
    acc[k][2] += w * dv.length();
  }
  return acc.map(([w, lu, lv]) => (w ? [lu / w, lv / w] : [0, 0]));
}

/** Pack rectangles of the given sizes into a square, tallest first, in rows. */
export function pack(sizes: [number, number][], size: number): Rect[] {
  const order = sizes.map((_, i) => i).sort((p, q) => sizes[q][1] - sizes[p][1] || sizes[q][0] - sizes[p][0] || p - q);
  const out: Rect[] = sizes.map(() => [0, 0, 0, 0]);
  let x = 0;
  let y = 0;
  let row = 0;
  for (const i of order) {
    const [w, h] = sizes[i];
    if (x + w > size) {
      x = 0;
      y += row;
      row = 0;
    }
    if (w > size || y + h > size) throw new Error(`lightmap is full (${size}px): lower a density`);
    out[i] = [x, y, w, h];
    x += w;
    row = Math.max(row, h);
  }
  return out;
}
