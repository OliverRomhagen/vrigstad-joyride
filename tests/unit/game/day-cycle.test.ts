import { describe, expect, it, vi } from 'vitest';
import { Commands } from '../../../src/game/commands';
import {
  DAWN_H,
  DAY_S,
  DUSK_H,
  makeClock,
  makePace,
  NIGHT_S,
  registerDayCommands,
  type Sky,
  START_H,
  skyAt,
  stepClock,
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

describe('the pace of the clock', () => {
  it('holds the time while it is not running, and says the time did not move', () => {
    const c = makeClock(12),
      pace = makePace(false);
    expect(stepClock(c, pace, DAY_S)).toBe(false);
    expect(c).toEqual({ hour: 12, night: 0 });
  });

  it('runs speed times faster: at 14×, the 14 hours of the day pass in DAY_S / 14, so one in DAY_S / 14 / 14', () => {
    const c = makeClock(DAWN_H),
      pace = makePace();
    pace.speed = 14;
    expect(stepClock(c, pace, DAY_S / 14 / 14)).toBe(true);
    expect(c.hour).toBeCloseTo(DAWN_H + 1, 9);
  });
});

describe('the console time command', () => {
  const setup = (hour = 10) => {
    const commands = new Commands(),
      c = makeClock(hour),
      pace = makePace(),
      changed = vi.fn();
    registerDayCommands(commands, c, pace, changed);
    return { commands, c, pace, changed };
  };

  it('says where the clock is', () => {
    const { commands } = setup(16.5);
    expect(commands.run('time')).toBe('Time: 16:30, running at 1×.');
  });

  it('jumps to an hour written as 16.5, 16,5 or 16:30, and tells the light to follow', () => {
    for (const hour of ['16.5', '16,5', '16:30']) {
      const { commands, c, changed } = setup();
      expect(commands.run('time ' + hour)).toBe('Time: 16:30, running at 1×.');
      expect(c).toEqual({ hour: 16.5, night: 0 });
      expect(changed).toHaveBeenCalledOnce();
    }
  });

  it('jumps to dawn, noon and dusk, and to the middle of the night skip', () => {
    const { commands, c } = setup();
    commands.run('time dawn');
    expect(c).toEqual({ hour: DAWN_H, night: 0 });
    commands.run('time noon');
    expect(c.hour).toBe(12);
    commands.run('time DUSK');
    expect(c.hour).toBe(DUSK_H);
    expect(commands.run('time night')).toBe('Time: night, 50% through, running at 1×.');
    expect(c).toEqual({ hour: DUSK_H, night: 0.5 });
    commands.run('time 9'); // an hour leaves the night
    expect(c).toEqual({ hour: 9, night: 0 });
  });

  it('holds and runs the clock, without moving the time or touching the light', () => {
    const { commands, c, pace, changed } = setup();
    expect(commands.run('time hold')).toBe('Time: 10:00, held at 1×.');
    expect(pace.running).toBe(false);
    expect(stepClock(c, pace, 60)).toBe(false);
    expect(commands.run('time run')).toBe('Time: 10:00, running at 1×.');
    expect(pace.running).toBe(true);
    expect(changed).not.toHaveBeenCalled();
  });

  it('sets the speed, which holding keeps and shows', () => {
    const { commands, pace } = setup();
    expect(commands.run('time speed 20')).toBe('Time: 10:00, running at 20×.');
    expect(commands.run('time hold')).toBe('Time: 10:00, held at 20×.');
    expect(commands.run('time speed 3')).toBe('Time: 10:00, held at 3×.');
    commands.run('time run');
    expect(pace.speed).toBe(3);
  });

  it('takes the first and last hour of the day and the slowest and fastest speed', () => {
    const { commands, c, pace } = setup();
    expect(commands.run('time 5')).toBe('Time: 05:00, running at 1×.');
    expect(commands.run('time 19:00')).toBe('Time: 19:00, running at 1×.');
    expect(c.hour).toBe(DUSK_H);
    commands.run('time speed 0.1');
    expect(pace.speed).toBe(0.1);
    commands.run('time speed 200');
    expect(pace.speed).toBe(200);
  });

  it('shows the minute it is, not the nearest one', () => {
    const { commands } = setup();
    expect(commands.run('time 18.999')).toBe('Time: 18:59, running at 1×.');
  });

  it('refuses an hour outside the day, a speed out of range and extra words, and changes nothing', () => {
    const { commands, c, pace, changed } = setup();
    for (const line of ['time 3', 'time 4.99', 'time 19.01', 'time 19:01', 'time 25:00', 'time -6'])
      expect(commands.run(line), line).toMatch(/^hour is from 5 to 19\. Usage: time /);
    for (const line of ['time lunch', 'time 16:60', 'time 16:5'])
      expect(commands.run(line), line).toMatch(/^hour is a number\. Usage: time /);
    for (const line of ['time speed 0', 'time speed 0.09', 'time speed 200.01', 'time speed 500'])
      expect(commands.run(line), line).toMatch(/^speed is from 0\.1 to 200\. Usage: time /);
    for (const line of ['time speed', 'time speed fast'])
      expect(commands.run(line), line).toMatch(/^speed is a number\. Usage: time /);
    expect(commands.run('time 12 13')).toMatch(/^Too many words\. Usage: time /);
    expect(commands.run('time speed 2 3')).toMatch(/^Too many words\. Usage: time /);
    expect(c).toEqual({ hour: 10, night: 0 });
    expect(pace).toEqual({ running: true, speed: 1 });
    expect(changed).not.toHaveBeenCalled();
  });

  it('completes its words with Tab', () => {
    const { commands } = setup();
    expect(commands.complete('time ')).toEqual(['dawn', 'dusk', 'hold', 'night', 'noon', 'run', 'speed']);
    expect(commands.complete('time n')).toEqual(['night', 'noon']);
    expect(commands.complete('time speed ')).toEqual([]);
  });
});
