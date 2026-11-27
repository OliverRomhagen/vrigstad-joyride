import { describe, expect, it } from 'vitest';
import { DMG_MAX } from '../../../src/game/health';
import {
  DRL_SHARE,
  HAZARD_HZ,
  lampState,
  lampsOff,
  lightLevel,
  lightsModeOf,
  REAR_RUN,
} from '../../../src/game/lighting';

const car = (o: Partial<Parameters<typeof lampState>[0]> = {}) => ({
  mode: 'player' as const,
  v: 10,
  brk: false,
  dmg: 0,
  hitAt: -9,
  ...o,
});

describe('lampState', () => {
  it('gives a driven car dipped headlights and rear position lights by day', () => {
    for (const mode of ['player', 'ai', 'police'] as const)
      expect(lampState(car({ mode }), 0, 0, lampsOff())).toEqual({
        head: DRL_SHARE,
        rear: REAR_RUN,
        brake: 0,
        reverse: 0,
        hazard: 0,
      });
  });

  it('turns them up in the dark', () => {
    const s = lampState(car(), 1, 0, lampsOff());
    expect(s.head).toBe(1);
    expect(s.rear).toBeGreaterThan(REAR_RUN);
  });

  it('shows the brake signal and backing up', () => {
    expect(lampState(car({ brk: true }), 0, 0, lampsOff()).brake).toBe(1);
    expect(lampState(car({ v: -1 }), 0, 0, lampsOff()).reverse).toBe(1);
    expect(lampState(car({ v: -0.1 }), 0, 0, lampsOff()).reverse).toBe(0); // settling at a stop
  });

  it('leaves a parked or left car dark, brake signal or not', () => {
    for (const mode of ['parked', 'idle'] as const)
      expect(lampState(car({ mode, brk: true, v: -2 }), 1, 0, lampsOff())).toEqual(lampsOff());
  });

  it('blinks only the hazards on a wreck, at HAZARD_HZ, from its own last hit', () => {
    const wreck = car({ dmg: DMG_MAX, hitAt: 3, brk: true }),
      at = (t: number) => lampState(wreck, 0, t, lampsOff());
    expect(at(3)).toEqual({ ...lampsOff(), hazard: 1 });
    expect(at(3 + 0.75 / HAZARD_HZ).hazard).toBe(0);
    expect(at(3 + 1 / HAZARD_HZ + 0.01).hazard).toBe(1);
    const other = car({ dmg: DMG_MAX, hitAt: 3 - 0.5 / HAZARD_HZ });
    expect(lampState(other, 0, 3.01, lampsOff()).hazard).not.toBe(at(3.01).hazard); // wrecked at another moment, out of step
  });
});

describe('lightLevel', () => {
  it('is day at midday and through the evening the clock runs to, in July', () => {
    for (const hour of [6, 13, 19]) expect(lightLevel({ hour, night: 0 }, 'auto')).toBe(0);
  });

  it('gets nearly dark midway through the night skip, and back to day at its ends', () => {
    expect(lightLevel({ hour: 19, night: 0.5 }, 'auto')).toBeCloseTo(0.85, 5);
    expect(lightLevel({ hour: 19, night: 0.25 }, 'auto')).toBeGreaterThan(0.5);
    expect(lightLevel({ hour: 19, night: 0.01 }, 'auto')).toBeLessThan(0.1);
  });

  it('forces the dark or the day with ?lights=on or off, and ignores anything else', () => {
    expect(lightLevel({ hour: 13, night: 0 }, 'on')).toBe(1);
    expect(lightLevel({ hour: 19, night: 0.5 }, 'off')).toBe(0);
    expect([lightsModeOf('on'), lightsModeOf('off'), lightsModeOf('bright'), lightsModeOf(null)]).toEqual([
      'on',
      'off',
      'auto',
      'auto',
    ]);
  });
});
