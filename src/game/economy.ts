// Money (#76): the player's wallet, prices and payouts, as plain data and pure rules (no three.js, no DOM).
// Selling cars, repairs and paying off a star build on pay / earn. Nothing here draws: the HUD shows whatever the wallet holds.
import { type Commands, parseKr } from './commands';
import { DMG_MAX } from './health';

export const START_KR = 200; // what you have in your pocket at the start
/** A trisslott at the kiosk, in kr. */
export const TRISS_KR = 30;
/** A bag of cat treats at the kiosk, in kr. */
export const TREATS_KR = 5;
/** How many cat treats a bag from the kiosk holds. */
export const TREAT_BAG = 3;
/** A korv me brö at the kiosk, in kr. */
export const KORV_KR = 25;
/** A smålandsrulle at the kiosk, in kr: dearer than the korv, and it heals twice as much. */
export const RULLE_KR = 45;
export const RAIN_KR = 1000; // låt det regna: banknotes thrown in the air, for show
const MYNT_KR = 1000; // what the mynt cheat adds
const FINE_SHARE = 0.25; // Gripen! costs this share of your money, or FINE_PER_STAR_KR per star, whichever is more
export const FINE_PER_STAR_KR = 100;

// Skroten buys stolen cars: by the model a car wears, else by its type; damage takes the price down to SCRAP_KR. It never buys a police car.
export const SCRAP_KR = 100; // a wrecked car is still worth this much as scrap
const CAR_KR_BY_TYPE: Readonly<Record<string, number>> = { volvo: 800, saab: 1000, epa: 500, traktor: 1200 };
const CAR_KR_BY_MODEL: Readonly<Record<string, number>> = {
  volvo240: 800,
  saab900: 1000,
  xc70: 1400, // the newest car in the village
  impala1970: 1600, // a raggarbil: a collector pays for it
  'micra-k11': 400,
  'duett-epa': 600,
};

/** How many tickets the trisslott vinstplan counts its wins in. */
export const TRISS_TICKETS = 100_000;
/**
 * The trisslott vinstplan: of every TRISS_TICKETS tickets, how many win each prize, as [kr, tickets]; the rest lose.
 * One ticket in ten wins, most of them a ticket back, and about a fifth of the money comes back.
 */
export const TRISS_PLAN: readonly (readonly [number, number])[] = [
  [30, 8_000],
  [60, 1_200],
  [100, 450],
  [200, 200],
  [500, 100],
  [1000, 40],
  [10_000, 10],
];

export interface Wallet {
  kr: number;
}

export const newWallet = (): Wallet => ({ kr: START_KR });

/** Money as the game shows it, in Swedish style: 10 000 riksdaler (everyday Swedish for kronor, said to sound a little funny; the same in the plural). */
export const fmtKr = (n: number) => n.toLocaleString('sv-SE') + ' riksdaler';

/** Takes n kr if the wallet holds that much. False, and nothing taken, when it doesn't. */
export function pay(w: Wallet, n: number): boolean {
  if (n < 0 || w.kr < n) return false;
  w.kr -= n;
  return true;
}

export function earn(w: Wallet, n: number) {
  w.kr += Math.max(0, n);
}

/** What the kiosk says when you can't pay kr. */
export const brokeLine = (kr: number) => '”Dä blir ' + fmtKr(kr) + '. Va, har du inga pengar? Nä, då blir dä inget.”';

/** What a ticket pays, from a roll r in [0, 1): 0 for a losing ticket. */
export function trissPrize(r: number): number {
  let x = r * TRISS_TICKETS;
  for (const [kr, n] of TRISS_PLAN) {
    if (x < n) return kr;
    x -= n;
  }
  return 0;
}

/** What Skroten pays for a car of this type and model at this much damage, in round tens; null when it won't buy it. */
export function carPrice(type: string, model: string | undefined, dmg: number): number | null {
  const base = (model && CAR_KR_BY_MODEL[model]) || CAR_KR_BY_TYPE[type];
  if (!base) return null;
  const whole = 1 - Math.min(Math.max(dmg, 0), DMG_MAX) / DMG_MAX;
  return Math.round((SCRAP_KR + (base - SCRAP_KR) * whole) / 10) * 10;
}

/** The fine for Gripen! with this many stars; never more than the wallet holds. */
export function fine(kr: number, stars: number): number {
  return Math.min(kr, Math.max(Math.round(kr * FINE_SHARE), stars * FINE_PER_STAR_KR));
}

/** The wallet's dev console commands: `kr <amount>` adds riksdaler (a negative amount takes them), `mynt` adds MYNT_KR. */
export function registerWalletCommands(commands: Pick<Commands, 'register'>, w: Wallet) {
  const addKr = (kr: number) => {
    if (kr >= 0) earn(w, kr);
    else pay(w, Math.min(-kr, w.kr));
    return 'Wallet: ' + fmtKr(w.kr) + '.';
  };
  commands.register('kr', {
    usage: '<amount>',
    help: 'add riksdaler to your wallet; a negative amount takes them',
    examples: ['kr 500', 'kr -200'],
    run: a => addKr(parseKr(a[0])),
  });
  commands.register('mynt', { help: 'add ' + fmtKr(MYNT_KR) + ' to your wallet', run: () => addKr(MYNT_KR) });
}
