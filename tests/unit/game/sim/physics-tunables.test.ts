import RAPIER from '@dimforge/rapier3d-compat';
import { afterEach, beforeAll, describe, expect, it } from 'vitest';
import type { CarBody } from '../../../../src/game/sim/car-body';
import { PHYSICS, registerPhysicsTunables } from '../../../../src/game/sim/physics-tunables';
import { PHYSICS_STEP_S, PhysicsWorld, type PropSpec } from '../../../../src/game/sim/physics-world';
import { Tunables } from '../../../../src/game/sim/tunables';
import { makeWorld } from '../../world/fixture';

beforeAll(() => RAPIER.init());

// the numbers live in a module-level object the physics world shares, so every test puts them back
const t = new Tunables();
registerPhysicsTunables(t);
afterEach(() => t.reset());

// flat ground, sampled every 5 m over a 200 m square
const flat = {
  samples: 41,
  sampleCoord: (i: number) => -100 + i * 5,
  sampleHeight: () => 0,
  heightAt: () => 0,
};
const mailbox = (x: number, z: number): PropSpec => ({
  x,
  z,
  baseY: 0,
  rotationY: 0,
  widthM: 0.34,
  depthM: 0.2,
  heightM: 1.3,
  massKg: 12,
});
// a car heading east: the game's heading h points a car at (sin h, -cos h)
const car = (x: number, z = 0): CarBody => ({ x, z, h: Math.PI / 2, T: { lengthM: 4.8, widthM: 1.75 } });

describe('registerPhysicsTunables', () => {
  it('registers gravity and the props’ join and respawn numbers, with the values the world uses', () => {
    expect(
      t
        .keys()
        .filter(k => k.startsWith('physics.'))
        .sort(),
    ).toEqual([
      'physics.gravity',
      'physics.prop-join-distance',
      'physics.prop-respawn-distance',
      'physics.prop-respawn-time',
    ]);
    expect(t.get('physics.gravity')).toBe(9.81);
    expect(t.get('physics.prop-join-distance')).toBe(PHYSICS.PROP_JOIN_M);
  });

  it('brings props into the world from further away as soon as the join distance is raised', () => {
    const w = new PhysicsWorld(RAPIER, { data: makeWorld({}), heightfield: flat, props: [mailbox(30, 0)] }),
      c = car(0, 0);
    const nudge = () => {
      c.x += 0.5;
      w.follow([c], null, c);
    };
    nudge();
    nudge();
    expect(w.joined).toEqual([]); // 29 m away, past the 12 m it joins at
    t.set('physics.prop-join-distance', 40);
    nudge();
    expect(w.joined).toEqual([0]);
    w.dispose();
  });

  // knocks the mailbox at (10, 0) with a car at 15 m/s; the car then goes, rather than stand pressing on it
  function knocked() {
    const w = new PhysicsWorld(RAPIER, { data: makeWorld({}), heightfield: flat, props: [mailbox(10, 0)] }),
      c = car(0);
    for (let i = 0; i < 45; i++) {
      c.x += 15 * PHYSICS_STEP_S;
      w.follow([c], null, c);
      w.step(PHYSICS_STEP_S);
    }
    c.x = 500;
    w.follow([c], null, c);
    return w;
  }
  const pose = { x: 0, y: 0, z: 0, qx: 0, qy: 0, qz: 0, qw: 1 };

  it('changes how a knocked mailbox flies the moment gravity is tuned, in mid-flight', () => {
    const heightAfter = (g: number) => {
      const w = knocked();
      t.set('physics.gravity', g); // after the world was built, while the mailbox is on its way
      for (let i = 0; i < 30; i++) w.step(PHYSICS_STEP_S);
      const y = w.propPose(0, pose).y;
      w.dispose();
      t.reset();
      return y;
    };
    expect(heightAfter(0)).toBeGreaterThan(heightAfter(30));
  });

  it("wakes the knocked props when gravity changes, so one that was asleep doesn't hang where it was", () => {
    const w = knocked();
    for (let i = 0; i < 600; i++) w.step(PHYSICS_STEP_S);
    expect(w.awakeProps).toBe(0); // landed and asleep
    t.set('physics.gravity', 30);
    w.step(PHYSICS_STEP_S);
    expect(w.awakeProps).toBe(1);
    w.dispose();
  });
});
