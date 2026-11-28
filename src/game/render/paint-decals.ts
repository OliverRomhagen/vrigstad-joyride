// Plåt-Pelle's decals on a car (sim/paint-jobs.ts): flames, rally stripes and a rally number, projected onto the car's painted panels
// with three's DecalGeometry, so they follow the body's curves. The textures are drawn once on a canvas and shared by every car;
// each car's decal geometry is its own, and disposeDecal frees it.
import * as THREE from 'three';
import { DecalGeometry } from 'three/addons/geometries/DecalGeometry.js';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';
import { DECALS, type Decal, RALLY_NUMBER } from '../sim/paint-jobs';

/** The name on a decal's meshes, so the driver's view clips them with the body they're painted on (cockpit.ts). */
export const DECAL_NODE = 'decal';

/** A painted panel, and the matrix that places it in the car's frame (metres; x right, y up, -z forward). */
export interface Panel {
  geometry: THREE.BufferGeometry;
  toFrame: THREE.Matrix4;
}

const stand = new THREE.Mesh(); // a stand-in for each panel: DecalGeometry reads only a mesh's geometry and matrixWorld
const FACING = 0.45; // a decal shows fully where its panel faces the projector at least this much (the cosine of the angle)
const FADE = 0.25; // and fades out over this much less
// the bonnet's flames take panels facing up and a little forward, so they follow its curve down to the nose but stay off the
// wings' rounded shoulders, where they would smear into straight streaks
const BONNET_FACING = new THREE.Vector3(0, 1, -0.5).normalize();
const BONNET_FACING_MIN = 0.7;
const AHEAD = 0.04; // the flames start this share of the car's length ahead of its nose, so their solid roots cover it
const GLASS_EDGE_M = 0.03; // a decal triangle this near the top or bottom of a model's glass stays: the roof and the bonnet's back edge
const LIFT_M = 0.006; // a decal stands this far off the paint, so it doesn't flicker into it, yet stays under a model's glass
const RALLY_DISC_M = 0.62; // across the rally number's disc
const NUMBER_AT = 0.45; // where along the car the rally number goes, as a share of its length from the nose
const RALLY_DISC_FILL = 0.85; // the most of the door's painted height the disc takes, so a shallow door shrinks it rather than cut it
const SPAN_STEP_M = 0.02; // how far apart the rays that find a side's visible paint are, top to bottom
const SPAN_FROM_M = 5; // where they start, out from the car's middle: beyond any car's side
const SPAN_TRIM_M = 0.05; // a strip this thin across the paint is trim, and the paint runs on past it; a sill is taller
const SPAN_MIN_M = 0.1; // less paint than this showing, the number takes the fixed spot rather than shrink to a speck
const STRIPES_M = 0.6; // across both rally stripes and the gap between them
const LIGHT_PAINT = 0.62; // a paint lighter than this (0–1) gets dark stripes, else light ones, so they always show

/** Where a model wants its rally number instead: along the car (share of its length from the nose), and lifted (m). */
export type NumberAt = { readonly at?: number; readonly lift?: number };

type Projector = {
  pos: THREE.Vector3;
  rot: THREE.Euler;
  size: THREE.Vector3; // across, up and deep, in the projector's own axes; it paints along its z
  facing: THREE.Vector3; // the way the panels it paints face, in the car's frame
  facingMin?: number; // how squarely they must face it; FACING when not given
  tex: THREE.Texture;
};

/**
 * The meshes of `decal` on `panels`, placed in the car's frame; `paint`, the car's colour, picks the stripes' colour. `glass` is the
 * box of a model's windows in the same frame: a model's body runs on under its glass, so the decal is cut away there. `sideSpan`
 * tells how far up a model's side its paint shows, for the rally number (sideSpanByRays); `numberAt` moves the number on a model
 * that needs it (vehicle-registry.ts rallyNumber).
 */
