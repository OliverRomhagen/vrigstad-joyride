import { describe, expect, it } from 'vitest';
import { HURRY_LINE, PelleTalk, STARE_LINE } from '../../../wiki/src/lib/pelle-talk';

const LINES = ['hej', 'a', 'b', 'c'];

/** Plåt-Pelle on a clock the test moves by hand: each call first sets the time to `t` (ms). */
function pelle(lines: readonly string[], rnd: () => number) {
  const clock = { t: 0, now: () => clock.t };
  const talk = new PelleTalk(lines, clock, rnd);
  const at = (t: number) => {
    clock.t = t;
    return talk;
  };
  return {
    tick: (t: number) => at(t).tick(),
    picked: (t: number) => at(t).picked(),
    lookAway: (t: number) => at(t).lookAway(),
  };
}

describe('PelleTalk', () => {
  it('greets once, then waits at least 15 s between lines and never says the same line twice in a row', () => {
    let r = 0;
    const talk = pelle(LINES, () => (r = (r + 0.37) % 1));
    expect(talk.tick(0)).toBe('hej');
    expect(talk.tick(14_999)).toBeUndefined();
    let last = 'hej';
    // picking a car now and then keeps him from staring
    for (let now = 31_000, n = 0; n < 40; now += 31_000, n++) {
      talk.picked(now);
      const line = talk.tick(now);
      expect(line).toBeDefined();
      expect(line).not.toBe('hej');
      expect(line).not.toBe(last);
      last = line as string;
    }
  });

  it('copes with one line, or none', () => {
    const one = pelle(['hej'], () => 0);
    expect(one.tick(0)).toBe('hej');
    expect(one.tick(20_000)).toBe('hej');
    expect(pelle([], () => 0).tick(0)).toBeUndefined();
  });

  it('tells you off for flicking through five cars within 4 s, not for four, and not again for 15 s', () => {
    const talk = pelle(LINES, () => 0.5);
    for (const t of [0, 1000, 2000, 3000]) expect(talk.picked(t)).toBeUndefined();
    expect(talk.picked(3500)).toBe(HURRY_LINE);
    for (let t = 3600; t < 18_500; t += 100) expect(talk.picked(t)).toBeUndefined(); // an arrow key held down
    expect(talk.picked(18_500)).toBe(HURRY_LINE); // still flicking, once the 15 s are up
    const slow = pelle(LINES, () => 0.5);
    for (const t of [0, 1500, 3000, 4500, 6000]) expect(slow.picked(t)).toBeUndefined();
  });

  it('comments once on a car you look at for 30 s, after the line before has had its while', () => {
    const talk = pelle(LINES, () => 0); // 15 s between lines
    talk.tick(0);
    talk.picked(10_000);
    expect(talk.tick(30_000)).not.toBe(STARE_LINE); // a line, up until 45 s
    expect(talk.tick(40_000)).toBeUndefined(); // looked for 30 s, but that line is still up
    expect(talk.tick(45_000)).toBe(STARE_LINE);
    expect(talk.tick(100_000)).not.toBe(STARE_LINE);
    talk.picked(100_000);
    expect(talk.tick(130_000)).toBe(STARE_LINE);
  });

  it('starts the stare over while nobody is looking', () => {
    const talk = pelle(LINES, () => 0);
    talk.tick(0);
    talk.lookAway(20_000);
    expect(talk.tick(40_000)).not.toBe(STARE_LINE);
    expect(talk.tick(55_000)).toBe(STARE_LINE);
  });
});
