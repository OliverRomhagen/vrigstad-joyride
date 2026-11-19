import { describe, expect, it } from 'vitest';
import { hop, nearestCar, type PlayerState, standAt, stepOut, tooFastToGetOut, walk } from '../../../src/game/player';

const you = (x = 0, z = 0): PlayerState => ({ x, z, y: 0, vy: 0, h: 0, speed: 0, phase: 0 });
const car = (x: number, z: number, mode = 'parked', h = 0, v = 0) => ({ x, z, h, v, mode });
const onFoot = { run: false, wet: false, still: false };
// walks `secs` in 10 ms frames
function walkFor(p: PlayerState, secs: number, mx: number, my: number, yaw: number, o = onFoot, half = 1100) {
  for (let t = 0; t < secs - 1e-9; t += 0.01) walk(p, 0.01, mx, my, yaw, o, half);
}

describe('player', () => {
  it('reaches the closest car within 4.4 m, never a police car', () => {
    const near = car(3, 0), cars = [car(0, 1, 'police'), car(4, 0), near, car(0, 5)];
    expect(nearestCar(you(), cars)).toBe(near);
    expect(nearestCar(you(), [car(4.4, 0), car(0, 1, 'police')])).toBeNull();   // just out of reach
  });

  it('gets out only below 3 m/s, either way', () => {
    expect(tooFastToGetOut({ v: 3 })).toBe(false);
    expect(tooFastToGetOut({ v: 3.1 })).toBe(true);
    expect(tooFastToGetOut({ v: -3.1 })).toBe(true);
  });

  it('steps out 2 m to the car’s left, facing its way', () => {
    const p = you(); stepOut(p, car(10, 10, 'player', 0));   // facing north: left is west
    expect(p).toMatchObject({ x: 8, z: 10, h: 0 });
    stepOut(p, car(10, 10, 'player', Math.PI / 2));   // facing east: left is north
    expect(p.x).toBeCloseTo(10); expect(p.z).toBeCloseTo(8); expect(p.h).toBeCloseTo(Math.PI / 2);
  });

  it('walks at 4.6 m/s the way the camera faces, runs at 8 and wades at 1.6', () => {
    const p = you(); walkFor(p, 1, 0, 1, 0);   // forward with the camera facing north: z goes down
    expect(p.x).toBeCloseTo(0); expect(p.z).toBeCloseTo(-4.6); expect(p.speed).toBeCloseTo(4.6);
    const r = you(); walkFor(r, 1, 1, 0, 0, { ...onFoot, run: true });   // right, running: east
    expect(r.x).toBeCloseTo(8); expect(r.h).toBeCloseTo(Math.PI / 2);
    const w = you(); walkFor(w, 1, 0, 1, 0, { ...onFoot, wet: true, run: true });   // water slows a run too
    expect(w.z).toBeCloseTo(-1.6);
  });

  it('stands still below the dead zone, while held still, and at the map’s edge', () => {
    const p = you(); walkFor(p, 1, 0.05, 0.05, 0);
    expect(p).toMatchObject({ x: 0, z: 0, speed: 0 });
    walkFor(p, 1, 0, 1, 0, { ...onFoot, still: true });
    expect(p).toMatchObject({ x: 0, z: 0, speed: 0 });
    const e = you(0, -95); walkFor(e, 2, 0, 1, 0, onFoot, 100);
    expect(e.z).toBe(-98);
  });

  it('hops about 0.85 m and lands after 0.65 s, the same at any frame rate', () => {
    for (const dt of [1 / 30, 1 / 144]) {
      const p = you(); let top = 0, t = 0;
      hop(p, dt, true); t += dt; top = p.y;
      while (p.y > 0) { hop(p, dt, true); t += dt; top = Math.max(top, p.y); }   // holding jump in the air doesn't jump again
      expect(top).toBeCloseTo(5.2 ** 2 / (2 * 16), 1);
      expect(t).toBeCloseTo(2 * 5.2 / 16, 1);
    }
  });

  it('stands you on the ground, out of a jump', () => {
    const p = you(); hop(p, 0.1, true); standAt(p, 5, 6);
    expect(p).toMatchObject({ x: 5, z: 6, y: 0, vy: 0 });
  });
});