export function decalMeshes(
  decal: Decal,
  paint: string,
  panels: readonly Panel[],
  glass: THREE.Box3 | null = null,
  sideSpan: SideSpan | null = null,
  numberAt?: NumberAt,
): THREE.Mesh[] {
  const box = new THREE.Box3(),
    part = new THREE.Box3();
  for (const p of panels) {
    p.geometry.boundingBox ?? p.geometry.computeBoundingBox();
    box.union(part.copy(p.geometry.boundingBox!).applyMatrix4(p.toFrame));
  }
  if (box.isEmpty()) return [];
  const out: THREE.Mesh[] = [];
  for (const pr of projectors(decal, paint, box, glass, sideSpan, numberAt)) {
    const pieces: THREE.BufferGeometry[] = [];
    for (const p of panels) {
      stand.geometry = p.geometry;
      stand.matrixWorld.copy(p.toFrame);
      const decal = new DecalGeometry(stand, pr.pos, pr.rot, pr.size),
        facing = facingOnly(decal, pr.facing, pr.facingMin ?? FACING, glass);
      if (facing) pieces.push(facing);
    }
    if (!pieces.length) continue;
    const geo = pieces.length === 1 ? pieces[0]! : mergeGeometries(pieces);
    if (pieces.length > 1) for (const g of pieces) g.dispose();
    if (!geo) continue;
    const m = new THREE.Mesh(geo, material(pr.tex));
    m.name = DECAL_NODE;
    m.receiveShadow = true;
    out.push(m);
  }
  return out;
}

/** Takes a car's decal meshes off it and frees their geometry; the textures and materials are shared, and stay. */
export function disposeDecal(meshes: readonly THREE.Mesh[]) {
  for (const m of meshes) {
    m.removeFromParent();
    m.geometry.dispose();
  }
}

// where each decal goes, from the painted panels' box in the car's frame
function projectors(
  decal: Decal,
  paint: string,
  box: THREE.Box3,
  glass: THREE.Box3 | null,
  sideSpan: SideSpan | null,
  numberAt: NumberAt | undefined,
): Projector[] {
  const { min, max } = box,
    L = max.z - min.z,
    W = max.x - min.x,
    H = max.y - min.y,
    cx = (min.x + max.x) / 2;
  // on a side, s = 1 the right: its texture's u runs towards the nose on the right and the tail on the left
  const side = (s: 1 | -1, zc: number, zLen: number, yc: number, yLen: number, tex: THREE.Texture): Projector => ({
    pos: new THREE.Vector3(cx + (s * W) / 2, yc, zc),
    rot: new THREE.Euler(0, (s * Math.PI) / 2, 0),
    size: new THREE.Vector3(zLen, yLen, W),
    facing: new THREE.Vector3(s, 0, 0),
    tex,
  });
  // from above: its texture's u runs to the right, v towards the nose; it reaches the top 60 % of the body
  const top = (zc: number, zLen: number, xLen: number, tex: THREE.Texture): Projector => ({
    pos: new THREE.Vector3(cx, max.y, zc),
    rot: new THREE.Euler(-Math.PI / 2, 0, 0),
    size: new THREE.Vector3(xLen, zLen, 1.2 * H),
    facing: new THREE.Vector3(0, 1, 0),
    tex,
  });
  if (decal === DECALS.FLAMES) {
    const nose = min.z - AHEAD * L,
      zLen = 0.42 * L,
      yc = min.y + 0.32 * H,
      yLen = 0.44 * H, // about as long against tall as the side picture, so the tongues aren't squashed
      bonnetLen = 0.34 * L;
    return [
      side(1, nose + zLen / 2, zLen, yc, yLen, textures().flamesNoseRight),
      side(-1, nose + zLen / 2, zLen, yc, yLen, textures().flames),
      {
        ...top(nose + bonnetLen / 2, bonnetLen, 0.85 * W, textures().flamesBonnet),
        facing: BONNET_FACING,
        facingMin: BONNET_FACING_MIN,
      },
    ];
  }
  if (decal === DECALS.STRIPES) return [top((min.z + max.z) / 2, 1.02 * L, STRIPES_M, stripes(paint))];
  const zc = min.z + (numberAt?.at ?? NUMBER_AT) * L,
    span = glass && sideSpan?.(zc, glass.min.y),
    door = span && span.high - span.low >= SPAN_MIN_M ? span : null,
    // on a model, the middle of the door's paint you can see, between its sill and the windows: a fixed share of the height put
    // it on the XC70's tall black sill, which hides the paint under it, and cut the disc; the stand-in has no glass box, and its share fits
    d = door ? Math.min(RALLY_DISC_M, RALLY_DISC_FILL * (door.high - door.low)) : RALLY_DISC_M,
    yc = door ? Math.min((door.low + door.high) / 2 + (numberAt?.lift ?? 0), door.high - d / 2) : min.y + 0.3 * H;
  return [side(1, zc, d, yc, d, textures().rallyNumber), side(-1, zc, d, yc, d, textures().rallyNumber)];
}

