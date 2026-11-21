import { describe, expect, it } from 'vitest';
import { VEHICLES } from '../../../src/game/render/vehicle-registry';
import {
  NISSE_UV,
  RAMP_M,
  RING_UV,
  SKROT_HALL,
  WORKSHOP_DOOR,
  WRECK_MODELS,
  workshopFloorAt,
  worldToYard,
  YARD,
  yardLayout,
  yardToWorld,
} from '../../../src/game/skroten-yard';
import { pointInPolygon, segmentDistance } from '../../../src/world/polygon';

// the hall that becomes the workshop, as data/vrigstad.json has it, among two other buildings
const HALL = [
  922.7, 73.4, 932.3, 73.5, 932.2, 79.0, 967.3, 79.5, 967.2, 90.2, 961.5, 90.1, 961.5, 94.4, 956.1, 94.4, 956.0, 98.7,
  931.7, 98.4, 931.7, 92.2, 922.5, 92.1,
];
// and the long carport behind the yard
const CARPORT = [890.7, 134.5, 890.3, 113.0, 934.9, 112.0, 935.3, 133.6];
const FOOTPRINTS = [{ p: [0, 0, 10, 0, 10, 10, 0, 10] }, { p: HALL }, { p: CARPORT }];
const CAR_R_M = 1.5; // a car's collision radius (cars.ts)

// how far the world point (x, z) is from the nearest outline you collide with; 0 inside one
function clearanceXZ(outlines: number[][], x: number, z: number) {
  let best = 1e9;
  for (const p of outlines) {
    if (pointInPolygon(p, x, z)) return 0;
    for (let i = 0, j = p.length - 2; i < p.length; j = i, i += 2)
      best = Math.min(best, segmentDistance(x, z, p[j], p[j + 1], p[i], p[i + 1]));
  }
  return best;
}
const clearance = (outlines: number[][], u: number, v: number) => {
  const { x, z } = yardToWorld(u, v);
  return clearanceXZ(outlines, x, z);
};

