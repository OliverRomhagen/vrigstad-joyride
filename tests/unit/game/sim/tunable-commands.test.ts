import { describe, expect, it } from 'vitest';
import { Commands } from '../../../../src/game/commands';
import { registerCarTunables } from '../../../../src/game/sim/car-tunables';
import { registerTunableCommands } from '../../../../src/game/sim/tunable-commands';
import { Tunables } from '../../../../src/game/sim/tunables';

/** The console over two small objects, built by hand so each value can be worked out. */
function console_() {
  const car = { SPEED: 10, GRIP: 2 },
    cat = { NAPS: 3 };
  const t = new Tunables();
  t.addFields('car', car, {
    SPEED: { name: 'top-speed', unit: 'm/s', min: 1, max: 50, help: 'top speed' },
    GRIP: { name: 'grip', unit: '1/s', min: 0, max: 5, help: 'grip' },
  });
  t.addFields('cat', cat, { NAPS: { name: 'naps', unit: 'per hour', min: 0, max: 10, help: 'how often it sleeps' } });
  const c = new Commands();
  registerTunableCommands(c, t);
  return { car, cat, c };
}

describe('tunable commands', () => {
  it('sets a number, says what it was, and reads a decimal comma', () => {
    const { car, c } = console_();
    expect(c.run('set car.grip 4')).toBe('car.grip = 4 1/s (was 2)');
    expect(c.run('set car.top-speed 12,5')).toBe('car.top-speed = 12.5 m/s (was 10)');
    expect(car).toEqual({ SPEED: 12.5, GRIP: 4 });
  });

  it('refuses a value out of range, or an unknown tunable, and changes nothing', () => {
    const { car, c } = console_();
    expect(c.run('set car.grip 6')).toBe('car.grip is from 0 to 5 1/s. Usage: set <tunable> <value>');
    expect(c.run('set car.wings 1')).toBe('No tunable called car.wings. Usage: set <tunable> <value>');
    expect(c.run('set car.grip x')).toBe('value is a number. Usage: set <tunable> <value>');
    expect(car.GRIP).toBe(2);
  });

  it('gets a number with its help, default and range', () => {
    const { c } = console_();
    c.run('set car.grip 4');
    expect(c.run('get car.grip')).toBe('car.grip = 4 1/s: grip\nDefault 2, from 0 to 5 1/s.');
  });

  it('lists the groups, or the numbers under a prefix, and shows the default of a changed one', () => {
    const { c } = console_();
    c.run('set car.grip 4');
    expect(c.run('list')).toBe('car: 2 numbers, 1 changed\ncat: 1 number');
    expect(c.run('list car')).toBe('car.grip = 4 1/s (default 2)\ncar.top-speed = 10 m/s');
    expect(c.run('list car.')).toBe(c.run('list car'));
    expect(c.run('list car.grip')).toBe('car.grip = 4 1/s (default 2)');
    expect(c.run('list ca')).toBe('No tunable starts with ca. Usage: list [prefix]');
  });

  it('resets one number or all of them', () => {
    const { car, cat, c } = console_();
    c.run('set car.grip 4');
    c.run('set cat.naps 9');
    expect(c.run('reset car.grip')).toBe('car.grip = 2 1/s');
    expect(cat.NAPS).toBe(9);
    expect(c.run('reset')).toBe('Every tunable is back to its default (1 had changed).');
    expect(car).toEqual({ SPEED: 10, GRIP: 2 });
    expect(cat.NAPS).toBe(3);
  });

  it('completes the keys, and the prefixes for list', () => {
    const { c } = console_();
    expect(c.complete('set car.')).toEqual(['car.grip', 'car.top-speed']);
    expect(c.complete('get c')).toEqual(['car.grip', 'car.top-speed', 'cat.naps']);
    expect(c.complete('list c')).toEqual(['car', 'car.grip', 'car.top-speed', 'cat', 'cat.naps']);
    expect(c.complete('set car.grip ')).toEqual([]);
  });

  it('registers over the cars’ real tunables', () => {
    const t = new Tunables();
    registerCarTunables(t);
    const c = new Commands();
    registerTunableCommands(c, t);
    expect(c.run('get vehicle.volvo.top-speed')).toMatch(/^vehicle\.volvo\.top-speed = [\d.]+ m\/s: /);
    expect(c.run('list steering').split('\n')).toHaveLength(2);
  });

  it('shows a typed value in full, without float noise', () => {
    const { c } = console_();
    expect(c.run('set car.grip 1.0000001')).toBe('car.grip = 1.0000001 1/s (was 2)');
    expect(c.run('set car.grip 0.1')).toBe('car.grip = 0.1 1/s (was 1.0000001)');
  });

  it('marks a number with its own reset as changed once set, even to its default', () => {
    const t = new Tunables();
    let response = 0.2;
    t.add(
      'car.response',
      { unit: 's', min: 0, max: 1, help: 'response' },
      () => response,
      v => (response = v),
      () => (response = 0.2),
    );
    const c = new Commands();
    registerTunableCommands(c, t);
    c.run('set car.response 0.2');
    expect(c.run('list')).toBe('car: 1 number, 1 changed');
    expect(c.run('list car')).toBe('car.response = 0.2 s (default 0.2)');
    c.run('reset car.response');
    expect(c.run('list')).toBe('car: 1 number');
  });
});
