// Plåt-Pelle's decals on a car (sim/paint-jobs.ts): flames, rally stripes and a rally number, projected onto the car's painted panels
// with three's DecalGeometry, so they follow the body's curves. The textures are drawn once on a canvas and shared by every car;
// each car's decal geometry is its own, and disposeDecal frees it.
import * as THREE from 'three';
import { DecalGeometry } from 'three/examples/jsm/geometries/DecalGeometry.js';
import { mergeGeometries } from 'three/examples/jsm/utils/BufferGeometryUtils.js';
import type { Decal } from '../sim/paint-jobs';

/** A painted panel, and the matrix that places it in the car's frame (metres; x right, y up, -z forward). */
export interface Panel {
  geometry: THREE.BufferGeometry;
  toFrame: THREE.Matrix4;
}

const FACING = 0.35; // a decal keeps only the triangles that face its projector at least this much (the cosine of the angle)
const GLASS_EDGE_M = 0.03; // a decal triangle this near the top or bottom of a model's glass stays: the roof and the bonnet's back edge
const LIFT_M = 0.006; // a decal stands this far off the paint, so it doesn't flicker into it, yet stays under a model's glass
const RALLY_DISC_M = 0.62; // across the rally number's disc
const STRIPES_M = 0.6; // across both rally stripes and the gap between them
const LIGHT_PAINT = 0.62; // a paint lighter than this (0–1) gets dark stripes, else light ones, so they always show

type Projector = {
  pos: THREE.Vector3;
  rot: THREE.Euler;
  size: THREE.Vector3; // across, up and deep, in the projector's own axes; it paints along its z
  facing: THREE.Vector3; // the way the panels it paints face, in the car's frame
  tex: THREE.Texture;
};

/**
 * The meshes of `decal` on `panels`, placed in the car's frame; `paint`, the car's colour, picks the stripes' colour. `glass` is the
 * box of a model's windows in the same frame: a model's body runs on under its glass, so the decal is cut away there.
 */
