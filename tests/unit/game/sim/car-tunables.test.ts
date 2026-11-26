import { afterEach, describe, expect, it } from 'vitest';
import { DRIVING } from '../../../../src/game/cars';
import { registerCarTunables } from '../../../../src/game/sim/car-tunables';
import { STEERING, yawRate } from '../../../../src/game/sim/handling';
import { Tunables } from '../../../../src/game/sim/tunables';
import { specFor, specsOfType, VEHICLE_SPECS } from '../../../../src/game/sim/vehicle-spec';

// the numbers live in module-level objects the game shares, so every test puts them back
const t = new Tunables();
registerCarTunables(t);
afterEach(() => t.reset());

describe('registerCarTunables', () => {
  it('registers the driving model, the steering and every car type, with the values the game has', () => {
    const keys = t.keys();
    expect(keys.filter(k => k.startsWith('driving.'))).toHaveLength(Object.keys(DRIVING).length);
    expect(keys.filter(k => k.startsWith('steering.'))).toEqual(['steering.lock-fade-speed', 'steering.max-lock']);
    for (const type of Object.keys(VEHICLE_SPECS))
      expect(keys.filter(k => k.startsWith(`vehicle.${type}.`))).toHaveLength(5);
    expect(t.get('driving.grip')).toBe(DRIVING.GRIP);
    expect(t.get('vehicle.volvo.top-speed')).toBe(VEHICLE_SPECS.volvo.max);
    expect(t.get('vehicle.saab.steer-response')).toBe(VEHICLE_SPECS.saab.handling.steerResponseS);
  });

  it('runs a rule with an overridden value: more steering lock turns the car faster', () => {
    const before = yawRate(10, 1, 2.8);
    t.override('steering.max-lock:0.8');
    expect(STEERING.MAX_LOCK_RAD).toBe(0.8);
    expect(yawRate(10, 1, 2.8)).toBeGreaterThan(before);
    t.reset('steering.max-lock');
    expect(yawRate(10, 1, 2.8)).toBe(before);
  });

  it('changes every car of a type, whichever model it wears and whenever it was made', () => {
    const early = specFor('volvo', { wheelbase: 2.6 });
    t.set('vehicle.volvo.top-speed', 45);
    const late = specFor('volvo', { wheelbase: 2.7 });
    expect([VEHICLE_SPECS.volvo.max, early.max, late.max]).toEqual([45, 45, 45]);
    expect(VEHICLE_SPECS.saab.max).not.toBe(45);
    t.reset();
    expect(specsOfType('volvo').map(s => s.max)).toEqual(specsOfType('volvo').map(() => 38));
  });

  it("tunes a response time over a model's own, and gives the model its own back on reset", () => {
    const own = { handling: { steerResponseS: 0.2 } };
    const before = specFor('epa', own);
    t.set('vehicle.epa.steer-response', 0.05);
    expect(before.handling.steerResponseS).toBe(0.05);
    expect(VEHICLE_SPECS.epa.handling.steerResponseS).toBe(0.05);
    t.reset('vehicle.epa.steer-response');
    expect(before.handling.steerResponseS).toBe(0.2);
    expect(VEHICLE_SPECS.epa.handling.steerResponseS).toBe(0.16);
  });

  it("sets a response time to the type's default over a model's own, as a slider dragged back to it does", () => {
    const own = specFor('saab', { handling: { steerResponseS: 0.14 } });
    t.set('vehicle.saab.steer-response', VEHICLE_SPECS.saab.handling.steerResponseS);
    expect(own.handling.steerResponseS).toBe(VEHICLE_SPECS.saab.handling.steerResponseS);
    t.reset('vehicle.saab.steer-response');
    expect(own.handling.steerResponseS).toBe(0.14);
  });

  it('gives a copy made after the tune the tuned response, and its own value back on reset (as ?tune= does at load)', () => {
    t.override('vehicle.traktor.steer-response:0.05');
    const own = specFor('traktor', { handling: { steerResponseS: 0.3 } }),
      plain = specFor('traktor', { wheelbase: 2.3 });
    expect([own.handling.steerResponseS, plain.handling.steerResponseS]).toEqual([0.05, 0.05]);
    t.reset();
    expect([own.handling.steerResponseS, plain.handling.steerResponseS]).toEqual([0.3, 0.26]);
  });

  it('shows what a key is, without a way to set it past its range', () => {
    expect(t.entry('vehicle.volvo.top-speed')).toEqual({
      key: 'vehicle.volvo.top-speed',
      unit: 'm/s',
      min: 1,
      max: 80,
      help: 'top speed on a road',
      defaultValue: 38,
    });
  });
});

describe('specFor', () => {
  it('makes one spec per type and model, so cars that share both share it', () => {
    const model = { rearAxle: 1.1 };
    expect(specFor('traktor', model)).toBe(specFor('traktor', model));
    expect(specFor('traktor', model)).not.toBe(specFor('polis', model));
  });
});
