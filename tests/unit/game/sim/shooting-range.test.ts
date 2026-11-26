import RAPIER from '@dimforge/rapier3d-compat';
import { afterEach, beforeAll, describe, expect, it } from 'vitest';
import { registerPhysicsTunables } from '../../../../src/game/sim/physics-tunables';
import { PHYSICS_STEP_S, PhysicsWorld, type PropPose } from '../../../../src/game/sim/physics-world';
import {
  BANK,
  RANGE_X,
  RANGE_Z,
  rangeBlocks,
  rangeTargets,
  TARGET,
  TARGET_DISTANCES_M,
  targetSpecs,
} from '../../../../src/game/sim/shooting-range';
import { physicsCast } from '../../../../src/game/sim/shot-physics';
import {
  aimShot,
  MUZZLE_M,
  newHit,
  type Shot,
  type ShotWorld,
  stepShot,
  WEAPONS,
} from '../../../../src/game/sim/shots';
import { Tunables } from '../../../../src/game/sim/tunables';
import { makeWorld } from '../../world/fixture';

beforeAll(() => RAPIER.init());

const t = new Tunables();
registerPhysicsTunables(t);
afterEach(() => t.reset());

// ground at 2 m everywhere, sampled every 10 m over the range's square
const ground = 2;
const field = {
  samples: 41,
  sampleCoord: (i: number) => RANGE_X - 200 + i * 10,
  sampleHeight: () => ground,
  heightAt: () => ground,
};
const groundAt = () => ground;
const pose = (): PropPose => ({ x: 0, y: 0, z: 0, qx: 0, qy: 0, qz: 0, qw: 1 });

function rangeWorld() {
  const props = targetSpecs(groundAt);
  return new PhysicsWorld(RAPIER, { data: makeWorld({}), heightfield: field, props, blocks: rangeBlocks(groundAt) });
}

describe('the shooting range', () => {
  it('stands one target in each lane, south of the firing line at its distance, and the bank behind the farthest', () => {
    const targets = rangeTargets();
    expect(targets.map(r => r.z - RANGE_Z)).toEqual([...TARGET_DISTANCES_M]);
    const xs = targets.map(r => r.x);
    expect(xs[xs.length - 1] - xs[0]).toBeCloseTo(18, 6); // seven lanes, 3 m apart, about the firing line's middle
    expect((xs[0] + xs[xs.length - 1]) / 2).toBeCloseTo(RANGE_X, 6);
    expect(BANK.z - BANK.depthM / 2).toBeGreaterThan(RANGE_Z + Math.max(...TARGET_DISTANCES_M));
    expect(BANK.widthM / 2).toBeGreaterThan(xs[xs.length - 1] - RANGE_X);
  });

  it('builds each target as a thin post with the board at its top, standing on the ground', () => {
    for (const s of targetSpecs(groundAt)) {
      expect(s.baseY).toBe(ground);
      expect(s.isTarget).toBe(true);
      const board = s.parts?.[0];
      expect(board && board.y + board.hy).toBeCloseTo(TARGET.heightM / 2, 6); // its top is the target's
      expect(board && board.hx * 2).toBeCloseTo(TARGET.boardM, 6);
    }
  });

  it('holds the targets in the world from the start, with no car or player near', () => {
    const w = rangeWorld();
    expect(w.joined).toHaveLength(TARGET_DISTANCES_M.length);
    w.dispose();
  });

  it('stands a knocked target up again after the reset time, with the player beside it', () => {
    t.set('physics.target-reset-time', 2);
    const w = rangeWorld(),
      i = 1, // the 10 m target
      { x, z } = rangeTargets()[i],
      p = pose();
    w.follow([], { x, z: z - 1 }, { x, z: z - 1 });
    w.knockProp(i, x, ground + TARGET.heightM - 0.3, z, 0, 0, 20);
    for (let k = 0; k < 60; k++) w.step(PHYSICS_STEP_S);
    expect(w.isLoose(i)).toBe(true);
    expect(w.propPose(i, p).y).toBeLessThan(ground + 0.5); // lying on the ground
    for (let k = 0; k < 120; k++) w.step(PHYSICS_STEP_S);
    expect(w.isLoose(i)).toBe(false);
    expect(w.propPose(i, p).y).toBeCloseTo(ground + TARGET.heightM / 2, 6);
    expect(w.propPose(i, p).z).toBeCloseTo(z, 6);
    w.dispose();
  });

  it('lets a shot from the firing line knock a target, and stops one that misses at the bank', () => {
    const w = rangeWorld();
    const world: ShotWorld = { groundAt, collide: () => false, people: [], cars: [] };
    world.cast = physicsCast(w, world, () => null);
    const weapon = WEAPONS.findIndex(x => x.id === 'pickadoll');
    const fire = (x: number, pitch: number) => {
      const s: Shot = {
        x,
        y: ground + MUZZLE_M,
        z: RANGE_Z,
        ...aimShot(WEAPONS[weapon], Math.PI, pitch), // south
        ageS: 0,
        weapon,
        bounced: 0,
        lifeS: 0,
        lying: false,
      };
      const out = newHit();
      for (let k = 0; k < 600; k++) {
        const hit = stepShot(s, 1 / 60, world, out);
        if (hit === 'gone') throw new Error('out of range');
        if (hit) return hit;
      }
      throw new Error('still flying');
    };
    const ten = rangeTargets()[1];
    const atTarget = fire(ten.x, 0.02); // a little up: the board is above the muzzle
    expect(atTarget.kind).toBe('prop');
    expect(atTarget.target).toBe(1);
    // between two lanes, high enough to clear the ground, low enough for the bank
    const pastAll = fire(RANGE_X + 1.5, 0.1); // it drops about 11 m over the 100 m
    expect(pastAll.kind).toBe('wall');
    expect(pastAll.z).toBeCloseTo(BANK.z - BANK.depthM / 2, 1);
    w.dispose();
  });
});