/** How far up a side's paint shows at z, in the car's frame, below `top`: what the eye sees, so not paint hidden behind a sill. */
export type SideSpan = (z: number, top: number) => { low: number; high: number } | null;

/**
 * A SideSpan from rays at the car's right side, from `top` down: each lands on whatever is in front, so a sill over the body's
 * paint ends the span, and a thin trim strip doesn't. `solid` is every part of the model but its glass; `paint` the painted panels among them.
 */
export function sideSpanByRays(
  solid: readonly THREE.Object3D[],
  paint: ReadonlySet<THREE.Object3D>,
  frameToWorld: THREE.Matrix4,
): SideSpan {
  const ray = new THREE.Raycaster(),
    from = new THREE.Vector3(),
    dir = new THREE.Vector3();
  return (z, top) => {
    // the longest stretch of paint, top to bottom, across strips thin enough to be trim (a rubbing strip, a crease line)
    let best: { low: number; high: number } | null = null,
      run: { low: number; high: number } | null = null,
      gap = 0;
    for (let y = top - SPAN_STEP_M; y > 0; y -= SPAN_STEP_M) {
      from.set(SPAN_FROM_M, y, z).applyMatrix4(frameToWorld);
      ray.set(from, dir.set(-1, 0, 0).transformDirection(frameToWorld));
      const hit = ray.intersectObjects(solid as THREE.Object3D[], false)[0];
      if (hit && paint.has(hit.object)) {
        run = run && gap <= SPAN_TRIM_M ? { low: y, high: run.high } : { low: y, high: y };
        gap = 0;
        if (!best || run.high - run.low > best.high - best.low) best = run;
      } else gap += SPAN_STEP_M;
    }
    return best && best.high > best.low ? best : null;
  };
}

