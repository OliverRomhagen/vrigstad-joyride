// Trisslott, the kiosk's scratch card: one win in a thousand, and the temper gets worse with every losing ticket scratched inside the window.
// Moved from src/game/main.ts (#177); main.ts passes in the rolls, the clock and the toasts. No three.js or DOM here.

const WIN_ODDS = 0.001,
  TEMPER_WINDOW_S = 25; // chance a ticket wins; losing tickets scratched within this many s of each other add to the temper
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

/** The temper row for this many losing tickets in the window. */
export const temper = (n: number) => (n < 3 ? 0 : n < 5 ? 1 : n < 8 ? 2 : 3);

/** What a trisslott reads from the rest of the game. */
export interface TrisslottDeps {
  random(): number; // the odds; main.ts passes Math.random (the known exception in AGENTS.md)
  pick<T>(a: readonly T[]): T; // a random line, from the seeded stream
  now(): number; // a clock in s, for the temper window
  toast(msg: string, secs?: number, cls?: string): void;
  draw(bought: number, won: number): void; // the HUD's ticket count
}

/** Your trisslotter: how many you have bought and won, and how cross the last few made you. */
export class Trisslott {
  bought = 0;
  won = 0;
  scratching = 0; // s left scratching the current ticket
  private readonly losses: number[] = []; // when each losing ticket in the window was scratched (s)
  private last = '';
  private readonly g: TrisslottDeps;

  constructor(g: TrisslottDeps) {
    this.g = g;
  }

  /** Starts scratching a ticket, unless one is already being scratched. */
  scratch() {
    if (this.scratching > 0) return;
    this.scratching = SCRATCH_S;
    this.g.toast('Skrap, skrap, skrap…', 1.5);
  }

  update(dt: number) {
    if (this.scratching <= 0) return;
    this.scratching -= dt;
    if (this.scratching <= 0) this.result();
  }

  private result() {
    const g = this.g;
    this.bought++;
    if (g.random() < WIN_ODDS) {
      this.won++;
      this.losses.length = 0;
      g.toast('”VINST! Dä va som sjutton, ja visste väl dä!” You won on a trisslott. That never happens.', 8, 'win');
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
    g.draw(this.bought, this.won);
  }
}
