// Skroten's yard (#76), at the welding workshop on the south side of Stockarydsvägen, east of the village, as it stands there: a low
// brick workshop to the east, a long open carport to the south, and the yard between them and the road. The fence, the gate, the hut, the
// containers, the cars and the scrap heaps are laid out once from their own random stream. The workshop is hollow, with a garage door
// wide enough to drive a car in, and the carport's bays open onto the yard. Plain data: render/skroten.ts draws it, and main.ts adds the outlines
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
/** The heading (Car.h: rad, 0 is north) of a car standing in the yard at `turn`: a model's nose, local -z, turned by YARD_TURN + turn. */
export const yardHeading = (turn: number) => -(YARD_TURN + turn);
/** A point inside the hall that becomes Skroten's workshop, to find its outline among the buildings. */
export const SKROT_HALL = { x: 945, z: 88 } as const;
/** A point inside the long open carport behind the yard. */
export const SKROT_CARPORT = { x: 913, z: 123 } as const;
const CARPORT_BAYS = 6,
  CARPORT_POST_M = 0.3,
  CARPORT_PARK_M = 5.5; // a car in a bay stands this far in from the open front

/**
 * The fence runs from 36 m west of the gate's middle to the hall, and 44 m back from the road, short of the building behind; the gate is
 * 12 m wide, room to swing a car in. uMax is where the fence turns back without a hall.
 */
export const YARD = { uMin: -36, uMax: 26, depth: 44, gateHalf: 6 } as const;
const { uMin: U_MIN, depth: DEPTH_M, gateHalf: GATE_HALF_M } = YARD;
const FENCE_THICK_M = 0.3; // what you collide with; the panels themselves are thinner
const WALL_THICK_M = 0.3; // the workshop's walls, the same
/** The workshop's garage door: wide and tall enough to drive in, in the middle of the wall facing the yard. */
export const WORKSHOP_DOOR = { w: 6.5, h: 3.8 } as const;
/** The arrow signs, about 70 m either way, 6 m off the road's middle on the yard's side: where the road bends, so given in world metres. */
const SIGNS_XZ = [
  { x: 823.4, z: 43.1, facing: 1 },
  { x: 965, z: 62.1, facing: -1 },
] as const;

/** The ring you drive onto to sell a car, just inside the gate, and where Plåt-Pelle stands beside it. */
export const RING_UV = { u: 0, v: 10 } as const;
export const OWNER_UV = { u: -7.5, v: 9 } as const;
/** The hut by the gate: its middle and its size along u and v (m). Its door is on the end towards the ring. */
export const HUT = { u: -13, v: 7, w: 7, d: 3 } as const;
/** Two containers side by side, and one on top across them. */
export const CONTAINERS = { u: 16, v: 5, w: 6.1, d: 2.45 } as const;

