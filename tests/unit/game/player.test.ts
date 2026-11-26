import { describe, expect, it } from 'vitest';
import {
  type CarHold,
  type CarToStandOn,
  carInReach,
  carry,
  carTopAt,
  holdCar,
  hop,
  type PlayerState,
  standAt,
  standOn,
  stepOut,
  tooFastToGetOut,
  walk,
} from '../../../src/game/player';
import { specFor } from '../../../src/game/sim/vehicle-spec';

const you = (x = 0, z = 0): PlayerState => ({ x, z, y: 0, vy: 0, floor: 0, h: 0, speed: 0, phase: 0 });
const car = (x: number, z: number, mode = 'parked', h = 0, v = 0) => ({ x, z, h, v, mode });
const onFoot = { run: false, wet: false, still: false };
// walks `secs` in 10 ms frames
function walkFor(p: PlayerState, secs: number, mx: number, my: number, yaw: number, o = onFoot, half = 1100) {
  for (let t = 0; t < secs - 1e-9; t += 0.01) walk(p, 0.01, mx, my, yaw, o, half);
}

describe('player', () => {
  it('reaches the closest car within 4.4 m, never a police car', () => {
    const near = car(3, 0),
      cars = [car(0, 1, 'police'), car(4, 0), near, car(0, 5)];
    expect(carInReach(you(), cars)).toBe(near);
    expect(carInReach(you(), [car(4.4, 0), car(0, 1, 'police')])).toBeNull(); // just out of reach
  });

  it('reaches the closest of the cars that pass `only`, when given', () => {
    const near = car(0.9, 0),
      far = car(-2, 0),
      notNear = (c: object) => c !== near;
    expect(carInReach(you(), [near, car(0, -3), far], notNear)).toBe(far);
    expect(carInReach(you(), [near], notNear)).toBeNull();
    expect(carInReach(you(), [near, car(-4.5, 0)], notNear)).toBeNull(); // the one that passes is out of reach
  });

  it('gets out at up to 3 m/s, either way', () => {
    expect(tooFastToGetOut({ v: 3 })).toBe(false);
    expect(tooFastToGetOut({ v: 3.1 })).toBe(true);
    expect(tooFastToGetOut({ v: -3.1 })).toBe(true);
  });

  it('steps out 2 m to the car’s left, facing its way', () => {
    const p = you();
    stepOut(p, car(10, 10, 'player', 0)); // facing north: left is west
    expect(p).toMatchObject({ x: 8, z: 10, h: 0 });
    stepOut(p, car(10, 10, 'player', Math.PI / 2)); // facing east: left is north
    expect(p.x).toBeCloseTo(10);
    expect(p.z).toBeCloseTo(8);
    expect(p.h).toBeCloseTo(Math.PI / 2);
  });

  it('walks at 4.6 m/s the way the camera faces, runs at 8 and wades at 1.6', () => {
    const p = you();
    walkFor(p, 1, 0, 1, 0); // forward with the camera facing north: z goes down
    expect(p.x).toBeCloseTo(0);
    expect(p.z).toBeCloseTo(-4.6);
    expect(p.speed).toBeCloseTo(4.6);
    const r = you();
    walkFor(r, 1, 1, 0, 0, { ...onFoot, run: true }); // right, running: east
    expect(r.x).toBeCloseTo(8);
    expect(r.h).toBeCloseTo(Math.PI / 2);
    const w = you();
    walkFor(w, 1, 0, 1, 0, { ...onFoot, wet: true, run: true }); // water slows a run too
    expect(w.z).toBeCloseTo(-1.6);
  });

  it('stands still below the dead zone, while held still, and at the map’s edge', () => {
    const p = you();
    walkFor(p, 1, 0.05, 0.05, 0);
    expect(p).toMatchObject({ x: 0, z: 0, speed: 0 });
    walkFor(p, 1, 0, 1, 0, { ...onFoot, still: true });
    expect(p).toMatchObject({ x: 0, z: 0, speed: 0 });
    const e = you(0, -95);
    walkFor(e, 2, 0, 1, 0, onFoot, 100);
    expect(e.z).toBe(-98);
  });

  it('hops about 0.85 m and lands after 0.65 s, the same at any frame rate', () => {
    for (const dt of [1 / 30, 1 / 144]) {
      const p = you();
      let top = 0,
        t = 0;
      hop(p, dt, true);
      t += dt;
      top = p.y;
      while (p.y > 0) {
        hop(p, dt, true);
        t += dt;
        top = Math.max(top, p.y);
      } // holding jump in the air doesn't jump again
      expect(top).toBeCloseTo(5.2 ** 2 / (2 * 16), 1);
      expect(t).toBeCloseTo((2 * 5.2) / 16, 1);
    }
  });

  it('stands you on the ground, out of a jump', () => {
    const p = you();
    hop(p, 0.1, true);
    standAt(p, 5, 6);
    expect(p).toMatchObject({ x: 5, z: 6, y: 0, vy: 0 });
  });
});