// the triangles of g that face `dir` and lie outside the glass. A projector also catches panels side-on, where its picture would
// smear: each vertex fades out, by its alpha, as its panel turns from facing `min` to facing FADE less, so where the body curves
// away from it (the shoulder between the side and the bonnet) the decal thins out softly instead of stopping in steps
function facingOnly(
  g: THREE.BufferGeometry,
  dir: THREE.Vector3,
  min: number,
  glass: THREE.Box3 | null,
): THREE.BufferGeometry | null {
  const pos = g.getAttribute('position'),
    nor = g.getAttribute('normal'),
    uv = g.getAttribute('uv');
  if (!pos?.count || !nor) {
    g.dispose();
    return null; // DecalGeometry gives normals for every panel with them, and a panel without would take the decal flat-on anyway
  }
  // DecalGeometry's clipped corners carry blended normals, a little short of unit length
  const alphaAt = (i: number) => {
    const x = nor.getX(i),
      y = nor.getY(i),
      z = nor.getZ(i),
      facing = (x * dir.x + y * dir.y + z * dir.z) / (Math.hypot(x, y, z) || 1);
    return Math.min(1, Math.max(0, (facing - (min - FADE)) / FADE));
  };
  const keep: number[] = [];
  for (let i = 0; i + 2 < pos.count; i += 3)
    if (Math.max(alphaAt(i), alphaAt(i + 1), alphaAt(i + 2)) > 0 && !(glass && underGlass(pos, i, glass)))
      keep.push(i, i + 1, i + 2);
  if (!keep.length) {
    g.dispose();
    return null;
  }
  const copy = (a: THREE.BufferAttribute | THREE.InterleavedBufferAttribute, n: number, lift = 0) => {
    const out = new Float32Array(keep.length * n);
    keep.forEach((i, j) => {
      for (let c = 0; c < n; c++) out[j * n + c] = a.getComponent(i, c) + lift * nor.getComponent(i, c);
    });
    return new THREE.BufferAttribute(out, n);
  };
  const colour = new Float32Array(keep.length * 4).fill(1);
  keep.forEach((i, j) => {
    colour[j * 4 + 3] = alphaAt(i);
  });
  const f = new THREE.BufferGeometry();
  f.setAttribute('position', copy(pos, 3, LIFT_M));
  f.setAttribute('normal', copy(nor, 3));
  if (uv) f.setAttribute('uv', copy(uv, 2));
  f.setAttribute('color', new THREE.BufferAttribute(colour, 4)); // white: only its alpha changes the picture
  g.dispose();
  return f;
}

// the triangle from vertex i lies within the windows' box, short of its top (the roof) and its bottom (the bonnet and the doors)
function underGlass(pos: THREE.BufferAttribute | THREE.InterleavedBufferAttribute, i: number, glass: THREE.Box3) {
  const x = (pos.getX(i) + pos.getX(i + 1) + pos.getX(i + 2)) / 3,
    y = (pos.getY(i) + pos.getY(i + 1) + pos.getY(i + 2)) / 3,
    z = (pos.getZ(i) + pos.getZ(i + 1) + pos.getZ(i + 2)) / 3;
  return (
    x > glass.min.x &&
    x < glass.max.x &&
    z > glass.min.z &&
    z < glass.max.z &&
    y > glass.min.y + GLASS_EDGE_M &&
    y < glass.max.y - GLASS_EDGE_M
  );
}

// ---------- textures ----------

const materials = new Map<THREE.Texture, THREE.MeshStandardMaterial>();
function material(tex: THREE.Texture) {
  let m = materials.get(tex);
  if (!m) {
    m = new THREE.MeshStandardMaterial({
      map: tex,
      vertexColors: true, // white, with an alpha that fades the decal where the body turns away (facingOnly)
      transparent: true,
      alphaTest: 0.02,
      depthWrite: false,
      roughness: 0.4,
    });
    materials.set(tex, m);
  }
  return m;
}

function canvasTexture(w: number, h: number, draw: (ctx: CanvasRenderingContext2D) => void) {
  const c = document.createElement('canvas');
  c.width = w;
  c.height = h;
  draw(c.getContext('2d')!);
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.SRGBColorSpace;
  t.anisotropy = 4;
  return t;
}

let made: ReturnType<typeof makeTextures> | null = null;
const textures = () => (made ??= makeTextures());

