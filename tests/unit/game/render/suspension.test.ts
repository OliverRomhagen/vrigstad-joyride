import { describe, expect, it } from 'vitest';
import { type BodyForces, restingBody, stepBody } from '../../../../src/game/render/suspension';
import { type CarType, VEHICLE_SPECS } from '../../../../src/game/sim/vehicle-spec';

const run = (forces: BodyForces, seconds: number, type: CarType = 'volvo', dt = 1 / 60) => {
  const state = restingBody(),
    s = VEHICLE_SPECS[type].suspension;
  for (let t = 0; t < seconds; t += dt) stepBody(state, forces, s, dt);
  return state;
};

describe('stepBody', () => {
  it('rests level with no forces', () => {
    expect(run({ lateral: 0, longitudinal: 0, vertical: 0 }, 2)).toEqual(restingBody());
  });
  it('settles at the static roll and pitch the forces ask for', () => {
    const s = VEHICLE_SPECS.volvo.suspension,
      b = run({ lateral: 5, longitudinal: -10, vertical: 0 }, 6);
    expect(b.roll).toBeCloseTo(s.maxRollRad * Math.tanh((5 * s.rollPerAcc) / s.maxRollRad), 4);
    expect(b.pitch).toBeCloseTo(s.maxPitchRad * Math.tanh((-10 * s.pitchPerAcc) / s.maxPitchRad), 4);
    expect(b.roll).toBeGreaterThan(0); // turning right leans the roof left (+z)
    expect(b.pitch).toBeLessThan(0); // braking dips the nose
  });
  it('never passes the soft limit however hard the force', () => {
    for (const type of Object.keys(VEHICLE_SPECS) as CarType[]) {
      const s = VEHICLE_SPECS[type].suspension,
        b = run({ lateral: 400, longitudinal: 400, vertical: 400 }, 3, type);
      expect(Math.abs(b.roll)).toBeLessThanOrEqual(s.maxRollRad * 1.5);
      expect(Math.abs(b.pitch)).toBeLessThanOrEqual(s.maxPitchRad * 1.5);
      expect(Math.abs(b.heave)).toBeLessThanOrEqual(s.maxHeaveM * 1.5);
    }
  });
  it('comes back to rest after a jolt, and the tractor rocks longer than the police car', () => {
    const settle = (type: CarType) => {
      const s = VEHICLE_SPECS[type].suspension,
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
