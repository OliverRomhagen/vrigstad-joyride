// Money (#76): the player's wallet, prices and payouts, as plain data and pure rules (no three.js, no DOM).
// Selling cars, repairs and paying off a star build on pay / earn.

export const START_KR = 200;                              // what you have in your pocket at the start
export const TRISS_KR = 30, TREATS_KR = 5;                // a trisslott; a bag of three cat treats
export const KORV_KR = 25, RULLE_KR = 45;                 // korv me brö; a smålandsrulle
export const FINE_SHARE = 0.25, FINE_PER_STAR_KR = 100;   // Gripen! costs this share of your money, or this much per star, whichever is more

// The trisslott vinstplan: of every TRISS_TICKETS tickets, how many win each prize, as [kr, tickets]; the rest lose.
// One ticket in ten wins, most of them a ticket back, and about a fifth of the money comes back.
export const TRISS_TICKETS = 100_000;
export const TRISS_PLAN: readonly (readonly [number, number])[] = [[30, 8_000], [60, 1_200], [100, 450], [200, 200], [500, 100], [1000, 40], [10_000, 10]];

export interface Wallet {
  kr: number;
}

export const newWallet = (): Wallet => ({ kr: START_KR });

/** Takes n kr if the wallet holds that much. False, and nothing taken, when it doesn't. */
export function pay(w: Wallet, n: number): boolean {
  if (n < 0 || w.kr < n) return false;
  w.kr -= n;
  return true;
}

export function earn(w: Wallet, n: number) {
  w.kr += Math.max(0, n);
}

/** What a ticket pays, from a roll r in [0, 1): 0 for a losing ticket. */
export function trissPrize(r: number): number {
  let x = r * TRISS_TICKETS;
  for (const [kr, n] of TRISS_PLAN) {
    if (x < n) return kr;
    x -= n;
  }
  return 0;
}

/** The fine for Gripen! with this many stars; never more than the wallet holds. */
export function fine(kr: number, stars: number): number {
  return Math.min(kr, Math.max(Math.round(kr * FINE_SHARE), stars * FINE_PER_STAR_KR));
}