function makeTextures() {
  const flames = canvasTexture(1024, 280, ctx => drawFlames(ctx, 1024, 280, SIDE_TONGUES));
  const flamesNoseRight = flames.clone(); // the same picture, mirrored: on the right side its u runs towards the nose
  flamesNoseRight.repeat.x = -1;
  flamesNoseRight.offset.x = 1;
  flamesNoseRight.needsUpdate = true;
  // on the bonnet, from the nose (the top of the picture) back towards the windscreen
  const flamesBonnet = canvasTexture(512, 1024, ctx => {
    ctx.translate(512, 0);
    ctx.rotate(Math.PI / 2);
    drawFlames(ctx, 1024, 512, BONNET_TONGUES);
  });
  const rallyNumber = canvasTexture(256, 256, ctx => {
    ctx.beginPath();
    ctx.arc(128, 128, 118, 0, Math.PI * 2);
    ctx.fillStyle = '#f6f3ea';
    ctx.fill();
    ctx.lineWidth = 10;
    ctx.strokeStyle = '#161616';
    ctx.stroke();
    ctx.fillStyle = '#161616';
    ctx.font = '900 132px "Arial Black", Arial, sans-serif';
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.fillText(RALLY_NUMBER, 128, 136);
  });
  return { flames, flamesNoseRight, flamesBonnet, rallyNumber };
}

// hot-rod flames, `len` long from their roots on the left to their tips on the right, `wide` across. Each tongue is drawn along a
// wavy centre line that bends one way and then the other, narrowing to a tip that curls; a brighter core runs inside it.
type Tongue = {
  y: number; // where its root sits across the picture, as a share of `wide`
  tipX: number; // how far it reaches, as a share of `len`
  tipY: number; // where its tip ends up across the picture, as a share of `wide`
  half: number; // half its width at the root, as a share of `wide`
  bend: number; // how far its centre line swings either way, as a share of `wide`
  phase: number; // where in its swing it starts (rad)
  waves?: number; // how much it swings along its length (rad of the wave); 5.2, a little under one S, when not given
};
type Tongues = readonly Tongue[];
// kept clear of the picture's top and bottom edges, where the decal's box would cut them off straight
const SIDE_TONGUES: Tongues = [
  { y: 0.26, tipX: 0.95, tipY: 0.2, half: 0.14, bend: 0.12, phase: 0.4, waves: 7.5 },
  { y: 0.44, tipX: 0.7, tipY: 0.38, half: 0.15, bend: 0.2, phase: 2.6, waves: 7 },
  { y: 0.6, tipX: 0.9, tipY: 0.58, half: 0.15, bend: 0.2, phase: 4.6, waves: 7.5 },
  { y: 0.76, tipX: 0.6, tipY: 0.78, half: 0.12, bend: 0.1, phase: 1.5, waves: 7 },
];
const BONNET_TONGUES: Tongues = [
  { y: 0.12, tipX: 0.78, tipY: 0.08, half: 0.09, bend: 0.06, phase: 3 },
  { y: 0.3, tipX: 0.98, tipY: 0.24, half: 0.1, bend: 0.07, phase: 0.6 },
  { y: 0.5, tipX: 0.72, tipY: 0.5, half: 0.1, bend: 0.08, phase: 2 },
  { y: 0.7, tipX: 0.98, tipY: 0.76, half: 0.1, bend: 0.07, phase: 4.4 },
  { y: 0.88, tipX: 0.78, tipY: 0.92, half: 0.09, bend: 0.06, phase: 1.4 },
];
const ROOT_SHARE = 0.16; // the solid part at the nose, as a share of `len`, before the tongues part
const TONGUE_STEPS = 40;

