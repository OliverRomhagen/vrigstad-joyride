// The getaway's chase rules (#170): caught, free, or one more star. Plain data, apart from the canvas and the keys, so a
// unit test can drive them; the escape is the game's own (EVADE_DIST_M for EVADE_S, police.ts).
import { EVADE_DIST_M, EVADE_S, MAX_STARS } from '#game/police';

/** a police car this close (m) catches you */
export const CATCH_DIST_M = 4.5;
/** a new star (and police car) every this many seconds while they can see you */
export const STAR_UP_S = 12;

/** How long you've been out of sight (s), and how long since the last star while seen. */
export interface ChaseTimers {
  evadeS: number;
  starS: number;
}
/** What a step of the chase ended in: caught, got away, a star more, or nothing yet. */
export type ChaseStep = 'caught' | 'free' | 'star' | null;

/** One step of `dt` s, with the nearest police car `nearestM` away and `stars` stars now. Writes into `t`. */
export function stepChase(t: ChaseTimers, nearestM: number, stars: number, dt: number): ChaseStep {
  if (nearestM < CATCH_DIST_M) return 'caught';
  if (nearestM > EVADE_DIST_M) {
    t.evadeS += dt;
    return t.evadeS > EVADE_S ? 'free' : null;
  }
  t.evadeS = 0;
  t.starS += dt;
  if (t.starS <= STAR_UP_S || stars >= MAX_STARS) return null;
  t.starS = 0;
  return 'star';
}
