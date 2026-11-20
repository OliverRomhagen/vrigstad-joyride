import { describe, expect, it } from 'vitest';
import {
  type BodyForces,
  restingBody,
  SUSPENSION,
  stepBody,
  suspensionFor,
} from '../../../../src/game/render/suspension';

const run = (forces: BodyForces, seconds: number, type = 'volvo', dt = 1 / 60) => {
  const state = restingBody(),
    s = suspensionFor(type);
  for (let t = 0; t < seconds; t += dt) stepBody(state, forces, s, dt);
  return state;
};

describe('suspensionFor', () => {
  it('layers a model override on its type', () => {
    const impala = suspensionFor('volvo', 'impala1970');
    expect(impala.freqHz).toBeLessThan(SUSPENSION.volvo.freqHz);
    expect(impala.maxPitchRad).toBe(SUSPENSION.volvo.maxPitchRad);
    expect(suspensionFor('volvo', 'volvo240')).toBe(SUSPENSION.volvo);
  });
});

describe('stepBody', () => {
  it('rests level with no forces', () => {
    expect(run({ lateral: 0, longitudinal: 0, vertical: 0 }, 2)).toEqual(restingBody());
  });
  it('settles at the static roll and pitch the forces ask for', () => {
    const s = SUSPENSION.volvo,
      b = run({ lateral: 5, longitudinal: -10, vertical: 0 }, 6);
    expect(b.roll).toBeCloseTo(s.maxRollRad * Math.tanh((5 * s.rollPerAcc) / s.maxRollRad), 4);
    expect(b.pitch).toBeCloseTo(s.maxPitchRad * Math.tanh((-10 * s.pitchPerAcc) / s.maxPitchRad), 4);
    expect(b.roll).toBeGreaterThan(0); // turning right leans the roof left (+z)
    expect(b.pitch).toBeLessThan(0); // braking dips the nose
  });
  it('never passes the soft limit however hard the force', () => {
    for (const type of Object.keys(SUSPENSION)) {
      const s = SUSPENSION[type],
        b = run({ lateral: 400, longitudinal: 400, vertical: 400 }, 3, type);
      expect(Math.abs(b.roll)).toBeLessThanOrEqual(s.maxRollRad * 1.5);
      expect(Math.abs(b.pitch)).toBeLessThanOrEqual(s.maxPitchRad * 1.5);
      expect(Math.abs(b.heave)).toBeLessThanOrEqual(s.maxHeaveM * 1.5);
    }
  });
  it('comes back to rest after a jolt, and the tractor rocks longer than the police car', () => {
    const settle = (type: string) => {
      const s = suspensionFor(type),
        b = restingBody();
      stepBody(b, { lateral: 0, longitudinal: 30, vertical: 0 }, s, 0.05);
      let last = 0;
      for (let i = 1; i < 300; i++) {
        stepBody(b, { lateral: 0, longitudinal: 0, vertical: 0 }, s, 1 / 60);
        if (Math.abs(b.pitch) > 0.002) last = i;
      }
      expect(Math.abs(b.pitch)).toBeLessThan(1e-4);
      return last;
    };
    expect(settle('traktor')).toBeGreaterThan(settle('polis'));
  });
  it('gives the same result at 30 and 120 fps', () => {
    const f = { lateral: 8, longitudinal: 4, vertical: 0 };
    const a = run(f, 0.5, 'saab', 1 / 30),
      b = run(f, 0.5, 'saab', 1 / 120);
    expect(a.roll).toBeCloseTo(b.roll, 3);
    expect(a.pitch).toBeCloseTo(b.pitch, 3);
  });
});