export function decalMeshes(
  decal: Decal,
  paint: string,
  panels: readonly Panel[],
  glass: THREE.Box3 | null = null,
): THREE.Mesh[] {
  const box = new THREE.Box3(),
    part = new THREE.Box3();
  for (const p of panels) {
    p.geometry.boundingBox ?? p.geometry.computeBoundingBox();
    box.union(part.copy(p.geometry.boundingBox!).applyMatrix4(p.toFrame));
  }
  if (box.isEmpty()) return [];
  const out: THREE.Mesh[] = [],
    stand = new THREE.Mesh(); // DecalGeometry reads only the mesh's geometry and matrixWorld
  for (const pr of projectors(decal, paint, box)) {
    const pieces: THREE.BufferGeometry[] = [];
    for (const p of panels) {
      stand.geometry = p.geometry;
      stand.matrixWorld.copy(p.toFrame);
      const facing = facingOnly(new DecalGeometry(stand, pr.pos, pr.rot, pr.size), pr.facing, glass);
      if (facing) pieces.push(facing);
    }
    if (!pieces.length) continue;
    const geo = pieces.length === 1 ? pieces[0]! : mergeGeometries(pieces);
    if (pieces.length > 1) for (const g of pieces) g.dispose();
    if (!geo) continue;
    const m = new THREE.Mesh(geo, material(pr.tex));
    m.receiveShadow = true;
    m.renderOrder = 1; // over the paint it lies on
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
function projectors(decal: Decal, paint: string, box: THREE.Box3): Projector[] {
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
  if (decal === 'flames') {
    const zc = min.z + 0.3 * L,
      zLen = 0.44 * L,
      yc = min.y + 0.32 * H,
      yLen = 0.44 * H; // about as long against tall as the side picture, so the tongues aren't squashed
    return [
      side(1, zc, zLen, yc, yLen, textures().flamesNoseRight),
      side(-1, zc, zLen, yc, yLen, textures().flames),
      top(min.z + 0.16 * L, 0.3 * L, 0.9 * W, textures().flamesBonnet),
    ];
  }
  if (decal === 'stripes') return [top((min.z + max.z) / 2, 1.02 * L, STRIPES_M, stripes(paint))];
  const zc = min.z + 0.45 * L,
    yc = min.y + 0.3 * H;
  return [
    side(1, zc, RALLY_DISC_M, yc, RALLY_DISC_M, textures().rallyNumber),
    side(-1, zc, RALLY_DISC_M, yc, RALLY_DISC_M, textures().rallyNumber),
  ];
}

// the triangles of g that face `dir` and lie outside the glass: a projector also catches panels side-on, where its picture would smear
function facingOnly(
  g: THREE.BufferGeometry,
  dir: THREE.Vector3,
  glass: THREE.Box3 | null,
): THREE.BufferGeometry | null {
  const pos = g.getAttribute('position'),
    nor = g.getAttribute('normal'),
    uv = g.getAttribute('uv');
  if (!pos?.count) {
    g.dispose();
    return null;
  }
  if (!nor) return g;
  const keep: number[] = [];
  for (let i = 0; i + 2 < pos.count; i += 3) {
    let d = 0;
    for (let k = i; k < i + 3; k++) d += nor.getX(k) * dir.x + nor.getY(k) * dir.y + nor.getZ(k) * dir.z;
    if (d / 3 >= FACING && !(glass && underGlass(pos, i, glass))) keep.push(i, i + 1, i + 2);
  }
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
  const f = new THREE.BufferGeometry();
  f.setAttribute('position', copy(pos, 3, LIFT_M));
  f.setAttribute('normal', copy(nor, 3));
  if (uv) f.setAttribute('uv', copy(uv, 2));
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
  const flames = canvasTexture(512, 140, ctx => drawFlames(ctx, 512, 140, SIDE_TONGUES));
  const flamesNoseRight = flames.clone(); // the same picture, mirrored: on the right side its u runs towards the nose
  flamesNoseRight.repeat.x = -1;
  flamesNoseRight.offset.x = 1;
  flamesNoseRight.needsUpdate = true;
  // on the bonnet, from the nose (the top of the picture) back towards the windscreen
  const flamesBonnet = canvasTexture(256, 512, ctx => {
    ctx.translate(256, 0);
    ctx.rotate(Math.PI / 2);
    drawFlames(ctx, 512, 256, BONNET_TONGUES);
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
    ctx.fillText('76', 128, 136);
  });
  return { flames, flamesNoseRight, flamesBonnet, rallyNumber };
}

// hot-rod flames, `len` long from their roots on the left to their tips on the right, `wide` across
type Tongues = readonly (readonly [tipX: number, tipY: number])[]; // each tongue's tip, as shares of the length and the width
const SIDE_TONGUES: Tongues = [
  [0.97, 0.2],
  [0.62, 0.44],
  [0.88, 0.66],
  [0.55, 0.86],
];
const BONNET_TONGUES: Tongues = [
  [0.97, 0.16],
  [0.66, 0.33],
  [0.9, 0.52],
  [0.58, 0.7],
  [0.8, 0.86],
];
function drawFlames(ctx: CanvasRenderingContext2D, len: number, wide: number, tongues: Tongues) {
  const g = ctx.createLinearGradient(0, 0, len, 0);
  g.addColorStop(0, '#fff3b0');
  g.addColorStop(0.25, '#ffd21f');
  g.addColorStop(0.6, '#ff7a12');
  g.addColorStop(1, '#d4231a');
  const rootX = 0.2 * len;
  ctx.beginPath();
  ctx.moveTo(0, 0.08 * wide);
  let fromX = 0,
    fromY = 0.08 * wide;
  tongues.forEach(([tx, ty], i) => {
    const tipX = tx * len,
      tipY = ty * wide - 0.04 * wide, // the tips sweep up a little, as if the car were moving
      next = tongues[i + 1],
      valleyY = next ? ((ty + next[1]) / 2 + 0.03) * wide : 0.94 * wide;
    ctx.bezierCurveTo(fromX + 0.25 * len, fromY, tipX - 0.2 * len, tipY + 0.02 * wide, tipX, tipY);
    ctx.bezierCurveTo(tipX - 0.12 * len, tipY + 0.05 * wide, rootX + 0.25 * len, valleyY, rootX, valleyY);
    fromX = rootX;
    fromY = valleyY;
  });
  ctx.lineTo(0, 0.94 * wide);
  ctx.closePath();
  ctx.fillStyle = g;
  ctx.fill();
  ctx.lineJoin = 'round';
  ctx.lineWidth = 0.022 * wide;
  ctx.strokeStyle = '#7a1208';
  ctx.stroke();
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
