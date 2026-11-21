// Skroten's yard (#76), at the welding workshop's hall on the south side of Stockarydsvägen, east of the village: the fence, the gate,
// the hut, the containers, the rows of wrecks and the scrap heaps, laid out once from their own random stream. The hall becomes Skroten's
// workshop: hollow, with a garage door wide enough to drive a car in. Plain data: render/skroten.ts draws it, and main.ts adds the outlines
// to the buildings so cars and people collide with them. No three.js or DOM here.
import { pointInPolygon } from '../world/polygon';
import { makeRnd } from '../world/random';

/**
 * The yard is laid out in its own frame: u runs along the road (eastwards), v from the road into the yard (southwards), in metres, with
 * (0, 0) in the middle of the gate. The gate stands 10 m from the road's middle line, where it passes x = 895, west of the hall.
 */
export const YARD_GATE = { x: 893.9, z: 61.7 } as const;
const ALONG = { x: 0.9944, z: 0.1059 }, // the road's direction along the yard, as a unit vector
  INTO = { x: -0.1059, z: 0.9944 }; // and the way into the yard, at right angles to it
/** The yard frame's turn about y, for three.js: local x is u, local z is v. */
export const YARD_TURN = -Math.atan2(ALONG.z, ALONG.x);
/** A point inside the hall that becomes Skroten's workshop, to find its outline among the buildings. */
export const SKROT_HALL = { x: 945, z: 88 } as const;

/**
 * The fence runs from 36 m west of the gate's middle to the hall, and 44 m back from the road, short of the building behind; the gate is
 * 12 m wide, room to swing a car in. uMax is where the fence turns back without a hall.
 */
export const YARD = { uMin: -36, uMax: 26, depth: 44, gateHalf: 6 } as const;
const { uMin: U_MIN, depth: DEPTH_M, gateHalf: GATE_HALF_M } = YARD;
const FENCE_THICK_M = 0.3; // what you collide with; the panels themselves are thinner
const WALL_THICK_M = 0.3; // the workshop's walls, the same
/** The workshop's garage door: wide and tall enough to drive in, in the middle of the wall facing the yard. */
export const WORKSHOP_DOOR = { w: 6.5, h: 4.6 } as const;
/** The arrow signs, about 70 m either way, 6 m off the road's middle on the yard's side: where the road bends, so given in world metres. */
const SIGNS_XZ = [
  { x: 823.4, z: 43.1, facing: 1 },
  { x: 965, z: 62.1, facing: -1 },
] as const;

/** The ring you drive onto to sell a car, just inside the gate, and where Skrot-Nisse stands beside it. */
export const RING_UV = { u: 0, v: 10 } as const;
export const NISSE_UV = { u: -7.5, v: 9 } as const;
/** The hut by the gate: its middle and its size along u and v (m). Its door is on the end towards the ring. */
export const HUT = { u: -13, v: 7, w: 7, d: 3 } as const;
/** Two containers side by side, and one on top across them. */
export const CONTAINERS = { u: 16, v: 5, w: 6.1, d: 2.45 } as const;

/** The wrecks' models: the game's cars by id (render/vehicle-registry.ts), and the tractor, which has no model of its own. */
export const WRECK_MODELS = ['volvo240', 'saab900', 'xc70', 'impala1970', 'micra-k11', 'duett-epa'] as const;
export type WreckModel = (typeof WRECK_MODELS)[number] | 'traktor';
export interface Wreck {
  u: number;
  v: number;
  turn: number; // radians about y, in the yard's frame
  tilt: number; // radians about its length: a car sagging on flat tyres
  model: WreckModel;
  colour: string; // sRGB, faded or rusting
  stack: 0 | 1 | 2; // 0 alone, 1 with another car on it, 2 lying on the car below
}
export interface Heap {
  u: number;
  v: number;
  r: number; // m
}
export interface Tyres {
  u: number;
  v: number;
  n: number; // tyres in the stack
}
/** A straight run of fence, from (u0, v0) to (u1, v1). */
export interface FenceRun {
  u0: number;
  v0: number;
  u1: number;
  v1: number;
}
/** A wall of an outline: its first corner, its direction and length, and its outward normal; all in world metres. */
export interface Wall {
  x0: number;
  z0: number;
  ux: number;
  uz: number;
  len: number;
  nx: number;
  nz: number;
}
/** Things inside the workshop, in the yard's frame: what each is, where its middle stands, and its turn. */
export interface WorkshopProp {
  kind: keyof typeof PROP_SIZE;
  u: number;
  v: number;
  turn: number;
}
/**
 * The workshop: the hall's outline, its walls, the one with the garage door, and where along that wall the door begins and ends (m). The
 * bay is the spot between the lift's posts where a car parks to be worked on, for upgrades and repairs to come; `in` points from the door
 * towards it.
 */
