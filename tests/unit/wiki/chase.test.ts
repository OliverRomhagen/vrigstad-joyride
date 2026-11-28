import { describe, expect, it } from 'vitest';
import { EVADE_DIST_M, EVADE_S, MAX_STARS } from '../../../src/game/police';
import { CATCH_DIST_M, type ChaseTimers, STAR_UP_S, stepChase } from '../../../wiki/src/lib/landing/chase';

const timers = (): ChaseTimers => ({ evadeS: 0, starS: 0 });
/** Steps the chase `s` seconds at a fixed distance, until it ends; what it ended in, and the stars added. */
function run(t: ChaseTimers, nearestM: number, s: number, stars = 1, dt = 0.05) {
  let added = 0;
  for (let time = 0; time < s; time += dt) {
    const step = stepChase(t, nearestM, stars + added, dt);
    if (step === 'star') added++;
    else if (step) return { step, added };
  }
  return { step: null, added };
}

describe('stepChase (the getaway)', () => {
  it('catches you within CATCH_DIST_M', () => {
    expect(stepChase(timers(), CATCH_DIST_M - 0.1, 1, 0.05)).toBe('caught');
    expect(stepChase(timers(), CATCH_DIST_M + 0.1, 1, 0.05)).not.toBe('caught');
  });

  it('lets you go after EVADE_S beyond EVADE_DIST_M, as the game does, and not a moment before', () => {
    const t = timers();
    expect(run(t, EVADE_DIST_M + 1, EVADE_S - 0.1).step).toBeNull();
    expect(run(t, EVADE_DIST_M + 1, 0.2).step).toBe('free');
  });

  it('starts the escape again when they see you', () => {
    const t = timers();
    run(t, EVADE_DIST_M + 1, EVADE_S - 1);
    stepChase(t, EVADE_DIST_M - 1, 1, 0.05);
    expect(t.evadeS).toBe(0);
    expect(run(t, EVADE_DIST_M + 1, EVADE_S - 0.1).step).toBeNull();
  });

  it('adds a star every STAR_UP_S while seen, up to MAX_STARS', () => {
    expect(run(timers(), 50, STAR_UP_S + 0.1).added).toBe(1);
    expect(run(timers(), 50, 10 * STAR_UP_S).added).toBe(MAX_STARS - 1); // from one star
    expect(run(timers(), EVADE_DIST_M + 1, EVADE_S - 0.1).added).toBe(0); // none while out of sight
  });
});
