import { describe, expect, it } from 'vitest';
import {
  HEAD,
  HIT_MIN_MS,
  knockOver,
  L_FOOT,
  L_HIP,
  L_SHOULDER,
  POINTS,
  pointGap,
  R_HIP,
  R_SHOULDER,
  RAGDOLL_STICKS,
  type Ragdoll,
  type RagdollWorld,
  ragdollCentre,
  STEP_S,
  standingPose,
  stepRagdoll,
} from '../../../../src/game/sim/ragdoll';
import { makeRnd } from '../../../../src/world/random';

// Flat ground at y = 0 and no houses, unless a test adds a wall.
const flat: RagdollWorld = { groundAt: () => 0, collide: () => false };
// A car at the origin driving north (towards -z) at v m/s; the person stands just in front of it, facing it.
const car = (v: number) => ({ x: 0, z: 0, v, vh: 0 });
const person = { x: 0, z: -2, h: Math.PI };

function run(r: Ragdoll, seconds: number, world = flat) {
  for (let t = 0; t < seconds; t += STEP_S) stepRagdoll(r, world);
}
function minY(r: Ragdoll) {
  let y = Infinity;
  for (let i = 0; i < POINTS; i++) y = Math.min(y, r.pos[i * 3 + 1]);
  return y;
}

describe('standingPose', () => {
  it('stands on the ground at the given spot, head up, facing h', () => {
    const p = standingPose(5, 7, 0, 2);
    expect(p[HEAD * 3]).toBeCloseTo(5);
    expect(p[HEAD * 3 + 1]).toBeCloseTo(3.62);
    expect(p[HEAD * 3 + 2]).toBeCloseTo(7);
    expect(p[L_FOOT * 3 + 1]).toBeCloseTo(2.02);
    // facing h = 0 (north, -z): their left is west
    expect(p[L_FOOT * 3]).toBeLessThan(5);
  });
});

describe('knockOver', () => {
  it('only pushes aside below the hit speed', () => {
    expect(knockOver(person, car(HIT_MIN_MS - 0.1), flat, () => 0.5)).toBeNull();
    expect(knockOver(person, car(HIT_MIN_MS + 0.1), flat, () => 0.5)).not.toBeNull();
  });

  it('misses someone beside or behind the car, who is only pushed aside', () => {
    // 1.6 m to the side of a car about 1.8 m wide: inside the crowd's 2.3 m push circle, but clear of the bumper
    expect(knockOver({ x: 1.6, z: -1, h: 0 }, car(12), flat, () => 0.5)).toBeNull();
    expect(knockOver({ x: 0.5, z: 1, h: 0 }, car(12), flat, () => 0.5)).toBeNull();
    expect(knockOver({ x: 1, z: -2, h: 0 }, car(12), flat, () => 0.5)).not.toBeNull();
  });

  it('is as big as the pedestrian it replaces', () => {
    const r = knockOver(person, car(12), flat, () => 0.5, 0.9) as Ragdoll;
    expect(r.pos[HEAD * 3 + 1]).toBeCloseTo(1.62 * 0.9);
    run(r, 12);
    expect(r.state).toBe('done');
    expect(r.pos[HEAD * 3 + 1]).toBeCloseTo(1.62 * 0.9);
  });

  it('counts speed in reverse too, and throws them the way the car moves', () => {
    const r = knockOver({ x: 0, z: 2, h: 0 }, car(-8), flat, () => 0.5) as Ragdoll;
    run(r, 0.5);
    expect(ragdollCentre(r).z).toBeGreaterThan(2.5);
  });
});

