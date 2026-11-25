import { describe, expect, it } from 'vitest';
import {
  bodyRadius,
  type CarBody,
  nearestBetweenSpines,
  nearestOnSpine,
  pushBodyOut,
  spineHalf,
} from '../../../../src/game/sim/car-body';
import { BuildingIndex } from '../../../../src/world/buildings';
import { BuildingKind } from '../../../../src/world/data';
import { makeWorld, square } from '../../world/fixture';

// a 4.8 × 1.8 m car: its spine runs 1.5 m either way of its centre, and its body reaches 0.9 m out from it.
// h = 0 points it north (-z), h = π/2 east (+x), as the game's cars.
const car = (x: number, z: number, h: number): CarBody => ({ x, z, h, T: { lengthM: 4.8, widthM: 1.8 } });
const p = () => ({ x: 0, z: 0 });
const gap = (a: CarBody, b: CarBody) => {
  const pa = p(),
    pb = p();
  nearestBetweenSpines(a, b, pa, pb);
  return Math.hypot(pa.x - pb.x, pa.z - pb.z) - bodyRadius(a) - bodyRadius(b); // < 0: the bodies overlap
};

describe('the car body', () => {
  it('is a spine along the car, as long as the car less its rounded ends', () => {
    expect(spineHalf(car(0, 0, 0))).toBeCloseTo(1.5);
    expect(bodyRadius(car(0, 0, 0))).toBeCloseTo(0.9);
    expect(nearestOnSpine(car(0, 0, 0), 5, -10, p())).toEqual({ x: 0, z: -1.5 }); // past the nose: the spine's front end
    const east = nearestOnSpine(car(0, 0, Math.PI / 2), 1, 3, p());
    expect(east.x).toBeCloseTo(1);
    expect(east.z).toBeCloseTo(0);
  });

  it('touches another nose to nose at their lengths, and side by side at their widths', () => {
    // a circle of 1.35 m each, as before, overlapped nose to nose by 2 m and kept side by side 0.9 m apart
    expect(gap(car(0, 0, 0), car(0, -4.8, 0))).toBeCloseTo(0);
    expect(gap(car(0, 0, 0), car(0, -4.7, Math.PI))).toBeCloseTo(-0.1);
    expect(gap(car(0, 0, 0), car(1.8, 0, 0))).toBeCloseTo(0);
    expect(gap(car(0, 0, 0), car(2, 1, 0))).toBeCloseTo(0.2);
  });

  it('touches another crossing it, at the nearest points of the two spines', () => {
    // a T: the second car's nose (spine end at x = -1.5 - 0.9) meets the first car's side (0.9 from its spine)
    expect(gap(car(0, 0, 0), car(3.3, 0, Math.PI / 2))).toBeCloseTo(0);
    expect(gap(car(0, 0, 0), car(3.3, 0, -Math.PI / 2))).toBeCloseTo(0);
    expect(gap(car(0, 0, 0), car(0, 0, Math.PI / 2))).toBeCloseTo(-1.8); // crossed at the centres
  });

  it('is pushed out of a building at its nose and its side, not as a circle', () => {
    // a house whose south wall is at z = -10
    const buildings = new BuildingIndex(makeWorld({ b: [{ p: square(-10, -30, 20), h: 5, k: BuildingKind.OTHER }] }));
    const collide = buildings.collide.bind(buildings);
    const nose = car(0, -7.7, 0); // heading north, its nose (2.4 m ahead) 0.1 m into the wall
    expect(pushBodyOut(nose, collide)).toBe(true);
    expect(nose.z - 2.4).toBeCloseTo(-10, 1); // the nose stops at the wall
    const side = car(0, -9.5, Math.PI / 2); // heading east along the wall, its side 0.4 m into it
    expect(pushBodyOut(side, collide)).toBe(true);
    expect(side.z - 0.9).toBeCloseTo(-10, 1);
    const clear = car(0, -8, Math.PI / 2); // along the wall, 1.1 m off it
    expect(pushBodyOut(clear, collide)).toBe(false);
    expect(clear).toMatchObject({ x: 0, z: -8 });
  });
});