describe('Skroten yard', () => {
  it('is laid out the same on every load', () => {
    expect(yardLayout(FOOTPRINTS)).toEqual(yardLayout(FOOTPRINTS));
    expect(yardLayout(FOOTPRINTS).wrecks.length).toBeGreaterThan(20);
  });

  it("dresses its wrecks in the game's car models, and a tractor or two", () => {
    const ids = VEHICLES.map(v => v.id as string);
    for (const m of WRECK_MODELS) expect(ids).toContain(m);
    const models = new Set(yardLayout(FOOTPRINTS).wrecks.map(w => w.model));
    expect(models.size).toBeGreaterThanOrEqual(5);
    expect(models.has('traktor')).toBe(true);
    const tractors = yardLayout(FOOTPRINTS).wrecks.filter(w => w.model === 'traktor');
    expect(new Set(tractors.map(t => t.colour)).size).toBe(tractors.length); // no two the same colour
  });

  it('stacks a car only on one standing alone below it', () => {
    const { wrecks } = yardLayout(FOOTPRINTS);
    wrecks.forEach((w, i) => {
      if (w.stack === 2) expect(wrecks[i - 1]!.stack).toBe(1);
    });
  });

  it('turns the frame without stretching it: u runs along the road, v into the yard, both in metres', () => {
    const o = yardToWorld(0, 0),
      a = yardToWorld(10, 0),
      b = yardToWorld(0, 10);
    expect(Math.hypot(a.x - o.x, a.z - o.z)).toBeCloseTo(10, 2);
    expect(Math.hypot(b.x - o.x, b.z - o.z)).toBeCloseTo(10, 2);
    expect(b.z).toBeGreaterThan(o.z); // into the yard is southwards, away from Stockarydsvägen
    const back = worldToYard(yardToWorld(-12, 30).x, yardToWorld(-12, 30).z);
    expect(back.u).toBeCloseTo(-12, 2);
    expect(back.v).toBeCloseTo(30, 2);
  });

  it('leaves the drive from the road through the gate to the ring clear for a car', () => {
    const { outlines } = yardLayout(FOOTPRINTS);
    for (let v = -5; v <= RING_UV.v + 4; v += 0.5)
      expect(clearance(outlines, RING_UV.u, v)).toBeGreaterThan(CAR_R_M + 0.1);
  });

  it('puts Skrot-Nisse beside the ring, not on it', () => {
    const d = Math.hypot(NISSE_UV.u - RING_UV.u, NISSE_UV.v - RING_UV.v);
    expect(d).toBeGreaterThan(5.5); // the ring for a car is 3.75 m across its middle
    expect(d).toBeLessThan(9);
  });

  it('opens the yard onto the workshop, whose hall stops colliding as a block and gets walls with a door instead', () => {
    const y = yardLayout(FOOTPRINTS);
    expect(y.passable).toEqual([1, 2]);
    expect(worldToYard(SKROT_HALL.x, SKROT_HALL.z).u).toBeGreaterThan(YARD.uMax);
    const ws = y.workshop!;
    expect(ws.doorTo - ws.doorFrom).toBe(WORKSHOP_DOOR.w);
    expect(ws.doorWall.nx).toBeLessThan(-0.9); // the west wall, facing the yard
    // no fence between the yard and the door: a car fits through it
    const mid = (ws.doorFrom + ws.doorTo) / 2,
      dx = ws.doorWall.x0 + ws.doorWall.ux * mid,
      dz = ws.doorWall.z0 + ws.doorWall.uz * mid;
    expect(clearanceXZ(y.outlines, dx, dz)).toBeGreaterThan(CAR_R_M);
    expect(pointInPolygon(HALL, dx + 1, dz)).toBe(true);
  });

  it('keeps a clear way from the ring to the door and on in to the bay between the lift posts', () => {
    const y = yardLayout(FOOTPRINTS),
      ws = y.workshop!,
      mid = (ws.doorFrom + ws.doorTo) / 2,
      door = { x: ws.doorWall.x0 + ws.doorWall.ux * mid, z: ws.doorWall.z0 + ws.doorWall.uz * mid },
      ring = yardToWorld(RING_UV.u, RING_UV.v),
      // in a line from the ring to 4 m in front of the door, then straight in to the bay
      front = { x: door.x + ws.doorWall.nx * 4, z: door.z + ws.doorWall.nz * 4 };
    for (const [a, b] of [
      [ring, front],
      [front, ws.bay],
    ] as const)
      for (let t = 0.1; t <= 1; t += 0.05) {
        const x = a.x + (b.x - a.x) * t,
          z = a.z + (b.z - a.z) * t;
        expect(clearanceXZ(y.outlines, x, z), `at ${x.toFixed(1)}, ${z.toFixed(1)}`).toBeGreaterThan(CAR_R_M);
      }
    expect(ws.props.filter(p => p.kind === 'post')).toHaveLength(2);
  });

  it('closes the fence at uMax without the hall', () => {
    const y = yardLayout([]);
    expect(y.workshop).toBeNull();
    expect(y.passable).toEqual([]);
    expect(Math.max(...y.fence.flatMap(f => [f.u0, f.u1]))).toBe(YARD.uMax);
  });

  it('opens the yard onto the carport: a car drives from the ring into an empty bay between its posts', () => {
    const y = yardLayout(FOOTPRINTS),
      cp = y.carport!;
    expect(cp.posts).toHaveLength(7);
    expect(cp.front.nz).toBeLessThan(-0.9); // open to the north, towards the yard and the road
    const ring = yardToWorld(RING_UV.u, RING_UV.v),
      s = cp.front.len * (2.5 / 6), // the third bay, left empty
      mouth = {
        x: cp.front.x0 + cp.front.ux * s + cp.front.nx * 3,
        z: cp.front.z0 + cp.front.uz * s + cp.front.nz * 3,
      },
      inside = { x: mouth.x - cp.front.nx * 9, z: mouth.z - cp.front.nz * 9 };
    for (const [a, b] of [
      [ring, mouth],
      [mouth, inside],
    ] as const)
      for (let t = 0.1; t <= 1; t += 0.05) {
        const x = a.x + (b.x - a.x) * t,
          z = a.z + (b.z - a.z) * t;
        expect(clearanceXZ(y.outlines, x, z), `at ${x.toFixed(1)}, ${z.toFixed(1)}`).toBeGreaterThan(CAR_R_M);
      }
    expect(
      y.wrecks.filter(w => pointInPolygon(CARPORT, yardToWorld(w.u, w.v).x, yardToWorld(w.u, w.v).z)),
    ).toHaveLength(4);
  });

  it('gives the workshop an even floor clear of bumpy, rising ground, with a ramp from the door down to the yard', () => {
    const ground = (x: number, z: number) => 0.09 * (x - 900) + 0.3 * Math.sin(x / 7) * Math.cos(z / 5), // rises east, bumpy
      ws = yardLayout(FOOTPRINTS, ground).workshop!,
      floor = (x: number, z: number) => workshopFloorAt(ws, x, z, ground);
    for (let x = 923; x < 967; x += 1.3)
      for (let z = 74; z < 98; z += 1.3) {
        const f = floor(x, z);
        if (f === null) continue; // outside the outline's notches
        expect(f).toBeGreaterThanOrEqual(ground(x, z));
        expect(f - ground(x, z)).toBeLessThan(1); // just clear of it, not a plinth
      }
    // even: halfway between two points, the floor is halfway between their heights
    const a = floor(930, 85)!,
      b = floor(950, 90)!;
    expect(floor(940, 87.5)).toBeCloseTo((a + b) / 2, 6);
    // the ramp: from the sill to the yard's ground over RAMP_M, nothing past it or beside the door
    const w = ws.doorWall,
      mid = (ws.doorFrom + ws.doorTo) / 2,
      at = (out: number, s = mid) => [w.x0 + w.ux * s + w.nx * out, w.z0 + w.uz * s + w.nz * out] as const,
      [ex, ez] = at(RAMP_M - 0.001);
    expect(floor(ex, ez)).toBeCloseTo(ground(ex, ez), 2);
    expect(floor(...at(RAMP_M + 0.5))).toBeNull();
    expect(floor(...at(1, ws.doorFrom - 1))).toBeNull();
    expect(floor(10, 10)).toBeNull();
  });
});
