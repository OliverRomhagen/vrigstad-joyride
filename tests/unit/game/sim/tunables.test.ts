import { describe, expect, it } from 'vitest';
import { Tunables } from '../../../../src/game/sim/tunables';

/** A registry over one small object, built by hand so each value can be worked out. */
function world() {
  const car = { SPEED: 10, GRIP: 2 };
  const t = new Tunables();
  t.addFields('car', car, {
    SPEED: { name: 'topSpeed', unit: 'm/s', min: 1, max: 50, help: 'top speed' },
    GRIP: { name: 'grip', unit: '1/s', min: 0, max: 5, help: 'grip' },
  });
  return { car, t };
}

describe('Tunables', () => {
  it('registers fields under their names, sorted, with their current value as the default', () => {
    const { t } = world();
    expect(t.keys()).toEqual(['car.grip', 'car.topSpeed']);
    expect(t.entry('car.topSpeed')).toMatchObject({ unit: 'm/s', min: 1, max: 50, defaultValue: 10 });
    expect(t.entry('car.nope')).toBeUndefined();
  });

  it('sets the object the game reads, and resets one key or all of them', () => {
    const { car, t } = world();
    t.set('car.topSpeed', 20);
    t.set('car.grip', 4);
    expect(car.SPEED).toBe(20);
    expect(t.get('car.topSpeed')).toBe(20);
    t.reset('car.topSpeed');
    expect(car).toEqual({ SPEED: 10, GRIP: 4 });
    t.reset();
    expect(car).toEqual({ SPEED: 10, GRIP: 2 });
  });

  it('refuses an unknown key, a value that is not a number and one outside the range', () => {
    const { car, t } = world();
    expect(() => t.set('car.wings', 1)).toThrow(RangeError);
    expect(() => t.get('car.wings')).toThrow(RangeError);
    expect(() => t.set('car.grip', Number.NaN)).toThrow(RangeError);
    expect(() => t.set('car.grip', 6)).toThrow('car.grip is from 0 to 5 1/s');
    expect(car.GRIP).toBe(2);
  });

  it('refuses a key twice, a badly written key, a field that is not a number and a default outside its range', () => {
    const { t } = world();
    const spec = { unit: 'm', min: 0, max: 1, help: '' };
    const zero = () => 0,
      ignore = () => {};
    expect(() => t.add('car.grip', spec, zero, ignore)).toThrow('already registered');
    expect(() => t.add('Car grip', spec, zero, ignore)).toThrow('dotted');
    expect(() => t.add('car.far', spec, () => 2, ignore)).toThrow('outside');
    expect(() => t.addFields('x', { name: 'volvo' }, { name: { ...spec, name: 'n' } })).toThrow('not a number');
  });

  it('applies ?tune= overrides, and reports the ones it can not use while applying the rest', () => {
    const { car, t } = world();
    expect(t.override('car.topSpeed:30, car.grip:9,car.wings:1,car.grip,car.grip:x, ')).toEqual([
      'car.grip is from 0 to 5 1/s',
      'No tunable called car.wings',
      'car.grip: write key:value',
      'car.grip must be a number',
    ]);
    expect(car).toEqual({ SPEED: 30, GRIP: 2 });
    expect(t.override('')).toEqual([]);
  });
});