/** The cars' models: the game's cars by id (render/vehicle-registry.ts), and the tractor, which has no model of its own. */
export const YARD_CAR_MODELS = ['volvo240', 'saab900', 'xc70', 'impala1970', 'micra-k11', 'duett-epa'] as const;
export type YardCarModel = (typeof YARD_CAR_MODELS)[number] | 'traktor';
export interface YardCar {
  u: number;
  v: number;
  turn: number; // radians about y, in the yard's frame
  tilt: number; // radians about its length: a wreck leaning on flat tyres
  pitch: number; // radians about its width: nose or tail down
  model: YardCarModel;
  colour: string; // sRGB: faded or rusting on a wreck, fresh on a car for sale
  wrecked: boolean; // a wreck sags on flat tyres; a car for sale stands straight
  stack: 0 | 1 | 2; // 0 alone, 1 with another car on it (squashed a little), 2 lying on the car below
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
/**
 * A building with an even floor: its outline, the floor (h = a + bx·x + cz·z, fitted to the ground under it and lifted just clear of
 * it), and the stretch of one wall, from `from` to `to` metres along it, where a ramp runs down from the floor to the yard.
 */
export interface FloorArea {
  outline: readonly number[];
  floor: { a: number; bx: number; cz: number };
  ramp: { wall: Wall; from: number; to: number };
  /** The outline's bounds and the ramp's: outside them there is no floor. */
  bounds: { x0: number; x1: number; z0: number; z1: number };
}
export interface Workshop extends FloorArea {
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
/** A ramp from the workshop's door down to the yard, this long (m). */
export const RAMP_M = 2.5;
const FLOOR_STEP_M = 1, // the floor is fitted to the ground sampled this far apart
  FLOOR_CLEAR_M = 0.05; // and stands this far above its highest point
const BAY_IN_M = 15, // the bay's middle, this far in from the door
  LIFT_HALF_M = 2.1; // the lift's posts, this far either side of the bay's middle: a car's 1.5 m collision radius passes between
/** The carport: its outline and walls, the open front, and the posts along it (world metres). */
export interface Carport extends FloorArea {
  walls: Wall[];
  front: Wall;
  posts: { x: number; z: number }[];
}
export interface YardLayout {
  fence: FenceRun[];
  yardCars: YardCar[];
  /** The cars for sale: real cars that main.ts parks in the fleet, so they are neither drawn nor solid here. */
  forSale: YardCar[];
  /** The wheel off the broken tractor, lying beside it. */
  looseWheel: { u: number; v: number } | null;
  heaps: Heap[];
  tyres: Tyres[];
  /** Arrow signs by the road: where they stand, and whether the yard is to the driver's right as they pass it. */
  signs: { u: number; v: number; facing: 1 | -1 }[];
  workshop: Workshop | null;
  carport: Carport | null;
  /** The indices among the footprints of the workshop and the carport, which stop colliding as blocks; their walls are in `outlines`. */
  passable: number[];
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

// the least-squares plane through the ground under an outline, lifted so it stands clear of every sample: the workshop's floor. The
// ground there is the coarse elevation grid, rising about 4 m across the hall; a level floor would need that much digging out.
function fitFloor(p: readonly number[], heightAt: (x: number, z: number) => number) {
  const pts: [number, number, number][] = [],
    xs = p.filter((_, i) => i % 2 === 0),
    zs = p.filter((_, i) => i % 2 === 1);
  for (let x = Math.min(...xs); x <= Math.max(...xs); x += FLOOR_STEP_M)
    for (let z = Math.min(...zs); z <= Math.max(...zs); z += FLOOR_STEP_M)
      if (pointInPolygon(p as number[], x, z)) pts.push([x, z, heightAt(x, z)]);
  for (let i = 0; i < p.length; i += 2) pts.push([p[i]!, p[i + 1]!, heightAt(p[i]!, p[i + 1]!)]);
  const n = pts.length,
    m = pts.reduce((s, [x, z, h]) => [s[0]! + x / n, s[1]! + z / n, s[2]! + h / n], [0, 0, 0]),
    [mx, mz, mh] = m as [number, number, number];
  let xx = 0,
    zz = 0,
    xz = 0,
    xh = 0,
    zh = 0;
  for (const [x, z, h] of pts) {
    const dx = x - mx,
      dz = z - mz,
      dh = h - mh;
    xx += dx * dx;
    zz += dz * dz;
    xz += dx * dz;
    xh += dx * dh;
    zh += dz * dh;
  }
  const det = xx * zz - xz * xz || 1,
    bx = (xh * zz - zh * xz) / det,
    cz = (zh * xx - xh * xz) / det;
  let lift = -Infinity;
  for (const [x, z, h] of pts) lift = Math.max(lift, h - (mh + bx * (x - mx) + cz * (z - mz)));
  return { a: mh - bx * mx - cz * mz + lift + FLOOR_CLEAR_M, bx, cz };
}

// an outline's bounds, grown by the ramp's length on every side
function floorBounds(p: readonly number[]) {
  const xs = p.filter((_, i) => i % 2 === 0),
    zs = p.filter((_, i) => i % 2 === 1);
  return {
    x0: Math.min(...xs) - RAMP_M,
    x1: Math.max(...xs) + RAMP_M,
    z0: Math.min(...zs) - RAMP_M,
    z1: Math.max(...zs) + RAMP_M,
  };
}

/** The height of a building's floor at (x, z): inside it, and on its ramp down to the yard; null elsewhere, where the ground is the ground. */
export function floorAt(area: FloorArea, x: number, z: number, heightAt: (x: number, z: number) => number) {
  const b = area.bounds;
  if (x < b.x0 || x > b.x1 || z < b.z0 || z > b.z1) return null; // most calls, from all over the map, end here
  const { a, bx, cz } = area.floor;
  if (pointInPolygon(area.outline as number[], x, z)) return a + bx * x + cz * z;
  const { wall: w, from, to } = area.ramp,
    s = (x - w.x0) * w.ux + (z - w.z0) * w.uz, // along the wall
    out = (x - w.x0) * w.nx + (z - w.z0) * w.nz; // out from it, into the yard
  if (out < 0 || out > RAMP_M || s < from || s > to) return null;
  const sill = a + bx * (x - w.nx * out) + cz * (z - w.nz * out),
    ground = heightAt(x, z),
    t = out / RAMP_M;
  return sill > ground ? sill + (ground - sill) * t : null;
}

/** The floor under (x, z) in the workshop or the carport, or on their ramps; null elsewhere. Everyone stands on it: main.ts reads it in groundAt. */
export function yardFloorAt(
  y: Pick<YardLayout, 'workshop' | 'carport'>,
  x: number,
  z: number,
  heightAt: (x: number, z: number) => number,
) {
  return (
    (y.workshop && floorAt(y.workshop, x, z, heightAt)) ?? (y.carport && floorAt(y.carport, x, z, heightAt)) ?? null
  );
}

// where a car parks in bay k of the carport, nose in, in the yard's frame
function inBay(cp: Carport, k: number) {
  const f = cp.front,
    s = (f.len * (k + 0.5)) / CARPORT_BAYS,
    du = -(f.nx * ALONG.x + f.nz * ALONG.z),
    dv = -(f.nx * INTO.x + f.nz * INTO.z);
  return {
    ...worldToYard(f.x0 + f.ux * s - f.nx * CARPORT_PARK_M, f.z0 + f.uz * s - f.nz * CARPORT_PARK_M),
    turn: Math.atan2(-du, -dv), // its nose, -z, points into the carport
  };
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
  // rows of cars parked side by side, noses towards the road or away: from u0 to u1, at v. The wrecks are on the west side, stacked in
  // the back row; the cars for sale stand between the workshop's door and the carport, leaving the way to both clear.
  { u0: -33, u1: -17, v: 20, stacks: false, fresh: false },
  { u0: -33, u1: -17, v: 29, stacks: false, fresh: false },
  { u0: -33, u1: -8, v: 43, stacks: true, fresh: false }, // in the back corner, clear of the carport's bays
  { u0: 16, u1: 26, v: 30, stacks: false, fresh: true },
];
/** Cars for sale: clean paint in the colours of the day. */
const FRESH_COLOURS = ['#b9bab4', '#1f3b6a', '#8c1c1c', '#e8e4d8', '#2b2b2b', '#3c5a3a', '#6d7f8f'];
/** The TILL SALU sign, in front of the row of cars for sale, facing the yard. */
export const SALE_SIGN = { u: 21, v: 25.2, w: 5 } as const; // w: the TILL SALU board's width (m), its posts inside it
const WRECK_GAP_M = 2.6; // between the middles of neighbours in a row
const WRECK_HALF_LEN_M = 2.7; // half the longest car's length, for the row's outline
const WRECK_SPREAD_M = 0.5; // how far a wreck's jitter (±0.4 m, ±0.15 rad) can carry its ends past its row's line
const TRACTORS = [
  // two old tractors: a broken red one in the yard, leaning where its wheel came off, and a green one that still runs, for sale in the
  // carport's last bay (here only when there is no carport)
  { u: -27, v: 14, turn: 0.4, colour: '#8a2f2a', broken: true, bay: null },
  { u: -5, v: 22, turn: 0.2, colour: '#4f7a34', broken: false, bay: 5 },
];

/**
 * The whole yard, around the hall among `footprints` that SKROT_HALL picks (without it, the fence closes at uMax). The layout comes from
 * its own seed, so it is the same on every load and moves no other roll.
 */
export function yardLayout(
  footprints: readonly { p: readonly number[] }[] = [],
  heightAt: (x: number, z: number) => number = () => 0,
  seed = 4120,
): YardLayout {
  const rnd = makeRnd(seed),
    pick = <T>(a: readonly T[]) => a[Math.floor(rnd() * a.length)]!;
  const hallIndex = footprints.findIndex(b => pointInPolygon(b.p as number[], SKROT_HALL.x, SKROT_HALL.z)),
    shedIndex = footprints.findIndex(b => pointInPolygon(b.p as number[], SKROT_CARPORT.x, SKROT_CARPORT.z)),
    outline = hallIndex >= 0 ? footprints[hallIndex]!.p : null,
    shedOutline = shedIndex >= 0 ? footprints[shedIndex]!.p : null,
    shedWalls = shedOutline ? outlineWalls(shedOutline) : [],
    shedFront = wallFacing(shedWalls, -INTO.x, -INTO.z), // open towards the road
    walls = outline ? outlineWalls(outline) : [],
    doorWall = wallFacing(walls, -INTO.z, INTO.x), // the wall facing back along u, towards the yard
    outlines: number[][] = [];

  // the fence: along the road, then back to the workshop's corner on the yard's side, so the yard opens onto its door; behind, from the
  // workshop to the carport, and from the carport's far end back to the road, so the yard opens onto the bays
  let east: FenceRun[],
    westBack = DEPTH_M;
  if (doorWall && shedFront && outline) {
    const a = worldToYard(doorWall.x0, doorWall.z0),
      b = worldToYard(doorWall.x0 + doorWall.ux * doorWall.len, doorWall.z0 + doorWall.uz * doorWall.len),
      front = a.v < b.v ? a : b,
      s0 = worldToYard(shedFront.x0, shedFront.z0),
      s1 = worldToYard(shedFront.x0 + shedFront.ux * shedFront.len, shedFront.z0 + shedFront.uz * shedFront.len),
      [shedW, shedE] = s0.u < s1.u ? [s0, s1] : [s1, s0],
      shedEW = yardToWorld(shedE.u, shedE.v);
    let corner = { u: 0, v: 0 },
      best = Infinity; // the workshop's corner nearest the carport's east end
    for (let i = 0; i < outline.length; i += 2) {
      const d = Math.hypot(outline[i]! - shedEW.x, outline[i + 1]! - shedEW.z);
      if (d < best) {
        best = d;
        corner = worldToYard(outline[i]!, outline[i + 1]!);
      }
    }
    westBack = shedW.v + ((shedW.v - shedE.v) / (shedE.u - shedW.u)) * (shedW.u - U_MIN); // the carport's line, carried on to the west
    east = [
      { u0: GATE_HALF_M, v0: 0, u1: front.u, v1: 0 },
      { u0: front.u, v0: 0, u1: front.u, v1: front.v },
      { u0: corner.u, v0: corner.v, u1: shedE.u, v1: shedE.v },
      { u0: shedW.u, v0: shedW.v, u1: U_MIN, v1: westBack },
    ];
  } else if (doorWall) {
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
    { u0: U_MIN, v0: westBack, u1: U_MIN, v1: 0 },
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
    workshop = {
      outline,
      walls,
      doorWall,
      doorFrom,
      doorTo,
      bay,
      props,
      floor: fitFloor(outline, heightAt),
      ramp: { wall: doorWall, from: doorFrom, to: doorTo },
      bounds: floorBounds(outline),
    };
  }

  // the carport: walls on three sides, posts along the open front between its bays
  let carport: Carport | null = null;
  if (shedOutline && shedFront) {
    const posts: { x: number; z: number }[] = [];
    for (const w of shedWalls) if (w !== shedFront) outlines.push(wallStrip(w, 0, w.len, WALL_THICK_M));
    for (let k = 0; k <= CARPORT_BAYS; k++) {
      const s = (shedFront.len * k) / CARPORT_BAYS,
        x = shedFront.x0 + shedFront.ux * s - shedFront.nx * 0.2,
        z = shedFront.z0 + shedFront.uz * s - shedFront.nz * 0.2;
      posts.push({ x, z });
      outlines.push(wallStrip({ ...shedFront, x0: x, z0: z }, -CARPORT_POST_M / 2, CARPORT_POST_M / 2, CARPORT_POST_M));
    }
    carport = {
      outline: shedOutline,
      walls: shedWalls,
      front: shedFront,
      posts,
      floor: fitFloor(shedOutline, heightAt),
      ramp: { wall: shedFront, from: 0, to: shedFront.len }, // along the whole open front
      bounds: floorBounds(shedOutline),
    };
  }

  outlines.push(rect(HUT.u, HUT.v, HUT.w, HUT.d));
  outlines.push(rect(CONTAINERS.u, CONTAINERS.v, CONTAINERS.w, CONTAINERS.d * 2));
  outlines.push(rect(OWNER_UV.u, OWNER_UV.v, 0.7, 0.7)); // Plåt-Pelle stands his ground

  const yardCars: YardCar[] = [],
    forSale: YardCar[] = [];
  for (const row of WRECK_ROWS) {
    for (let u = row.u0; u <= row.u1 + 0.01; u += WRECK_GAP_M) {
      if (!row.fresh && rnd() < 0.12) continue; // a gap where one has gone to the crusher
      const below: YardCar = row.fresh
        ? {
            u,
            v: row.v,
            turn: Math.PI,
            tilt: 0,
            pitch: 0,
            model: pick(YARD_CAR_MODELS),
            colour: pick(FRESH_COLOURS),
            wrecked: false,
            stack: 0,
          } // noses to the yard, in a straight line
        : {
            u: u + (rnd() - 0.5) * 0.4,
            v: row.v + (rnd() - 0.5) * 0.8,
            turn: (rnd() < 0.5 ? 0 : Math.PI) + (rnd() - 0.5) * 0.3,
            tilt: (rnd() - 0.5) * 0.24,
            pitch: (rnd() - 0.5) * 0.12,
            model: pick(YARD_CAR_MODELS),
            colour: pick(WRECK_COLOURS),
            wrecked: true,
            stack: 0,
          };
      (row.fresh ? forSale : yardCars).push(below);
      if (row.stacks && rnd() < 0.45) {
        below.stack = 1;
        yardCars.push({
          ...below,
          turn: below.turn + (rnd() - 0.5) * 0.4,
          tilt: (rnd() - 0.5) * 0.1,
          pitch: (rnd() - 0.5) * 0.06,
          model: pick(YARD_CAR_MODELS),
          colour: pick(WRECK_COLOURS),
          stack: 2,
        });
      }
    }
    if (!row.fresh)
      outlines.push(rect((row.u0 + row.u1) / 2, row.v, row.u1 - row.u0 + 2.2, (WRECK_HALF_LEN_M + WRECK_SPREAD_M) * 2));
  }
  let looseWheel: { u: number; v: number } | null = null;
  for (const { broken, bay, ...spot } of TRACTORS) {
    const t = { ...spot, ...(carport && bay !== null ? inBay(carport, bay) : {}) };
    (broken ? yardCars : forSale).push({
      ...t,
      tilt: broken ? 0.16 : 0,
      pitch: broken ? -0.05 : 0,
      model: 'traktor',
      wrecked: broken,
      stack: 0,
    });
    if (!broken) continue; // the one for sale is a car you can drive away, with no outline of its own, like the others on the lot
    outlines.push(rect(t.u, t.v, 2.3, 3.6, t.turn));
    looseWheel = { u: t.u + 2.4, v: t.v + 0.6 }; // lying on the ground by its side
    outlines.push(rect(looseWheel.u, looseWheel.v, 1.6, 1.6));
  }
  outlines.push(rect(SALE_SIGN.u, SALE_SIGN.v, SALE_SIGN.w, 0.4)); // its posts and the board between them

  // more cars for sale, parked nose in under the carport, in four of its six bays; the third stays free to drive into
  if (carport) {
    for (const k of [0, 1, 3, 4]) {
      const { turn, ...p } = inBay(carport, k),
        t = turn + (rnd() - 0.5) * 0.15;
      forSale.push({
        ...p,
        turn: t,
        tilt: 0,
        pitch: 0,
        model: pick(YARD_CAR_MODELS),
        colour: pick(FRESH_COLOURS),
        wrecked: false,
        stack: 0,
      });
    }
  }

  const heaps: Heap[] = [
    { u: 0, v: 33, r: 5 }, // the big heap at the back of the drive
    { u: -27, v: 6, r: 3 },
    { u: -25, v: 36, r: 2.5 },
  ];
  for (const h of heaps)
    outlines.push(rect(h.u, h.v, h.r * 1.6, h.r * 1.6, Math.PI / 4), rect(h.u, h.v, h.r * 1.6, h.r * 1.6));

  const tyres: Tyres[] = [
    { u: -19, v: 4, n: 5 },
    { u: -19.9, v: 4.7, n: 3 },
    { u: 22.5, v: 3.5, n: 6 },
    { u: -9, v: 27, n: 4 },
  ];
  for (const t of tyres) outlines.push(rect(t.u, t.v, 0.8, 0.8));

  return {
    fence,
    yardCars,
    forSale,
    looseWheel,
    heaps,
    tyres,
    signs: SIGNS_XZ.map(s => ({ ...worldToYard(s.x, s.z), facing: s.facing })),
    workshop,
    carport,
    passable: [workshop ? hallIndex : -1, carport ? shedIndex : -1].filter(i => i >= 0), // only a building whose walls were built
    outlines,
  };
}