// one tongue's outline: up one edge to the tip and back down the other, `grow` times its width and `reach` times its length
function tongueOutline(t: Tongue, len: number, wide: number, grow: number, reach: number): [number, number][] {
  const root = ROOT_SHARE * len,
    tipX = root + (t.tipX * len - root) * reach,
    centre = (k: number) => {
      const ease = k * k * (3 - 2 * k); // drifts from the root's place across to the tip's
      return [
        root * (1 - k) * 0.4 + tipX * k, // starts a little inside the solid root, so no seam shows
        (t.y + (t.tipY - t.y) * ease) * wide +
          Math.sin(t.phase + k * (t.waves ?? 5.2)) * t.bend * wide * Math.sin(Math.PI * k) -
          k ** 4 * 0.06 * wide, // the tip curls up
      ] as const;
    };
  const upper: [number, number][] = [],
    lower: [number, number][] = [];
  for (let i = 0; i <= TONGUE_STEPS; i++) {
    const k = i / TONGUE_STEPS,
      [x, y] = centre(k),
      [x2, y2] = centre(Math.min(1, k + 0.01)),
      [x1, y1] = centre(Math.max(0, k - 0.01)),
      dx = x2 - x1,
      dy = y2 - y1,
      d = Math.hypot(dx, dy) || 1,
      w = t.half * wide * grow * (1 - k) ** 0.75 * (1 + 0.18 * Math.sin(t.phase * 2 + k * 9)); // a little wobble in the width
    upper.push([x + (dy / d) * w, y - (dx / d) * w]);
    lower.push([x - (dy / d) * w, y + (dx / d) * w]);
  }
  return [...upper, ...lower.reverse()];
}

function traceOutline(ctx: CanvasRenderingContext2D, pts: [number, number][]) {
  ctx.moveTo(pts[0]![0], pts[0]![1]);
  for (let i = 1; i < pts.length - 1; i++) {
    const [x, y] = pts[i]!,
      [nx, ny] = pts[i + 1]!;
    ctx.quadraticCurveTo(x, y, (x + nx) / 2, (y + ny) / 2); // through the midpoints: smooth, with no corners
  }
  const last = pts.at(-1)!;
  ctx.lineTo(last[0], last[1]);
}

function drawFlames(ctx: CanvasRenderingContext2D, len: number, wide: number, tongues: Tongues) {
  const fire = ctx.createLinearGradient(0, 0, len, 0);
  fire.addColorStop(0, '#fff3b0');
  fire.addColorStop(0.3, '#ffd21f');
  fire.addColorStop(0.65, '#ff7a12');
  fire.addColorStop(1, '#d4231a');
  const core = ctx.createLinearGradient(0, 0, len, 0);
  core.addColorStop(0, '#fffbe6');
  core.addColorStop(0.5, '#ffe45c');
  core.addColorStop(1, '#ffb020');
  const top = Math.min(...tongues.map(t => t.y - t.half)) * wide,
    bottom = Math.max(...tongues.map(t => t.y + t.half)) * wide,
    root = ROOT_SHARE * len;
  const body = () => {
    ctx.beginPath();
    ctx.rect(0, top, root, bottom - top);
    for (const t of tongues) traceOutline(ctx, tongueOutline(t, len, wide, 1, 1));
  };
  ctx.lineJoin = 'round';
  // the outline first, twice as wide, so the fill on top leaves only its outer half: no lines where the tongues overlap
  body();
  ctx.lineWidth = 0.05 * wide;
  ctx.strokeStyle = '#7a1208';
  ctx.stroke();
  body();
  ctx.fillStyle = fire;
  ctx.fill('nonzero');
  // the bright core inside each tongue, shorter and thinner
  ctx.beginPath();
  for (const t of tongues) traceOutline(ctx, tongueOutline(t, len, wide, 0.42, 0.72));
  ctx.fillStyle = core;
  ctx.fill('nonzero');
}

// two stripes and the gap between, across STRIPES_M; light on a dark car, dark on a light one
const stripeTextures = new Map<string, THREE.Texture>();
function stripes(paint: string) {
  const n = Number.parseInt(paint.slice(1), 16),
    light = (0.2126 * (n >> 16) + 0.7152 * ((n >> 8) & 255) + 0.0722 * (n & 255)) / 255,
    colour = light > LIGHT_PAINT ? '#1b1b1b' : '#f4f1e6';
  let t = stripeTextures.get(colour);
  if (!t) {
    t = canvasTexture(120, 8, ctx => {
      ctx.fillStyle = colour;
      ctx.fillRect(0, 0, 44, 8);
      ctx.fillRect(76, 0, 44, 8);
    });
    stripeTextures.set(colour, t);
  }
  return t;
}