// A parked Volvo at the origin, nose north (towards -z): its right side is +x, its roof runs from 1.95 m behind its middle to
// 0.35 m ahead of it (z from 1.95 to -0.35), at 1.54 m; its bonnet and load deck are at 0.98 m.
const volvo = (): CarToStandOn => ({ x: 0, z: 0, h: 0, T: specFor('volvo') });
const DT = 1 / 60;
// one frame on foot, as loop.ts runs it: you move, find what you stand on, then hop; `step` is how far you move this frame
function frame(
  p: PlayerState,
  cars: CarToStandOn[],
  jump: boolean,
  step = { x: 0, z: 0 },
  left: CarToStandOn | null = null,
) {
  p.x += step.x;
  p.z += step.z;
  const on = standOn(p, cars, DT, left);
  hop(p, DT, jump);
  return on;
}

describe('standing on cars (#451)', () => {
  it("knows a car's top: the roof over its cabin, the bonnet and load deck at its ends", () => {
    const c = volvo();
    expect(carTopAt(c, 0, 1)).toBe(1.54); // under the roof
    expect(carTopAt(c, 0, -1.5)).toBe(0.98); // the bonnet, ahead of the windscreen
    expect(carTopAt(c, 0, 2.2)).toBe(0.98); // the load deck behind the roof
  });

  it('pulls you up onto the roof when you jump at the side of a car', () => {
    const c = volvo(),
      p = you(0.87 + 0.35, 1); // beside the right side, touching it (body radius 0.87, a person 0.4)
    let on = frame(p, [c], true);
    for (let i = 0; i < 60; i++) on = frame(p, [c], false);
    expect(on).toBe(c);
    expect(p.floor).toBe(1.54);
    expect(p.y).toBe(1.54);
    expect(Math.abs(p.x)).toBeLessThan(0.87); // in over the car, not floating beside it
  });

  it('pulls you in over its side a little at a time, not in one jump', () => {
    const c = volvo(),
      p = you(0.87 + 0.35, 1);
    let most = 0;
    for (let i = 0; i < 60; i++) {
      const x = p.x,
        z = p.z;
      frame(p, [c], i === 0);
      most = Math.max(most, Math.hypot(p.x - x, p.z - z));
    }
    expect(p.floor).toBe(1.54);
    expect(most).toBeLessThan(0.15); // a walking frame is 0.077 m; it was 0.65 m at once
  });

  it("doesn't climb straight back onto the car you stepped off", () => {
    const c = volvo(),
      p = you(0.87 + 0.3, 1); // just off its side, still touching it, a little under its roof
    p.y = 1.5;
    for (let i = 0; i < 60; i++) frame(p, [c], false, { x: 0, z: 0 }, c);
    expect(p.y).toBe(0); // fell to the ground
    const again = you(0.87 + 0.35, 1);
    frame(again, [c], true); // a fresh jump at it, having landed, climbs it again
    for (let i = 0; i < 60; i++) frame(again, [c], false);
    expect(again.floor).toBe(1.54);
  });

  it('climbs from standing against its side, where the push out of cars leaves you, with a jump alone', () => {
    const c = volvo(),
      p = you(0.87 + 0.4, 1); // exactly at its side: the body's radius and a person's
    frame(p, [c], true);
    for (let i = 0; i < 60; i++) frame(p, [c], false);
    expect(p.floor).toBe(1.54);
  });

  it("doesn't climb a car you only walk into", () => {
    const c = volvo(),
      p = you(0.87 + 0.35, 1);
    for (let i = 0; i < 30; i++) expect(frame(p, [c], false)).toBeNull();
    expect(p.y).toBe(0);
    expect(p.floor).toBe(0);
  });

  it("can't reach a roof higher than the jump and the pull-up together", () => {
    const tractor: CarToStandOn = { x: 0, z: 0, h: 0, T: specFor('traktor') },
      p = you(0.95 + 0.35, 0.7); // beside the cab, whose roof is 2.72 m up
    frame(p, [tractor], true);
    for (let i = 0; i < 60; i++) frame(p, [tractor], false);
    expect(p.floor).toBe(0);
    expect(p.y).toBe(0);
  });

  it('keeps you on the roof, lets you jump on it, and drops you when you walk off its edge', () => {
    const c = volvo(),
      p = you(0, 1);
    p.y = p.floor = 1.54;
    expect(frame(p, [c], false)).toBe(c);
    expect(p.y).toBe(1.54);
    frame(p, [c], true); // a hop on the roof
    expect(p.y).toBeGreaterThan(1.54);
    for (let i = 0; i < 60; i++) frame(p, [c], false);
    expect(p.y).toBe(1.54); // back on the roof
    frame(p, [c], false, { x: 1.4, z: 0 }); // off its right side, clear of it, as loop.ts's push out of cars leaves you
    expect(p.floor).toBe(0);
    for (let i = 0; i < 60; i++) frame(p, [c], false);
    expect(p.y).toBe(0);
  });

  it('steps down from the roof onto the bonnet', () => {
    const c = volvo(),
      p = you(0, 0);
    p.y = p.floor = 1.54;
    frame(p, [c], false, { x: 0, z: -1 }); // ahead of the windscreen
    for (let i = 0; i < 60; i++) frame(p, [c], false);
    expect(p.y).toBe(0.98);
  });

  it('stops you at the windscreen when you walk from the bonnet into the roof', () => {
    const c = volvo(),
      p = you(0, -1.2);
    p.y = p.floor = 0.98;
    frame(p, [c], false, { x: 0, z: 1 }); // into the cabin, under the roof
    expect(p.z).toBeCloseTo(-0.36, 2); // back at the windscreen
    expect(p.y).toBe(0.98);
  });

  it('takes the roof height from the model a car wears, and keeps its roof in place on a longer one', () => {
    const impala = specFor('volvo', { length: 5.49, width: 2.03, height: 1.39 });
    expect(impala.roofM).toBe(1.39);
    expect(impala.deckM).toBe(0.98);
    expect(impala.roofRearM).toBeCloseTo((-1.95 * 5.49) / 4.8, 6);
  });

  it("takes a model's own roof span over its type's, so an estate on a hatchback's type stands on its whole roof", () => {
    const xc70 = specFor('saab', { length: 4.74, height: 1.56, roofRear: -2.2, roofFront: 0.2 });
    expect([xc70.roofRearM, xc70.roofFrontM]).toEqual([-2.2, 0.2]);
    expect(specFor('saab').roofRearM).toBe(-0.75); // the type keeps its own
  });
});

describe('carry', () => {
  const held = (c: CarToStandOn) => {
    const hold: CarHold<CarToStandOn> = { car: null, x: 0, z: 0, h: 0 };
    holdCar(hold, c);
    return hold;
  };

  it('moves you with the car you were on, and round as it turned', () => {
    const c = volvo(),
      hold = held(c),
      p = you(1, 0); // 1 m east of its middle
    c.z = -1; // it drove 1 m north
    c.h = Math.PI / 2; // and turned a quarter
    carry(p, hold);
    expect(p.x).toBeCloseTo(0, 6);
    expect(p.z).toBeCloseTo(0, 6); // a quarter turn round its new middle puts you 1 m south of it
    expect(p.h).toBeCloseTo(Math.PI / 2, 6);
  });

  it('leaves you be when you were on no car, or something put you far from it since (a respawn, the console)', () => {
    const c = volvo(),
      hold = held(c),
      far = you(500, 0);
    c.x = 3;
    carry(far, hold);
    expect([far.x, far.z]).toEqual([500, 0]);
    holdCar(hold, null);
    const p = you(1, 0);
    carry(p, hold);
    expect([p.x, p.z]).toEqual([1, 0]);
  });
});