export interface Workshop {
  outline: readonly number[];
  walls: Wall[];
  doorWall: Wall;
  doorFrom: number;
  doorTo: number;
  bay: { x: number; z: number; inX: number; inZ: number };
  props: WorkshopProp[];
}
/** The props' size along their turn and across it (m), and height. */
export const PROP_SIZE = {
  bench: { w: 3, d: 0.8, h: 0.9 },
  shelf: { w: 2.4, d: 0.6, h: 2.2 },
  rack: { w: 3.5, d: 0.7, h: 1.8 },
  post: { w: 0.35, d: 0.35, h: 3.2 },
} as const;
const BAY_IN_M = 15, // the bay's middle, this far in from the door
  LIFT_HALF_M = 2.1; // the lift's posts, this far either side of the bay's middle: a car's 1.5 m collision radius passes between
export interface YardLayout {
  fence: FenceRun[];
  wrecks: Wreck[];
  heaps: Heap[];
  tyres: Tyres[];
  /** Arrow signs by the road: where they stand, and whether the yard is to the driver's right as they pass it. */
  signs: { u: number; v: number; facing: 1 | -1 }[];
  workshop: Workshop | null;
  /** The index of the hall among the footprints, which stops colliding as a block; its walls are in `outlines` instead. -1 without it. */
  hallIndex: number;
  /** World outlines (flat [x, z, ...]) that cars and people collide with. */
  outlines: number[][];
}

/** A point of the yard's frame in world coordinates. */
export function yardToWorld(u: number, v: number) {
  return { x: YARD_GATE.x + u * ALONG.x + v * INTO.x, z: YARD_GATE.z + u * ALONG.z + v * INTO.z };
}

/** A world point in the yard's frame. */
export function worldToYard(x: number, z: number) {
  const dx = x - YARD_GATE.x,
    dz = z - YARD_GATE.z;
  return { u: dx * ALONG.x + dz * ALONG.z, v: dx * INTO.x + dz * INTO.z };
}

// a rectangle of the yard's frame, centred on (u, v) and turned by `turn`, as a world outline
function rect(u: number, v: number, w: number, d: number, turn = 0) {
  const c = Math.cos(turn),
    s = Math.sin(turn),
    out: number[] = [];
  for (const [a, b] of [
    [-w / 2, -d / 2],
    [w / 2, -d / 2],
    [w / 2, d / 2],
    [-w / 2, d / 2],
  ]) {
    const p = yardToWorld(u + a * c + b * s, v - a * s + b * c);
    out.push(p.x, p.z);
  }
  return out;
}

// a thin world rectangle along a wall from `s0` to `s1` metres, centred on the wall's line
function wallStrip(w: Wall, s0: number, s1: number, thick: number) {
  const h = thick / 2,
    ax = w.x0 + w.ux * s0,
    az = w.z0 + w.uz * s0,
    bx = w.x0 + w.ux * s1,
    bz = w.z0 + w.uz * s1;
  return [
    ax + w.nx * h,
    az + w.nz * h,
    bx + w.nx * h,
    bz + w.nz * h,
    bx - w.nx * h,
    bz - w.nz * h,
    ax - w.nx * h,
    az - w.nz * h,
  ];
}

/** The walls of an outline (flat [x, z, ...]), each with its outward normal. */
function outlineWalls(p: readonly number[]): Wall[] {
  const walls: Wall[] = [];
  for (let i = 0, j = p.length - 2; i < p.length; j = i, i += 2) {
    const ex = p[i]! - p[j]!,
      ez = p[i + 1]! - p[j + 1]!,
      len = Math.hypot(ex, ez);
    if (len < 0.01) continue;
    const mx = (p[i]! + p[j]!) / 2,
      mz = (p[i + 1]! + p[j + 1]!) / 2;
    let nx = ez / len,
      nz = -ex / len;
    if (pointInPolygon(p as number[], mx + nx * 0.3, mz + nz * 0.3)) {
      nx = -nx;
      nz = -nz;
    }
    walls.push({ x0: p[j]!, z0: p[j + 1]!, ux: ex / len, uz: ez / len, len, nx, nz });
  }
  return walls;
}

/** The longest wall whose outward normal points along (dx, dz), within about 25°. */
function wallFacing(walls: readonly Wall[], dx: number, dz: number) {
  let best: Wall | null = null;
  for (const w of walls) if (w.nx * dx + w.nz * dz > 0.9 && (!best || w.len > best.len)) best = w;
  return best;
}

