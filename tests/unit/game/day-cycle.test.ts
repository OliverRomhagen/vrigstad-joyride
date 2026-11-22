import { describe, expect, it } from 'vitest';
import {
  DAWN_H,
  DAY_S,
  DUSK_H,
  makeClock,
  NIGHT_S,
  type Sky,
  START_H,
  skyAt,
  tickClock,
} from '../../../src/game/day-cycle';

const blank = (): Sky => ({ x: 0, y: 1, z: 0, sun: 0, warm: 0, light: 0 });
const DT = 1 / 30;

describe('day clock', () => {
  it('starts inside the day', () => {
    expect(makeClock(2).hour).toBe(DAWN_H);
    expect(makeClock(23).hour).toBe(DUSK_H);
    expect(makeClock(Number.NaN).hour).toBe(START_H);
  });

  it('carries time past dusk and past the skip, so one long step lands where many short ones would', () => {
    const big = makeClock(DAWN_H);
    tickClock(big, DAY_S + NIGHT_S / 2);
    expect(big).toEqual({ hour: DUSK_H, night: 0.5 });
    tickClock(big, NIGHT_S / 2 + DAY_S / 4);
    expect(big.night).toBe(0);
    expect(big.hour).toBeCloseTo(DAWN_H + (DUSK_H - DAWN_H) / 4, 9);
  });

  it('runs from dawn to dusk in DAY_S, then skips the night in NIGHT_S', () => {
    const c = makeClock(DAWN_H);
    tickClock(c, DAY_S / 2);
    expect(c.hour).toBeCloseTo((DAWN_H + DUSK_H) / 2, 9);
    tickClock(c, DAY_S / 2);
    expect(c.hour).toBe(DUSK_H);
    tickClock(c, NIGHT_S / 2);
    expect(c.night).toBeCloseTo(0.5, 9);
    expect(c.hour).toBe(DUSK_H);
    tickClock(c, NIGHT_S / 2 + DT);
    expect(c.night).toBe(0);
    expect(c.hour).toBeCloseTo(DAWN_H + (DT * (DUSK_H - DAWN_H)) / DAY_S, 9); // the frame past the skip counts into the morning
  });
});

describe('skyAt', () => {
  it('gives the midday look the game was tuned with', () => {
    const s = skyAt(makeClock(13), blank());
    expect(s.sun).toBeCloseTo(1, 2);
    expect(s.warm).toBe(0);
    expect(s.light).toBe(1);
  });

  it('is warmer and weaker than midday at both ends of the day', () => {
    for (const h of [DAWN_H, DUSK_H]) {
      const s = skyAt(makeClock(h), blank());
      expect(s.warm).toBeGreaterThan(0.6);
      expect(s.sun).toBeLessThan(0.8);
    }
  });

  it('gives no direct sun halfway through the night skip', () => {
    expect(skyAt({ hour: DUSK_H, night: 0.5 }, blank()).sun).toBe(0);
  });

  it('never gets dark, never lights from below, and changes smoothly through a whole day and night', () => {
    const c = makeClock(DAWN_H),
      s = blank(),
      prev = { ...skyAt(c, s) };
    for (let t = 0; t < DAY_S + NIGHT_S + 1; t += DT) {
      tickClock(c, DT);
      skyAt(c, s);
      expect(s.light).toBeGreaterThan(0.4);
      expect(s.y).toBeGreaterThanOrEqual(0.1 - 1e-12);
      expect(Math.hypot(s.x, s.y, s.z)).toBeCloseTo(1, 9);
      for (const k of ['sun', 'warm', 'light'] as const) expect(Math.abs(s[k] - prev[k])).toBeLessThan(0.02);
      // the direction swings fastest past north in the night skip, where the sun gives no light
      expect(Math.hypot(s.x - prev.x, s.y - prev.y, s.z - prev.z)).toBeLessThan(0.05);
      Object.assign(prev, s);
    }
    expect(c.hour).toBeLessThan(DAWN_H + 0.1);
  });
});