describe('stepRagdoll', () => {
  it('throws them forward and up, then they land and lie still', () => {
    const r = knockOver(person, car(12), flat, () => 0.5) as Ragdoll;
    run(r, 0.25);
    expect(ragdollCentre(r).z).toBeLessThan(-3);
    expect(minY(r)).toBeGreaterThan(0.1);
    run(r, 3);
    expect(r.state).toBe('lie');
    // lying down, not standing: the head is near the ground
    expect(r.pos[HEAD * 3 + 1]).toBeLessThan(0.6);
  });

  it('a faster car throws them further', () => {
    const slow = knockOver(person, car(6), flat, () => 0.5) as Ragdoll,
      fast = knockOver(person, car(16), flat, () => 0.5) as Ragdoll;
    run(slow, 3);
    run(fast, 3);
    expect(ragdollCentre(fast).z).toBeLessThan(ragdollCentre(slow).z - 3);
  });

  it('keeps every stick near its length and every point above the ground, however wild the throw', () => {
    // facing the car, and turned 45° to it: a spin turns them either way, rather than squeezing their shoulders
    for (const [roll, h] of [
      [0, Math.PI],
      [0.9, Math.PI],
      [1, Math.PI],
      [1, Math.PI / 4],
      [0, Math.PI / 4],
    ]) {
      const r = knockOver({ ...person, h }, car(20), flat, () => roll) as Ragdoll;
      for (let t = 0; t < 4; t += STEP_S) {
        stepRagdoll(r, flat);
        expect(minY(r)).toBeGreaterThanOrEqual(0.1 - 1e-6);
        for (const s of RAGDOLL_STICKS) expect(Math.abs(pointGap(r, s.a, s.b) - s.length)).toBeLessThan(0.15);
      }
    }
  });

  it('spins them as one body, whichever way they faced: the throw squeezes neither the shoulders nor the hips', () => {
    // the two ends of each pair are at the same height, so only a turn (and not the flip, which throws the feet faster
    // than the head) can move one along the line to the other
    for (const h of [Math.PI, Math.PI / 4, Math.PI / 2, 0.3]) {
      const r = knockOver({ ...person, h }, car(14), flat, () => 1) as Ragdoll;
      for (const [a, b] of [
        [L_SHOULDER * 3, R_SHOULDER * 3],
        [L_HIP * 3, R_HIP * 3],
      ]) {
        let apart = 0; // how fast the two move apart, times their gap: the points' speeds are pos - prev over one step
        for (let k = 0; k < 3; k++)
          apart += (r.pos[b + k] - r.pos[a + k]) * (r.pos[b + k] - r.prev[b + k] - (r.pos[a + k] - r.prev[a + k]));
        expect(Math.abs(apart / STEP_S)).toBeLessThan(0.01);
      }
    }
  });

  it('throws each one differently: the rolls turn them and change how they fly', () => {
    // the shoulders' line seen from above, 0.3 s in: a spin turns it, where the average throw keeps it square to the car
    const shoulders = (roll: () => number) => {
      const r = knockOver(person, car(14), flat, roll) as Ragdoll;
      run(r, 0.3);
      const dx = r.pos[R_SHOULDER * 3] - r.pos[L_SHOULDER * 3],
        dz = r.pos[R_SHOULDER * 3 + 2] - r.pos[L_SHOULDER * 3 + 2];
      return { turn: Math.atan2(dz, -dx), headY: r.pos[HEAD * 3 + 1] };
    };
    const average = shoulders(() => 0.5);
    expect(average.turn).toBeCloseTo(0, 1); // facing the car, their right is west: square to it
    const turns = [1, 2, 3, 4, 5].map(seed => shoulders(makeRnd(seed)).turn);
    expect(Math.max(...turns) - Math.min(...turns)).toBeGreaterThan(0.3);
    expect(shoulders(() => 1).headY).not.toBeCloseTo(shoulders(() => 0).headY, 1);
  });

  it('gets back up where they landed and is done', () => {
    const r = knockOver(person, car(10), flat, () => 0.2) as Ragdoll;
    run(r, 12);
    expect(r.state).toBe('done');
    const { x, z } = ragdollCentre(r),
      stand = standingPose(x, z, r.h, 0);
    for (let i = 0; i < POINTS * 3; i++) expect(r.pos[i]).toBeCloseTo(stand[i], 5);
  });

  it('stops at a house wall', () => {
    // a wall along z = -4: nothing gets past it
    const wall: RagdollWorld = {
      groundAt: () => 0,
      collide: o => {
        if (o.z > -4 + 0.1) return false;
        o.z = -4 + 0.1;
        return true;
      },
    };
    const r = knockOver(person, car(18), wall, () => 0.5) as Ragdoll;
    for (let t = 0; t < 3; t += STEP_S) {
      stepRagdoll(r, wall);
      for (let i = 0; i < POINTS; i++) expect(r.pos[i * 3 + 2]).toBeGreaterThan(-4.05);
    }
  });

  it('a car drives the lying body ahead of it', () => {
    const r = knockOver(person, car(6), flat, () => 0.5) as Ragdoll;
    run(r, 3);
    const before = ragdollCentre(r);
    // drive through from the south at 5 m/s: the car's circle sweeps over the body
    for (let z = before.z + 3, t = 0; t < 1.2; t += STEP_S, z -= 5 * STEP_S)
      stepRagdoll(r, flat, [{ x: before.x, z, r: 1.6 }]);
    expect(ragdollCentre(r).z).toBeLessThan(before.z - 1.5);
  });

  it('a car landing on the body moves it out without firing it off', () => {
    const r = knockOver(person, car(6), flat, () => 0.5) as Ragdoll;
    run(r, 3);
    const c = ragdollCentre(r);
    // the car's circle appears right on top of the body and stays there: it would move points up to 1.6 m at once
    let fastest = 0;
    for (let s = 0; s < 30; s++) {
      stepRagdoll(r, flat, [{ x: c.x, z: c.z + 0.3, r: 1.6 }]);
      for (let i = 0; i < POINTS * 3; i += 3)
        fastest = Math.max(fastest, Math.hypot(r.pos[i] - r.prev[i], r.pos[i + 2] - r.prev[i + 2]) / STEP_S);
    }
    expect(fastest).toBeLessThan(15);
  });

  it("doesn't get up while the car is still shoving them", () => {
    const r = knockOver(person, car(6), flat, () => 0.5) as Ragdoll;
    run(r, 3);
    const c = ragdollCentre(r);
    // the car creeps into the body at 1 m/s for longer than they'd lie
    for (let t = 0, z = c.z + 1.6; t < 4; t += STEP_S, z -= STEP_S) stepRagdoll(r, flat, [{ x: c.x, z, r: 1.6 }]);
    expect(r.state).toBe('lie');
    run(r, 5);
    expect(r.state).toBe('done');
  });

  it('is deterministic: the same stream throws the same way', () => {
    const a = knockOver(person, car(14), flat, makeRnd(7)) as Ragdoll,
      b = knockOver(person, car(14), flat, makeRnd(7)) as Ragdoll;
    run(a, 2);
    run(b, 2);
    expect(a.pos).toEqual(b.pos);
  });
});