const WRECK_COLOURS = [
  '#7d3a24',
  '#6b6f5a',
  '#9a8a62',
  '#4f5a63',
  '#8f4f2c',
  '#77797a',
  '#5c4434',
  '#7c6a3a',
  '#3f4f45',
  '#8a2f2a',
  '#5d6b7a',
];
const WRECK_ROWS = [
  // rows of wrecks parked side by side, noses towards the road or away: from u0 to u1, at v; cars are stacked only in the back row
  { u0: -33, u1: -17, v: 20, stacks: false },
  { u0: -33, u1: -17, v: 29, stacks: false },
  { u0: 12, u1: 22, v: 25, stacks: false },
  { u0: 12, u1: 22, v: 33, stacks: false },
  { u0: -33, u1: 22, v: 40.5, stacks: true },
];
const WRECK_GAP_M = 2.6; // between the middles of neighbours in a row
const WRECK_HALF_LEN_M = 2.7; // half the longest car's length, for the row's outline
const TRACTORS = [
  // two old tractors, parked on their own
  { u: -27, v: 14, turn: 0.4 },
  { u: 6, v: 22, turn: 0.2 },
];

/**
 * The whole yard, around the hall among `footprints` that SKROT_HALL picks (without it, the fence closes at uMax). The layout comes from
 * its own seed, so it is the same on every load and moves no other roll.
 */
