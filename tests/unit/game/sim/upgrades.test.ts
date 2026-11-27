import { describe, expect, it } from 'vitest';
import { accelOf, flipLimiter, gripShare, noMods, topSpeedOf, UPGRADES } from '../../../../src/game/sim/upgrades';
import { type CarType, VEHICLE_SPECS } from '../../../../src/game/sim/vehicle-spec';

const car = (type: CarType, engine = false) => ({
  type,
  T: VEHICLE_SPECS[type],
  mods: { ...noMods(), engine },
  limiterOff: false,
});

describe('a tuned EPA-traktor', () => {
  it('does 50 km/h, and keeps up with a Volvo once its limiter is off', () => {
    const epa = car('epa', true);
    expect(topSpeedOf(car('epa'))).toBe(VEHICLE_SPECS.epa.max);
    expect(topSpeedOf(epa)).toBe(UPGRADES.EPA_TOP_MS);
    expect(flipLimiter(epa)).toContain('ingen EPA längre');
    expect(topSpeedOf(epa)).toBe(VEHICLE_SPECS.volvo.max);
    expect(accelOf(epa)).toBe(VEHICLE_SPECS.volvo.acc);
    expect(flipLimiter(epa)).toContain('Snäll EPA igen');
    expect(topSpeedOf(epa)).toBe(UPGRADES.EPA_TOP_MS);
  });

  it('is the only car with the switch', () => {
    for (const c of [car('epa'), car('volvo', true), null]) expect(flipLimiter(c)).toBeNull();
    const volvo = { ...car('volvo', true), limiterOff: true }; // a switch it hasn't got does nothing
    expect(topSpeedOf(volvo)).toBeCloseTo(VEHICLE_SPECS.volvo.max * UPGRADES.ENGINE_TOP);
    expect(accelOf(volvo)).toBeCloseTo(VEHICLE_SPECS.volvo.acc * UPGRADES.ENGINE_ACC);
  });
});

describe('sport springs', () => {
  it('grip harder', () => {
    expect(gripShare(noMods())).toBe(1);
    expect(gripShare({ ...noMods(), springs: true })).toBe(UPGRADES.SPRINGS_GRIP);
  });
});
