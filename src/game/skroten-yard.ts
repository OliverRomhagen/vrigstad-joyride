// Skroten's yard (#76), on the field south of Stockarydsvägen: the fence, the gate, the hut, the containers, the rows of wrecks and the
// scrap heaps, laid out once from their own random stream. Plain data: render/skroten.ts draws it, and main.ts adds the outlines to the
// buildings so cars and people collide with them. No three.js or DOM here.
import { makeRnd } from '../world/random';

/**
 * The yard is laid out in its own frame: u runs along the road (eastwards), v from the road into the yard (southwards), in metres, with
 * (0, 0) in the middle of the gate. The gate stands 10 m from the road's middle line, where it passes x = 640.
 */
export const YARD_GATE = { x: 637.1, z: -11.1 } as const;
const ALONG = { x: 0.9563, z: 0.2924 }, // the road's direction past the gate, as a unit vector
  INTO = { x: -0.2924, z: 0.9563 }; // and the way into the yard, at right angles to it
/** The yard frame's turn about y, for three.js: local x is u, local z is v. */
export const YARD_TURN = -Math.atan2(ALONG.z, ALONG.x);

/** The fence runs 36 m either side of the gate's middle and 48 m back from the road; the gate is 12 m wide, room to swing a car in. */
export const YARD = { halfU: 36, depth: 48, gateHalf: 6 } as const;
const { halfU: HALF_U_M, depth: DEPTH_M, gateHalf: GATE_HALF_M } = YARD;
const FENCE_THICK_M = 0.3; // what you collide with; the panels themselves are thinner
const SIGN_OUT_M = 70,
  SIGN_V_M = -3.5; // the arrow signs stand 70 m either way along the road, on its yard side

/** The ring you drive onto to sell a car, just inside the gate, and where Skrot-Nisse stands beside it. */
export const RING_UV = { u: 0, v: 10 } as const;
export const NISSE_UV = { u: -7.5, v: 9 } as const;
/** The hut by the gate: its middle and its size along u and v (m). Its door is on the end towards the ring. */
export const HUT = { u: -13, v: 7, w: 7, d: 3 } as const;
/** Two containers side by side, and one on top across them. */
export const CONTAINERS = { u: 18, v: 6, w: 6.1, d: 2.45 } as const;

export interface Wreck {
  u: number;
  v: number;
  turn: number; // radians about y, in the yard's frame
  tilt: number; // radians about its length: a car sagging on flat tyres
  type: 'volvo' | 'saab';
  colour: string; // sRGB, faded or rusting
  onTop: boolean; // a crushed car lying on the one below
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
export interface YardLayout {
  fence: FenceRun[];
  wrecks: Wreck[];
  heaps: Heap[];
  tyres: Tyres[];
  /** Arrow signs by the road: where they stand, and whether the yard is to the driver's right as they pass it. */
  signs: { u: number; v: number; facing: 1 | -1 }[];
  /** World outlines (flat [x, z, ...]) that cars and people collide with. */
  outlines: number[][];
}

/** A point of the yard's frame in world coordinates. */
export function yardToWorld(u: number, v: number) {
  return { x: YARD_GATE.x + u * ALONG.x + v * INTO.x, z: YARD_GATE.z + u * ALONG.z + v * INTO.z };
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
];
const WRECK_ROWS = [
  // rows of wrecks parked side by side, noses towards the road or away: from u0 to u1, at v
  { u0: -33, u1: -17, v: 20 },
  { u0: -33, u1: -17, v: 29 },
  { u0: 17, u1: 33, v: 20 },
  { u0: 17, u1: 33, v: 29 },
  { u0: -33, u1: 33, v: 43 },
];
const WRECK_GAP_M = 2.5; // between the middles of neighbours in a row
const WRECK_HALF_LEN_M = 2.5; // half a car's length, for the row's outline

/** The whole yard. The layout comes from its own seed, so it is the same on every load and moves no other roll. */
export function yardLayout(seed = 4120): YardLayout {
  const rnd = makeRnd(seed),
    pick = <T>(a: readonly T[]) => a[Math.floor(rnd() * a.length)]!;
  const fence: FenceRun[] = [
    { u0: -HALF_U_M, v0: 0, u1: -GATE_HALF_M, v1: 0 },
    { u0: GATE_HALF_M, v0: 0, u1: HALF_U_M, v1: 0 },
    { u0: HALF_U_M, v0: 0, u1: HALF_U_M, v1: DEPTH_M },
    { u0: HALF_U_M, v0: DEPTH_M, u1: -HALF_U_M, v1: DEPTH_M },
    { u0: -HALF_U_M, v0: DEPTH_M, u1: -HALF_U_M, v1: 0 },
  ];
  const outlines = fence.map(f => {
    const len = Math.hypot(f.u1 - f.u0, f.v1 - f.v0);
    return rect((f.u0 + f.u1) / 2, (f.v0 + f.v1) / 2, len, FENCE_THICK_M, -Math.atan2(f.v1 - f.v0, f.u1 - f.u0));
  });
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
        type: rnd() < 0.6 ? 'volvo' : 'saab',
        colour: pick(WRECK_COLOURS),
        onTop: false,
      };
      wrecks.push(below);
      if (rnd() < 0.35)
        wrecks.push({
          ...below,
          turn: below.turn + (rnd() - 0.5) * 0.5,
          tilt: (rnd() - 0.5) * 0.2,
          colour: pick(WRECK_COLOURS),
          onTop: true,
        });
    }
    outlines.push(rect((row.u0 + row.u1) / 2, row.v, row.u1 - row.u0 + 2.2, WRECK_HALF_LEN_M * 2));
  }

  const heaps: Heap[] = [
    { u: 0, v: 36, r: 5 }, // the big heap at the back of the drive
    { u: -27, v: 9, r: 3.5 },
    { u: 29, v: 13, r: 3 },
  ];
  for (const h of heaps)
    outlines.push(rect(h.u, h.v, h.r * 1.6, h.r * 1.6, Math.PI / 4), rect(h.u, h.v, h.r * 1.6, h.r * 1.6));

  const tyres: Tyres[] = [
    { u: -19, v: 4, n: 5 },
    { u: -19.9, v: 4.7, n: 3 },
    { u: 24, v: 3.2, n: 6 },
    { u: 9, v: 30, n: 4 },
  ];
  for (const t of tyres) outlines.push(rect(t.u, t.v, 0.8, 0.8));

  return {
    fence,
    wrecks,
    heaps,
    tyres,
    signs: [
      { u: -SIGN_OUT_M, v: SIGN_V_M, facing: 1 },
      { u: SIGN_OUT_M, v: SIGN_V_M, facing: -1 },
    ],
    outlines,
  };
}
