// When Plåt-Pelle talks in the garage, and what he says: his greeting first, then one of the game's lines now and then, in no
// fixed order. Two lines are the garage's own, for a visitor who can't make up their mind, and one who can't stop looking.
import type { Clock } from './clock';

/** What he says when you flick through the cars fast (HURRY_PICKS picks within HURRY_WINDOW_MS). */
export const HURRY_LINE = 'Nä, nu fåru bestämma dej. Ja har inge tid för vel-pellar.';
/** What he says when you have looked at one car for STARE_MS. */
export const STARE_LINE = 'Du har glott på den där en bra stund nu. Ska du köpa’n eller gifta dej mä’n?';

const QUIET_MIN_MS = 15_000; // between two of his lines: a while, picked at random in this range
const QUIET_MAX_MS = 30_000;
const HURRY_PICKS = 5;
const HURRY_WINDOW_MS = 4_000;
const HURRY_AGAIN_MS = 15_000; // so holding an arrow key down doesn't make him say it over and over
const STARE_MS = 30_000;

/** Plåt-Pelle's side of the garage. `rnd` gives [0, 1). */
export class PelleTalk {
  private picks: number[] = [];
  private hurriedAt = -Infinity;
  private lookingSince: number;
  private hasStared = false;
  private nextAt: number;
  private last = -1;

  constructor(
    private readonly lines: readonly string[],
    private readonly clock: Clock,
    private readonly rnd: () => number,
  ) {
    this.lookingSince = this.nextAt = clock.now(); // the first tick greets you
  }

  /** Another car was picked: what he says to that, if anything. */
  picked(): string | undefined {
    const now = this.clock.now();
    this.lookingSince = now;
    this.hasStared = false;
    this.picks = this.picks.filter(t => now - t < HURRY_WINDOW_MS);
    this.picks.push(now);
    if (this.picks.length < HURRY_PICKS || now - this.hurriedAt < HURRY_AGAIN_MS) return undefined;
    this.picks = [];
    this.hurriedAt = now;
    return this.say(HURRY_LINE, now);
  }

  /** Nobody is looking at a car just now (the tab is hidden, the car didn't load, it's the police's): staring starts over. */
  lookAway() {
    this.lookingSince = this.clock.now();
  }

  /** Called every so often: his next line, when it's time for one. */
  tick(): string | undefined {
    const now = this.clock.now();
    if (now < this.nextAt) return undefined; // a line he has just said stays up its while, even when you stare
    if (!this.hasStared && now - this.lookingSince >= STARE_MS) {
      this.hasStared = true;
      return this.say(STARE_LINE, now);
    }
    if (!this.lines.length) return undefined;
    // the greeting first, then any line but the greeting and the one he said last
    let i = 0;
    const rest = this.lines.length - 1;
    if (this.last >= 0 && rest > 1) {
      i = 1 + Math.floor(this.rnd() * (rest - (this.last > 0 ? 1 : 0)));
      if (this.last > 0 && i >= this.last) i += 1;
    } else if (this.last >= 0) i = rest;
    this.last = i;
    return this.say(this.lines[i], now);
  }

  private say(line: string, now: number) {
    this.nextAt = now + QUIET_MIN_MS + this.rnd() * (QUIET_MAX_MS - QUIET_MIN_MS);
    return line;
  }
}
