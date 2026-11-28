// The shooting range by Stockarydsvägen (#545, with ?lab=rapier): a firing line, a timbered pavilion at its end, seven
// lanes with a target each, from 10 to 100 m, and an earth bank behind the farthest. Vrigstads skytteförening shot
// opposite Hoåsen, south of Stockarydsvägen, from 1949, and put up a timbered pavilion on its 300 m bank in 1960; the
// exact spot isn't known, so the range is on open ground south of the road, east of the village. A first step: the
// targets fall when a shot hits them and stand up again, and three of them move; the timed programs come later. Pure:
// no three.js, no DOM.
import type { PropSpec } from './physics-world';

/** the middle of the firing line; the lanes run south from it, away from the road (m) */
export const RANGE_X = 630,
  RANGE_Z = 0;
/** how far apart the lanes are (m) */
export const LANE_M = 4;
/**
 * each lane's target, west to east (m from the firing line). Of every order of these, at 4 m apart, this one leaves the
 * most room between a far board and the near ones in front of it, seen from any lane's spot on the firing line: 0.8 m,
 * against a 0.7 m board, so no target hides another
 */
export const TARGET_DISTANCES_M = [50, 10, 35, 100, 25, 75, 15] as const;

/**
 * A target: a board on a thin post. The post is its main box, the board a second box at the top, so a shot past the
 * board's edge flies on rather than meeting a box as wide as the board down to the ground.
 */
export const TARGET = {
  postM: 0.1, // square
  heightM: 1.8, // to the top of the board
  boardM: 0.7, // square
  boardThickM: 0.05,
  postKg: 6,
  boardKg: 4, // plywood: light enough that a pickadoll shot tips it over
};

/**
 * The timbered pavilion at the west end of the firing line, open to the south: its middle, and its size (m). Not over
 * the firing line, as the real one stood: the camera behind you would be inside it.
 */
export const PAVILION = {
  x: RANGE_X - 20,
  z: RANGE_Z - 1,
  widthM: 8,
  depthM: 3.5,
  heightM: 2.6,
  wallM: 0.15,
  roofOverhangM: 0.4, // past the walls at the sides and the back,
  roofFrontM: 1, // and further out over the open front, the shooters' shade
};
/**
 * The earth bank behind the farthest target (m). Twice as wide as the lanes, so it stops a shot aimed at any target
 * from its own lane or the next; one aimed across the range from its far end can still pass it.
 */
export const BANK = { x: RANGE_X, z: RANGE_Z + 106, widthM: 60, depthM: 5, heightM: 4, sinkM: 0.5 }; // sunk, to meet a slope

/** Where each target stands: its lane's middle, `distanceM` south of the firing line. */
export function rangeTargets() {
  return TARGET_DISTANCES_M.map((distanceM, k) => ({
    x: RANGE_X + (k - (TARGET_DISTANCES_M.length - 1) / 2) * LANE_M,
    z: RANGE_Z + distanceM,
    distanceM,
  }));
}

/** The targets as props for the physics world, standing on the ground as drawn. */
export function targetSpecs(groundAt: (x: number, z: number) => number): PropSpec[] {
  return rangeTargets().map(({ x, z }) => boardSpec(x, z, groundAt(x, z), TARGET.heightM));
}

/** A target's board on its post, `heightM` to the board's top, standing at (x, z) on ground at `baseY`. */
function boardSpec(x: number, z: number, baseY: number, heightM: number): PropSpec {
  const t = TARGET,
    boardHalf = t.boardM / 2;
  return {
    x,
    z,
    baseY,
    rotationY: 0, // the board's face looks along z: at the firing line, and away from it
    widthM: t.postM,
    depthM: t.postM,
    heightM,
    massKg: t.postKg,
    isTarget: true,
    parts: [
      {
        x: 0,
        y: heightM / 2 - boardHalf,
        z: 0,
        hx: boardHalf,
        hy: boardHalf,
        hz: t.boardThickM / 2,
        massKg: t.boardKg,
      },
    ],
  };
}

