// The shooting range by Stockarydsvägen (#545, with ?lab=rapier): a firing line, a timbered pavilion at its end, seven
// lanes with a target each, from 10 to 100 m, and an earth bank behind the farthest. Vrigstads skytteförening shot
// opposite Hoåsen, south of Stockarydsvägen, from 1949, and put up a timbered pavilion on its 300 m bank in 1960; the
// exact spot isn't known, so the range is on open ground south of the road, east of the village. A first step: the
// targets fall when a shot hits them and stand up again; the timed programs come later. Pure: no three.js, no DOM.
import type { PropSpec } from './physics-world';

/** the middle of the firing line; the lanes run south from it, away from the road (m) */
export const RANGE_X = 630,
  RANGE_Z = 0;
/** how far apart the lanes are (m) */
const LANE_M = 3;
/** each lane's target, west to east: near and far mixed, so no target hides another (m from the firing line) */
export const TARGET_DISTANCES_M = [25, 10, 50, 15, 100, 35, 75] as const;

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
export const PAVILION = { x: RANGE_X - 17, z: RANGE_Z - 1, widthM: 8, depthM: 3.5, heightM: 2.6 };
/** The earth bank behind the farthest target, which stops what misses (m). */
export const BANK = { x: RANGE_X, z: RANGE_Z + 106, widthM: 30, depthM: 5, heightM: 4 };

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
  const t = TARGET,
    boardHalf = t.boardM / 2;
  return rangeTargets().map(({ x, z }) => ({
    x,
    z,
    baseY: groundAt(x, z),
    rotationY: 0, // the board's face looks along z: at the firing line, and away from it
    widthM: t.postM,
    depthM: t.postM,
    heightM: t.heightM,
    massKg: t.postKg,
    isTarget: true,
    parts: [
      {
        x: 0,
        y: t.heightM / 2 - boardHalf,
        z: 0,
        hx: boardHalf,
        hy: boardHalf,
        hz: t.boardThickM / 2,
        massKg: t.boardKg,
      },
    ],
  }));
}

/**
 * The range's solid parts as boxes for the physics world, so a shot stops at them: the bank, and the pavilion's back
 * wall, its sides and its roof. Each is its middle and half its size (m).
 */
export function rangeBlocks(groundAt: (x: number, z: number) => number) {
  const p = PAVILION,
    b = BANK,
    py = groundAt(p.x, p.z),
    wall = 0.15;
  return [
    {
      x: b.x,
      y: groundAt(b.x, b.z) + b.heightM / 2 - 0.5,
      z: b.z,
      hx: b.widthM / 2,
      hy: b.heightM / 2 + 0.5,
      hz: b.depthM / 2,
    },
    { x: p.x, y: py + p.heightM / 2, z: p.z - p.depthM / 2, hx: p.widthM / 2, hy: p.heightM / 2, hz: wall / 2 },
    { x: p.x - p.widthM / 2, y: py + p.heightM / 2, z: p.z, hx: wall / 2, hy: p.heightM / 2, hz: p.depthM / 2 },
    { x: p.x + p.widthM / 2, y: py + p.heightM / 2, z: p.z, hx: wall / 2, hy: p.heightM / 2, hz: p.depthM / 2 },
    { x: p.x, y: py + p.heightM + 0.1, z: p.z + 0.3, hx: p.widthM / 2 + 0.4, hy: 0.1, hz: p.depthM / 2 + 0.6 },
  ];
}