export function yardLayout(footprints: readonly { p: readonly number[] }[] = [], seed = 4120): YardLayout {
  const rnd = makeRnd(seed),
    pick = <T>(a: readonly T[]) => a[Math.floor(rnd() * a.length)]!;
  const hallIndex = footprints.findIndex(b => pointInPolygon(b.p as number[], SKROT_HALL.x, SKROT_HALL.z)),
    outline = hallIndex >= 0 ? footprints[hallIndex]!.p : null,
    walls = outline ? outlineWalls(outline) : [],
    doorWall = wallFacing(walls, -INTO.z, INTO.x), // the wall facing back along u, towards the yard
    outlines: number[][] = [];

  // the fence: along the road, then back to the hall's corners on the yard's side, so the yard opens onto the workshop's door
  let east: FenceRun[];
  if (doorWall) {
    const a = worldToYard(doorWall.x0, doorWall.z0),
      b = worldToYard(doorWall.x0 + doorWall.ux * doorWall.len, doorWall.z0 + doorWall.uz * doorWall.len),
      [front, back] = a.v < b.v ? [a, b] : [b, a];
    east = [
      { u0: GATE_HALF_M, v0: 0, u1: front.u, v1: 0 },
      { u0: front.u, v0: 0, u1: front.u, v1: front.v },
      { u0: back.u, v0: back.v, u1: back.u, v1: DEPTH_M },
      { u0: back.u, v0: DEPTH_M, u1: U_MIN, v1: DEPTH_M },
    ];
  } else
    east = [
      { u0: GATE_HALF_M, v0: 0, u1: YARD.uMax, v1: 0 },
      { u0: YARD.uMax, v0: 0, u1: YARD.uMax, v1: DEPTH_M },
      { u0: YARD.uMax, v0: DEPTH_M, u1: U_MIN, v1: DEPTH_M },
    ];
  const fence: FenceRun[] = [
    { u0: U_MIN, v0: 0, u1: -GATE_HALF_M, v1: 0 },
    ...east,
    { u0: U_MIN, v0: DEPTH_M, u1: U_MIN, v1: 0 },
  ];
  for (const f of fence) {
    const len = Math.hypot(f.u1 - f.u0, f.v1 - f.v0);
    outlines.push(
      rect((f.u0 + f.u1) / 2, (f.v0 + f.v1) / 2, len, FENCE_THICK_M, -Math.atan2(f.v1 - f.v0, f.u1 - f.u0)),
    );
  }

  // the workshop's walls, with a gap for the garage door
  let workshop: Workshop | null = null;
  if (outline && doorWall) {
    const doorFrom = (doorWall.len - WORKSHOP_DOOR.w) / 2,
      doorTo = doorFrom + WORKSHOP_DOOR.w;
    for (const w of walls)
      if (w !== doorWall) outlines.push(wallStrip(w, 0, w.len, WALL_THICK_M));
      else outlines.push(wallStrip(w, 0, doorFrom, WALL_THICK_M), wallStrip(w, doorTo, w.len, WALL_THICK_M));
    const inX = -doorWall.nx,
      inZ = -doorWall.nz,
      mid = (doorFrom + doorTo) / 2,
      bay = {
        x: doorWall.x0 + doorWall.ux * mid + inX * BAY_IN_M,
        z: doorWall.z0 + doorWall.uz * mid + inZ * BAY_IN_M,
        inX,
        inZ,
      };
    // a prop against wall w, `at` (0–1) along it, standing just inside
    const against = (kind: WorkshopProp['kind'], w: Wall | null, at: number): WorkshopProp | null => {
      if (!w) return null;
      const out = PROP_SIZE[kind].d / 2 + WALL_THICK_M / 2 + 0.05,
        p = worldToYard(w.x0 + w.ux * w.len * at - w.nx * out, w.z0 + w.uz * w.len * at - w.nz * out),
        du = w.ux * ALONG.x + w.uz * ALONG.z,
        dv = w.ux * INTO.x + w.uz * INTO.z;
      return { kind, ...p, turn: -Math.atan2(dv, du) };
    };
    const across = { x: doorWall.ux, z: doorWall.uz },
      post = (side: number): WorkshopProp => ({
        kind: 'post',
        ...worldToYard(bay.x + across.x * side * LIFT_HALF_M, bay.z + across.z * side * LIFT_HALF_M),
        turn: 0,
      });
    const props = [
      against('bench', wallFacing(walls, ALONG.x, ALONG.z), 0.5), // along the far end, facing the door
      against('shelf', wallFacing(walls, INTO.x, INTO.z), 0.3),
      against('shelf', wallFacing(walls, INTO.x, INTO.z), 0.65),
      against('rack', wallFacing(walls, -INTO.x, -INTO.z), 0.75), // tyres along the road side
      post(-1),
      post(1),
    ].filter((p): p is WorkshopProp => !!p);
    for (const p of props) outlines.push(rect(p.u, p.v, PROP_SIZE[p.kind].w, PROP_SIZE[p.kind].d, p.turn));
    workshop = { outline, walls, doorWall, doorFrom, doorTo, bay, props };
  }

  outlines.push(rect(HUT.u, HUT.v, HUT.w, HUT.d));
  outlines.push(rect(CONTAINERS.u, CONTAINERS.v, CONTAINERS.w, CONTAINERS.d * 2));
  outlines.push(rect(NISSE_UV.u, NISSE_UV.v, 0.7, 0.7)); // Skrot-Nisse stands his ground

  const wrecks: Wreck[] = [];
  for (const row of WRECK_ROWS) {
    for (let u = row.u0; u <= row.u1 + 0.01; u += WRECK_GAP_M) {
      if (rnd() < 0.12) continue; // a gap where one has gone to the crusher
      const below: Wreck = {
        u: u + (rnd() - 0.5) * 0.4,
        v: row.v + (rnd() - 0.5) * 0.8,
        turn: (rnd() < 0.5 ? 0 : Math.PI) + (rnd() - 0.5) * 0.3,
        tilt: (rnd() - 0.5) * 0.12,
        model: pick(WRECK_MODELS),
        colour: pick(WRECK_COLOURS),
        stack: 0,
      };
      wrecks.push(below);
      if (row.stacks && rnd() < 0.45) {
        below.stack = 1;
        wrecks.push({
          ...below,
          turn: below.turn + (rnd() - 0.5) * 0.4,
          tilt: (rnd() - 0.5) * 0.1,
          model: pick(WRECK_MODELS),
          colour: pick(WRECK_COLOURS),
          stack: 2,
        });
      }
    }
    outlines.push(rect((row.u0 + row.u1) / 2, row.v, row.u1 - row.u0 + 2.2, WRECK_HALF_LEN_M * 2));
  }
  for (const t of TRACTORS) {
    wrecks.push({ ...t, tilt: 0, model: 'traktor', colour: pick(['#8a2f2a', '#5f7a3a']), stack: 0 });
    outlines.push(rect(t.u, t.v, 2.3, 3.6, t.turn));
  }

  const heaps: Heap[] = [
    { u: 0, v: 33, r: 5 }, // the big heap at the back of the drive
    { u: -27, v: 6, r: 3 },
    { u: 27.5, v: 37, r: 2.5 },
  ];
  for (const h of heaps)
    outlines.push(rect(h.u, h.v, h.r * 1.6, h.r * 1.6, Math.PI / 4), rect(h.u, h.v, h.r * 1.6, h.r * 1.6));

  const tyres: Tyres[] = [
    { u: -19, v: 4, n: 5 },
    { u: -19.9, v: 4.7, n: 3 },
    { u: 22.5, v: 3.5, n: 6 },
    { u: 9, v: 29.5, n: 4 },
  ];
  for (const t of tyres) outlines.push(rect(t.u, t.v, 0.8, 0.8));

  return {
    fence,
    wrecks,
    heaps,
    tyres,
    signs: SIGNS_XZ.map(s => ({ ...worldToYard(s.x, s.z), facing: s.facing })),
    workshop,
    hallIndex,
    outlines,
  };
}
