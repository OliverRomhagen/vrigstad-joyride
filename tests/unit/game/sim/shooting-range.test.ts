import RAPIER from '@dimforge/rapier3d-compat';
import { afterEach, beforeAll, describe, expect, it } from 'vitest';
import { registerPhysicsTunables } from '../../../../src/game/sim/physics-tunables';
import { PHYSICS_STEP_S, PhysicsWorld, type PropPose } from '../../../../src/game/sim/physics-world';
import {
  BANK,
  PAVILION,
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
  ShotStep,
  type ShotWorld,
  stepShot,
  WEAPONS,
  WeaponId,
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
    expect(xs[xs.length - 1] - xs[0]).toBeCloseTo(24, 6); // seven lanes, 4 m apart, about the firing line's middle
    expect((xs[0] + xs[xs.length - 1]) / 2).toBeCloseTo(RANGE_X, 6);
    expect(BANK.z - BANK.depthM / 2).toBeGreaterThan(RANGE_Z + Math.max(...TARGET_DISTANCES_M));
    expect(BANK.widthM / 2).toBeGreaterThan(xs[xs.length - 1] - RANGE_X);
  });

  it('leaves every board in sight of every lane’s spot on the firing line, past the boards in front of it', () => {
    const targets = rangeTargets();
    for (const from of targets) // standing in a lane, on the firing line
      for (const far of targets)
        for (const near of targets) {
          if (near.distanceM >= far.distanceM || near === from) continue;
          // where the line from the shooter to the far board crosses the near board's distance, beside the near board
          const x = from.x + ((far.x - from.x) * near.distanceM) / far.distanceM;
          expect(Math.abs(x - near.x)).toBeGreaterThan(TARGET.boardM);
        }
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
    w.follow([], { x, z: z - 5 }, { x, z: z - 5 }); // in front of it
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

  it('keeps a knocked target down while the player stands on its stand, and stands it up once they leave', () => {
    t.set('physics.target-reset-time', 1);
    const w = rangeWorld(),
      i = 1,
      { x, z } = rangeTargets()[i];
    w.follow([], { x, z }, { x, z }); // right where it stands
    w.knockProp(i, x, ground + TARGET.heightM - 0.3, z, 0, 0, 20);
    for (let k = 0; k < 180; k++) w.step(PHYSICS_STEP_S);
    expect(w.isLoose(i)).toBe(true);
    w.follow([], { x: x + 10, z }, { x: x + 10, z });
    for (let k = 0; k < 90; k++) w.step(PHYSICS_STEP_S);
    expect(w.isLoose(i)).toBe(false);
    w.dispose();
  });

  it('lets a shot from the firing line knock a target, and stops one that misses at the bank', () => {
    const w = rangeWorld();
    const world: ShotWorld = { groundAt, collide: () => false, people: [], cars: [] };
    world.cast = physicsCast(w, world, () => null);
    const weapon = WEAPONS.findIndex(x => x.id === WeaponId.PICKADOLL);
    const fire = (x: number, pitch: number) => fireFrom(x, RANGE_Z, pitch, Math.PI); // south
    const fireFrom = (x: number, z: number, pitch: number, yaw: number) => {
      const s: Shot = {
        x,
        y: ground + MUZZLE_M,
        z,
        ...aimShot(WEAPONS[weapon], yaw, pitch),
        ageS: 0,
        weapon,
        bounced: 0,
        lifeS: 0,
        lying: false,
      };
      const out = newHit();
      for (let k = 0; k < 600; k++) {
        const step = stepShot(s, 1 / 60, world, out);
        if (step === ShotStep.GONE) throw new Error('out of range');
        if (step === ShotStep.HIT) return out;
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
    // from behind the pavilion, at its back wall
    const shed = fireFrom(PAVILION.x, PAVILION.z - 6, 0, Math.PI);
    expect(shed.kind).toBe('wall');
    expect(shed.z).toBeCloseTo(PAVILION.z - PAVILION.depthM / 2 - PAVILION.wallM / 2, 1);
    w.dispose();
  });
});