/** What a moving target is: the board that runs on its rail. */
export const MoverKind = {
  /** löpande älg: a moose's silhouette, life-size, running across an opening, as in the real discipline */
  MOOSE: 'moose',
  /** a target's board on a short post, sliding side to side */
  SLIDER: 'slider',
} as const;
export type MoverKind = (typeof MoverKind)[keyof typeof MoverKind];

/**
 * A target on a rail across the range: its middle runs from `fromM` east to `toM` (m east of the firing line's middle)
 * and back, `distanceM` south of the firing line, stopping `pauseS` at each end. It starts `startS` into its round, so the
 * movers don't all turn at once.
 */
export interface MovingTarget {
  kind: MoverKind;
  distanceM: number;
  fromM: number;
  toM: number;
  speedMps: number;
  pauseS: number;
  startS: number;
}

/**
 * The moving targets. None hides a standing board from any lane's spot on the firing line (TARGET_DISTANCES_M):
 * - The moose runs on the west side, in front of lanes 0 to 2 and the ground west of them, in front of the pavilion:
 *   at 80 m it is behind every board but the 100 m one, and the lines to that one cross 80 m east of where its muzzle
 *   reaches. Its track, with the silhouette's length, is about 21 m: 5 s at a moose's trot.
 * - The sliders are low: their boards' tops are below the standing boards' bottom edges (SLIDER_HEIGHT_M), and a line
 *   from a muzzle above those edges to a board passes over them, wherever they are. So they can cross the lanes, at 27 m
 *   and 52 m, clear of the boards at 25 m and 50 m. The near one slides one lane's width, the far one two: at 27 m, a
 *   shot at a board two lanes across would pass the bank.
 */
export const MOVERS = {
  RUNNING_MOOSE: { kind: MoverKind.MOOSE, distanceM: 80, fromM: -22, toM: -5, speedMps: 4, pauseS: 1.5, startS: 0 },
  NEAR_SLIDER: { kind: MoverKind.SLIDER, distanceM: 27, fromM: -6, toM: -2, speedMps: 1, pauseS: 0.5, startS: 3 },
  FAR_SLIDER: { kind: MoverKind.SLIDER, distanceM: 52, fromM: 0, toM: 8, speedMps: 1, pauseS: 0.5, startS: 11 },
} as const satisfies Record<string, MovingTarget>;
/** the moving targets, in the order their props are made */
export const MOVING_TARGETS: readonly MovingTarget[] = Object.values(MOVERS);

/** a slider's height, to the top of its board: below the standing boards' bottom edge, 1.1 m (m) */
export const SLIDER_HEIGHT_M = 1;

/**
 * The moose's silhouette, a board as thick as a target's, in its own frame: x along it, its head to +x, y up from the
 * ground. Each box is its middle and its size (m). Its post, the prop's main box, stands under the middle of its back.
 */
export const MOOSE = {
  postM: 0.1,
  heightM: 1.75, // the post, from the ground up to the back
  postKg: 6,
  boardKg: 14,
  /** from the middle to the end of the muzzle, and to the rump (m) */
  frontM: 2,
  backM: 1.1,
  parts: [
    { x: 0, y: 1.3, w: 2.2, h: 0.8 }, // the body
    { x: 0.6, y: 1.75, w: 0.7, h: 0.2 }, // the hump at the withers
    { x: 1.2, y: 1.65, w: 0.5, h: 0.5 }, // the neck
    { x: 1.65, y: 1.75, w: 0.7, h: 0.35 }, // the head, down to the muzzle
    { x: 1.4, y: 2.02, w: 0.5, h: 0.14 }, // the antlers' palms
    { x: -0.75, y: 0.45, w: 0.3, h: 0.9 }, // the hind legs
    { x: 0.75, y: 0.45, w: 0.3, h: 0.9 }, // the front legs
  ],
} as const;

/** Where a moving target is: its middle on the ground, and its turn about the vertical (rad). */
export interface MoverPose {
  x: number;
  z: number;
  rotationY: number;
}

/**
 * Where mover `m` is `tS` seconds after the range was built, written to `out`: running east, stopped at the east end,
 * running back west, stopped at the west end, and round again. It faces the way it runs, and turns about at the start
 * of each run: rotationY 0 faces east, π west.
 */
