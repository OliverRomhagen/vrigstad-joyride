import RAPIER from '@dimforge/rapier3d-compat';
import { afterEach, beforeAll, describe, expect, it } from 'vitest';
import { registerPhysicsTunables } from '../../../../src/game/sim/physics-tunables';
import { newSegmentHit, PHYSICS_STEP_S, PhysicsWorld, type PropPose } from '../../../../src/game/sim/physics-world';
import {
  BANK,
  FIRING_LINE_HALF_M,
  LANE_M,
  MOOSE,
  MOVERS,
  MOVING_TARGETS,
  MoverKind,
  type MoverPose,
  moverPose,
  moverSpecs,
  PAVILION,
  RANGE_X,
  RANGE_Z,
  rangeBlocks,
  rangeTargets,
  SLIDER_HEIGHT_M,
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

describe('the moving targets', () => {
  const at = (m: (typeof MOVING_TARGETS)[number], tS: number) => moverPose(m, tS, { x: 0, z: 0, rotationY: 0 });
  const moose = MOVERS.RUNNING_MOOSE;
  // the moose's round: 17 m east at 4 m/s, 1.5 s stopped, back, 1.5 s stopped
  const runS = (moose.toM - moose.fromM) / moose.speedMps,
    roundS = 2 * (runS + moose.pauseS);

  it('runs the moose east along its rail, turns about while it stops at the end, and runs back', () => {
    expect(roundS).toBeCloseTo(10.25, 6); // 14.5 m each way at 4 m/s, and two stops of 1.5 s
    const start = at(moose, 0);
    expect(start).toEqual({ x: RANGE_X + moose.fromM, z: RANGE_Z + 80, rotationY: 0 });
    expect(at(moose, 1).x).toBeCloseTo(RANGE_X + moose.fromM + 4, 6);
    expect(at(moose, runS).x).toBeCloseTo(RANGE_X + moose.toM, 6); // at the east end,
    const stopped = at(moose, runS + moose.pauseS / 2);
    expect(stopped.x).toBeCloseTo(RANGE_X + moose.toM, 6); // stopped,
    expect(stopped.rotationY).toBeCloseTo(Math.PI / 2, 6); // halfway round, facing the firing line
    const back = at(moose, runS + moose.pauseS + 1);
    expect(back.x).toBeCloseTo(RANGE_X + moose.toM - 4, 6); // running back
    expect(back.rotationY).toBeCloseTo(Math.PI, 6); // facing west
    const west = at(moose, roundS - moose.pauseS / 2); // stopped at the west end, turning on the same way round
    expect(west.x).toBeCloseTo(RANGE_X + moose.fromM, 6);
    expect(west.rotationY).toBeCloseTo(1.5 * Math.PI, 6);
    expect(at(moose, roundS).x).toBeCloseTo(start.x, 6); // and round again
    expect(at(moose, -1).x).toBeCloseTo(at(moose, roundS - 1).x, 6); // before 0 too
  });

  it('keeps every mover on its rail and never faster than its speed', () => {
    for (const m of MOVING_TARGETS) {
      let last = at(m, 0).x,
        lastTurn = at(m, 0).rotationY;
      for (let tS = 0.1; tS < 60; tS += 0.1) {
        const { x, z, rotationY } = at(m, tS);
        // it turns no faster than half a turn over its stop, the short way round
        const turn = Math.atan2(Math.sin(rotationY - lastTurn), Math.cos(rotationY - lastTurn));
        expect(Math.abs(turn)).toBeLessThanOrEqual((Math.PI / m.pauseS) * 0.1 + 1e-9);
        if (!m.turns) expect(rotationY).toBe(0);
        lastTurn = rotationY;
        expect(z).toBe(RANGE_Z + m.distanceM);
        expect(x).toBeGreaterThanOrEqual(RANGE_X + m.fromM - 1e-9);
        expect(x).toBeLessThanOrEqual(RANGE_X + m.toM + 1e-9);
        expect(Math.abs(x - last)).toBeLessThanOrEqual(m.speedMps * 0.1 + 1e-9);
        last = x;
      }
    }
    // they turn at different times
    const turns = MOVING_TARGETS.map(m => m.startS);
    expect(new Set(turns).size).toBe(turns.length);
  });

  it('never lets the moose hide a standing board from anywhere on the firing line, the pavilion included', () => {
    const targets = rangeTargets(),
      [west, east] = reach(moose),
      // from inside the pavilion's west wall to the painted line's east end, every 10 cm
      x0 = PAVILION.x - PAVILION.widthM / 2 + PAVILION.wallM,
      x1 = RANGE_X + FIRING_LINE_HALF_M;
    expect(FIRING_LINE_HALF_M).toBe(((TARGET_DISTANCES_M.length - 1) / 2) * LANE_M + 1); // a metre past the outer lanes
    for (let fromX = x0; fromX <= x1; fromX += 0.1)
      for (const far of targets) {
        if (far.distanceM <= moose.distanceM) continue; // in front of the moose: it can't hide that
        // where the line from the shooter to the far board's middle crosses the moose's rail, past the moose's nose or
        // tail by more than half the board
        const x = fromX + ((far.x - fromX) * moose.distanceM) / far.distanceM - RANGE_X;
        expect(x + TARGET.boardM / 2 < west || x - TARGET.boardM / 2 > east, `from ${fromX.toFixed(1)}`).toBe(true);
      }
  });

  it('keeps the sliders below every line from a muzzle to a standing board', () => {
    // a line from above the board's bottom edge to a point on the board stays above that edge all the way: the sliders,
    // below it, are under every line, wherever they are
    expect(SLIDER_HEIGHT_M).toBeLessThan(TARGET.heightM - TARGET.boardM);
    expect(MUZZLE_M).toBeGreaterThan(TARGET.heightM - TARGET.boardM);
  });

  it('runs every mover clear of the standing targets, with the bank behind it from the lanes in front of it', () => {
    const targets = rangeTargets();
    for (const m of MOVING_TARGETS) {
      const z = RANGE_Z + m.distanceM,
        [west, east] = reach(m);
      for (const s of targets) {
        if (Math.abs(s.z - z) > 1.5) continue;
        expect(s.x - RANGE_X < west - 1 || s.x - RANGE_X > east + 1).toBe(true);
      }
      // a shot from a lane whose spot is in front of the track, at either end of it, meets the bank's front
      const front = BANK.z - BANK.depthM / 2 - RANGE_Z;
      for (const from of targets) {
        const dx = from.x - RANGE_X;
        if (dx < west - LANE_HALF_M || dx > east + LANE_HALF_M) continue;
        for (const end of [west, east]) {
          const x = dx + ((end - dx) * front) / m.distanceM;
          expect(Math.abs(x - (BANK.x - RANGE_X)), `${m.kind} at ${m.distanceM} m, from ${dx}`).toBeLessThan(
            BANK.widthM / 2,
          );
        }
      }
    }
  });

  it('holds the movers in the world with the targets, and a shot knocks the moose where it has run to', () => {
    const props = [...targetSpecs(groundAt), ...moverSpecs(groundAt)],
      w = new PhysicsWorld(RAPIER, { data: makeWorld({}), heightfield: field, props, blocks: rangeBlocks(groundAt) }),
      first = TARGET_DISTANCES_M.length, // the moose's index
      mp: MoverPose = { x: 0, z: 0, rotationY: 0 };
    expect(w.joined).toHaveLength(first + MOVING_TARGETS.length);
    let tS = 0;
    for (let k = 0; k < 120; k++) {
      tS += PHYSICS_STEP_S;
      MOVING_TARGETS.forEach((m, n) => {
        moverPose(m, tS, mp);
        w.moveStanding(first + n, mp.x, ground, mp.z, mp.rotationY);
      });
      w.step(PHYSICS_STEP_S);
    }
    const x = RANGE_X + moose.fromM + 2 * moose.speedMps, // 8 m along after 2 s
      p = w.propPose(first, pose());
    expect(p.x).toBeCloseTo(x, 4);
    // a line from the firing line meets the moose's body where it has run to, beside its post
    const hit = newSegmentHit();
    expect(w.castSegment(x + 0.5, ground + 1.3, RANGE_Z, x + 0.5, ground + 1.3, RANGE_Z + 100, null, hit)).toBe(true);
    expect(hit.prop).toBe(first);
    w.knockProp(first, hit.x, hit.y, hit.z, 0, 0, 10);
    expect(w.isLoose(first)).toBe(true);
    w.dispose();
  });
});

/** half a lane's width: a lane's spot is in front of what is within this of it (m) */
const LANE_HALF_M = 2;

/** How far west and east of the firing line's middle mover `m` reaches, facing either way, a slider's board included (m). */
function reach(m: (typeof MOVING_TARGETS)[number]) {
  return m.kind === MoverKind.MOOSE
    ? [m.fromM - MOOSE.frontM, m.toM + MOOSE.frontM]
    : [m.fromM - TARGET.boardM / 2, m.toM + TARGET.boardM / 2];
}
