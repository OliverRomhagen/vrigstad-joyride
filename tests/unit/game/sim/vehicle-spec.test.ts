import { describe, expect, it } from 'vitest';
import { vehicleDefinition } from '../../../../src/game/render/vehicle-registry';
import { type CarType, specFor, VEHICLE_SPECS } from '../../../../src/game/sim/vehicle-spec';

describe('specFor', () => {
  it('returns the type as it is when the model changes nothing', () => {
    expect(specFor('traktor')).toBe(VEHICLE_SPECS.traktor);
    expect(specFor('volvo', {})).toBe(VEHICLE_SPECS.volvo);
  });
  it('takes the model’s wheelbase and layers its ride on the type', () => {
    const impala = specFor('volvo', vehicleDefinition('impala1970'));
    expect(impala.handling).toEqual({ ...VEHICLE_SPECS.volvo.handling, wheelbaseM: 3.0226 });
    expect(impala.suspension.freqHz).toBeLessThan(VEHICLE_SPECS.volvo.suspension.freqHz);
    expect(impala.suspension.maxPitchRad).toBe(VEHICLE_SPECS.volvo.suspension.maxPitchRad);
    expect(impala.max).toBe(VEHICLE_SPECS.volvo.max);
  });
  it('leaves the shared table alone', () => {
    specFor('saab', vehicleDefinition('micra-k11'));
    expect(VEHICLE_SPECS.saab.suspension.freqHz).toBe(1.6);
    expect(VEHICLE_SPECS.saab.handling.wheelbaseM).toBe(2.52);
  });
  it('throws on an unknown type instead of quietly driving like a Volvo', () => {
    expect(() => specFor('ufo' as CarType)).toThrow('unknown car type: ufo');
  });
  it('makes the tractor slower to answer than the police car', () => {
    const { traktor, polis } = VEHICLE_SPECS;
    expect(traktor.handling.steerResponseS).toBeGreaterThan(polis.handling.steerResponseS);
    expect(traktor.handling.throttleResponseS).toBeGreaterThan(polis.handling.throttleResponseS);
  });
});