export function moverPose(m: MovingTarget, tS: number, out: MoverPose) {
  const runS = (m.toM - m.fromM) / m.speedMps,
    roundS = 2 * (runS + m.pauseS),
    u = (((tS + m.startS) % roundS) + roundS) % roundS; // how far into this round, also before 0 (s)
  let eastM: number; // from `fromM`
  if (u < runS) eastM = u * m.speedMps;
  else if (u < runS + m.pauseS) eastM = m.toM - m.fromM;
  else if (u < 2 * runS + m.pauseS) eastM = (2 * runS + m.pauseS - u) * m.speedMps;
  else eastM = 0;
  out.x = RANGE_X + m.fromM + eastM;
  out.z = RANGE_Z + m.distanceM;
  out.rotationY = u < runS + m.pauseS ? 0 : Math.PI;
  return out;
}

/** The moving targets as props for the physics world, where they are when the range is built. */
export function moverSpecs(groundAt: (x: number, z: number) => number): PropSpec[] {
  const pose: MoverPose = { x: 0, z: 0, rotationY: 0 };
  return MOVING_TARGETS.map(m => {
    const { x, z, rotationY } = moverPose(m, 0, pose),
      baseY = groundAt(x, z);
    if (m.kind === MoverKind.SLIDER) return { ...boardSpec(x, z, baseY, SLIDER_HEIGHT_M), rotationY, moves: true };
    const o = MOOSE,
      area = o.parts.reduce((a, p) => a + p.w * p.h, 0),
      half = o.heightM / 2;
    return {
      x,
      z,
      baseY,
      rotationY,
      widthM: o.postM,
      depthM: TARGET.boardThickM,
      heightM: o.heightM,
      massKg: o.postKg,
      isTarget: true,
      moves: true,
      parts: o.parts.map(p => ({
        x: p.x,
        y: p.y - half,
        z: 0,
        hx: p.w / 2,
        hy: p.h / 2,
        hz: TARGET.boardThickM / 2,
        massKg: (o.boardKg * p.w * p.h) / area, // plywood: each box weighs its share of the board
      })),
    };
  });
}

/**
 * The range's solid parts as boxes for the physics world, so a shot stops at them: the bank, and the pavilion's back
 * wall, its sides and its roof. Each is its middle and half its size (m).
 */
export function rangeBlocks(groundAt: (x: number, z: number) => number) {
  const p = PAVILION,
    b = BANK,
    py = groundAt(p.x, p.z),
    wall = p.wallM / 2,
    roof = roofBox();
  return [
    {
      x: b.x,
      y: groundAt(b.x, b.z) + (b.heightM - b.sinkM) / 2,
      z: b.z,
      hx: b.widthM / 2,
      hy: (b.heightM + b.sinkM) / 2,
      hz: b.depthM / 2,
    },
    { x: p.x, y: py + p.heightM / 2, z: p.z - p.depthM / 2, hx: p.widthM / 2, hy: p.heightM / 2, hz: wall },
    { x: p.x - p.widthM / 2, y: py + p.heightM / 2, z: p.z, hx: wall, hy: p.heightM / 2, hz: p.depthM / 2 },
    { x: p.x + p.widthM / 2, y: py + p.heightM / 2, z: p.z, hx: wall, hy: p.heightM / 2, hz: p.depthM / 2 },
    { x: p.x, y: py + roof.y, z: p.z + roof.z, hx: roof.widthM / 2, hy: roof.thickM / 2, hz: roof.depthM / 2 },
  ];
}

/** The pavilion's roof, about the pavilion's middle at ground level: its size and where its middle is (m). */
export function roofBox() {
  const p = PAVILION,
    thickM = 0.2,
    depthM = p.depthM + p.roofOverhangM + p.roofFrontM;
  return {
    widthM: p.widthM + 2 * p.roofOverhangM,
    depthM,
    thickM,
    y: p.heightM + thickM / 2,
    z: (p.roofFrontM - p.roofOverhangM) / 2,
  };
}
