// Trisslott, the kiosk's scratch card: prizes by the vinstplan in economy.ts, and the temper gets worse with every losing ticket scratched inside the window.
// main.ts passes in the rolls, the clock, the wallet, the toasts and the win effects. No three.js or DOM here.
import { brokeLine, earn, fmtKr, pay, TRISS_KR, trissPrize, type Wallet } from './economy';

const TEMPER_WINDOW_S = 25; // losing tickets scratched within this many s of each other add to the temper
export const BIG_WIN_KR = 10_000; // a win this big gets the big toast, and banknotes rain
const SCRATCH_S = 0.9; // how long scratching takes before the ticket shows its result

/** What you say about a losing ticket, from calm to furious; the temper picks the row. */
export const TEMPER_LINES = [
  [
    'Järnspikar, ingen vinst denna gång heller.',
    'Äsch, dä va la synd.',
    'Nä, inget dänna gången heller.',
    'Jaja, nästa lott så.',
  ],
  [
    'Men jösses, inte ett öre!',
    'Tusan hakar, en nitlott te!',
    'Dä här börjar likna lurendrejeri.',
    'Sjutton gubbar, nu får dä la ändå vända!',
  ],
  [
    'Fy sjutton, dä ä ju rena fusket!',
    'Jäklar anamma, inte en krona!',
    'Va i hela fridens namn hôller di på mä?!',
    'Nu blir ja förbannad på riktigt!',
  ],
  [
    'Fan i helvete, dä ä ju bedrägeri!',
    'Satans jävla skitlotter!',
    'Jävlar i min lilla låda, ge mej en te!',
    'Helvetes förbannade skrapskit, ja ska anmäla hela Svenska Spel!',
  ],
] as const;

/** The part of URLSearchParams the seed reads; sim code has no DOM types (tsconfig.sim.json). */
type Query = { get(name: string): string | null };

/**
 * The seed for the tickets' own stream: `?seed=n` pins it, for tests and replays; otherwise `fresh()`, a new one each
 * page load, so the tickets differ between sessions. A seed that isn't a whole number counts as none.
 */
export function trisslottSeed(q: Query, fresh: () => number): number {
  const seed = Number(q.get('seed')?.trim() || Number.NaN); // Number('') is 0, so an empty ?seed= would pin 0
  return Number.isInteger(seed) ? seed : fresh();
}

/** The temper row for this many losing tickets in the window. */
export const temper = (n: number) => (n < 3 ? 0 : n < 5 ? 1 : n < 8 ? 2 : 3);

/** What a trisslott reads from the rest of the game. */
export interface TrisslottDeps {
  random(): number; // the ticket's roll, from its own seeded stream
  pick<T>(a: readonly T[]): T; // a random line, from the seeded stream
  now(): number; // a clock in s, for the temper window
  toast(msg: string, secs?: number, cls?: string): void;
  wallet: Wallet; // pays for each ticket, and gets the winnings
  celebrate(kr: number): void; // a winning ticket's effects, bigger for a bigger win
  rainNotes(): void; // the big win's extra: banknotes around you
  draw(bought: number, won: number, wonKr: number): void; // the HUD's ticket count
}

/** Your trisslotter: how many you have bought and won, and how cross the last few made you. */
export class Trisslott {
  bought = 0;
  won = 0;
  wonKr = 0;
  scratching = 0; // s left scratching the current ticket
  private readonly losses: number[] = []; // when each losing ticket in the window was scratched (s)
  private last = '';
  private readonly g: TrisslottDeps;

  constructor(g: TrisslottDeps) {
    this.g = g;
  }

  /** Buys a ticket and starts scratching it, unless one is already being scratched. */
  scratch() {
    const g = this.g;
    if (this.scratching > 0) return;
    if (!pay(g.wallet, TRISS_KR)) {
      g.toast(brokeLine(TRISS_KR), 3);
      return;
    }
    this.scratching = SCRATCH_S;
    g.toast('Skrap, skrap, skrap…', 1.5);
  }

  update(dt: number) {
    if (this.scratching <= 0) return;
    this.scratching -= dt;
    if (this.scratching <= 0) this.result();
  }

  private result() {
    const g = this.g;
    this.bought++;
    const kr = trissPrize(g.random());
    if (kr) {
      this.won++;
      this.wonKr += kr;
      this.losses.length = 0;
      earn(g.wallet, kr);
      g.celebrate(kr);
      if (kr >= BIG_WIN_KR) {
        g.rainNotes();
        g.toast(
          '”VINST! Dä va som sjutton, ja visste väl dä!” You won ' + fmtKr(kr) + ' on a trisslott. That never happens.',
          8,
          'win',
        );
      } else g.toast('”Vinst! ' + fmtKr(kr) + ', dä ä la nåt.”', 3, 'win');
    } else {
      const t = g.now();
      while (this.losses.length && t - this.losses[0] > TEMPER_WINDOW_S) this.losses.shift();
      this.losses.push(t);
      const lines = TEMPER_LINES[temper(this.losses.length)];
      let line: string = this.bought === 1 ? lines[0] : g.pick(lines);
      while (line === this.last) line = g.pick(lines);
      this.last = line;
      g.toast('”' + line + '”', 3);
    }
    g.draw(this.bought, this.won, this.wonKr);
  }
}
