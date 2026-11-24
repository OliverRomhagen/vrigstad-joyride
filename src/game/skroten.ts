// Skroten buys the car you drive in (#76): drive onto its ring, press E, and Plåt-Pelle makes an offer by the car's model and damage.
// He mends the car you drive onto the workshop's lift, and sells the cars on his lot: press E by one for his price. Neither with the police after you, and he never buys a police car.
// On foot you can talk to him. main.ts passes in the menu plate, the wallet and what happens to the car. No three.js or DOM here.
import type { Car, CarForSale } from './cars';
import { carPrice, earn, fmtKr, pay, repairPrice, salePrice, type Wallet } from './economy';
import type { MenuItem } from './pets';
import { tooFastToGetOut } from './player';
import type { CarType } from './sim/vehicle-spec';
import { LIFT_RING_M, OWNER_UV, type YardCar, yardHeading, yardToWorld } from './skroten-yard';
import type { GameState } from './state';

const OWNER_SAYS = 'Plåt-Pelle: ';
const OWNER_AT = yardToWorld(OWNER_UV.u, OWNER_UV.v);
const TALK_M = 3; // how close you stand to talk to him
const SALE_REACH_M = 5; // his price stays on the plate while you stand this close to the car; a little over the reach to get in
const NO_POLICE = OWNER_SAYS + '”En polisbil? Ä du inte klok? Den rör ja inte.”';
const CHASED = OWNER_SAYS + '”Inte mä snuten i hälarna! Kom tebaks när du ä av mä dom.”';
const SHORT = (kr: number) => OWNER_SAYS + '”' + fmtKr(kr) + ', sa ja. Kom tebaks när du har pengarna.”';
/** What he says when you talk to him on foot, one after the other. */
export const OWNER_LINES = [
  '”Tjena! Har du nån bil du vill bli av mä? Kör in den på ringen.”',
  '”Ja köper allt som rullar. Å dä mesta som inte gör dä.”',
  '”Polisbilar rör ja inte. Ja ä inte dum.”',
  '”Bilarna vid skylten å under taket ä till salu. Fint skick. Nästan.”',
  '”Ä bilen tilltufsad? Kör in den på lyften i verkstan, så lagar ja den.”',
  '”Fråga inte var bilarna kommer ifrån, så frågar inte ja heller.”',
  '”Den där Volvon har stått här sen sjuttifem. Den blir aldrig klar.”',
];

/** What Skroten reads from the rest of the game. */
export interface SkrotenDeps {
  game: Pick<GameState, 'inCar' | 'pcar'>;
  player: { readonly x: number; readonly z: number };
  readonly stars: number;
  openMenu(
    kind: string,
    title: string,
    items: MenuItem[],
    pick: (k: string) => void,
    stay?: (() => boolean) | null,
  ): void;
  toast(msg: string, secs?: number): void;
  atSkroten(): boolean; // the car you drive stands on Skroten's ring
  liftAt: { readonly x: number; readonly z: number } | null; // the middle of the workshop's lift bay; null with no workshop
  modelId(c: Car): string | undefined; // the model the car wears, if it has one
  carName(c: Car): string;
  wallet: Wallet; // the HUD shows whatever it holds
  sellCar(c: Car): void; // puts you on foot beside the car, and takes the car away
}

/** Skroten's offer and the sale. */
export class Skroten {
  private readonly g: SkrotenDeps;
  private said = 0;

  constructor(g: SkrotenDeps) {
    this.g = g;
  }

  // what Skroten pays for c, or the reason it won't buy it
  private offer(c: Car): number | string {
    if (this.g.stars) return CHASED;
    return carPrice(c.type, this.g.modelId(c), c.dmg) ?? NO_POLICE;
  }

  // what Plåt-Pelle asks to mend c, or the reason he won't; 0 for a car with no damage, before any reason, so a whole car on the lift gets no word
  private repairQuote(c: Car): number | string {
    if (c.dmg <= 0) return 0;
    if (this.g.stars) return CHASED;
    return repairPrice(c.type, this.g.modelId(c), c.dmg) ?? NO_POLICE;
  }

  // the car you drive stands on the lift
  private onLift(c: Car | null): c is Car {
    const { game, liftAt } = this.g;
    return !!(
      game.inCar &&
      c &&
      c === game.pcar &&
      liftAt &&
      Math.hypot(c.x - liftAt.x, c.z - liftAt.z) < LIFT_RING_M // on the ring that is drawn
    );
  }

  /** You stand on foot next to Plåt-Pelle, nearer him than `car` (the car E would get you into), so E right after getting out on the ring gets you back in. */
  nearOwner(car?: { x: number; z: number } | null) {
    const { game, player } = this.g,
      d = Math.hypot(player.x - OWNER_AT.x, player.z - OWNER_AT.z);
    return !game.inCar && d < TALK_M && (!car || d < Math.hypot(player.x - car.x, player.z - car.z));
  }

  /** E next to him: his next line, or a word about the police. */
  talk = () => {
    const { stars, toast } = this.g;
    if (stars) toast(OWNER_SAYS + '”Försvinn! Du har ju snuten efter dej!”', 3);
    else toast(OWNER_SAYS + OWNER_LINES[this.said++ % OWNER_LINES.length], 4);
  };

  /**
   * E on the ring: Skroten's offer for the car you drive, on the menu plate; on the lift, his price to mend it. False when there is none:
   * elsewhere, or refused (it says why).
   */
  open = () => {
    const { game, openMenu, toast, atSkroten } = this.g,
      c = game.pcar;
    if (this.onLift(c)) return this.openRepair(c);
    if (!game.inCar || !c || !atSkroten()) return false;
    const kr = this.offer(c);
    if (typeof kr === 'string') {
      toast(kr, 3.5);
      return false;
    }
    openMenu(
      'skrot',
      OWNER_SAYS + '”Den där? Ja ger dej ' + fmtKr(kr) + ' för den.”',
      [
        ['sell', 'Sälj <small>' + fmtKr(kr) + '</small>'],
        ['no', 'Nä, ja behåller den'],
      ],
      k => {
        if (k === 'sell') this.sell(c);
      },
      () => game.pcar === c && atSkroten() && !tooFastToGetOut(c),
    );
    return true;
  };

  private openRepair(c: Car) {
    const { openMenu, toast, carName } = this.g,
      kr = this.repairQuote(c);
    if (kr === 0) return false; // nothing to mend: E gets you out, as the prompt says, without a word every time
    if (typeof kr === 'string') {
      toast(kr, 3.5);
      return false;
    }
    openMenu(
      'skrot-fix',
      OWNER_SAYS + '”Den där ' + carName(c) + ' ä allt tilltufsad. ' + fmtKr(kr) + ', så blir den som ny.”',
      [
        ['fix', 'Laga <small>' + fmtKr(kr) + '</small>'],
        ['no', 'Nä, dä får va'],
      ],
      k => {
        if (k === 'fix') this.repair(c, kr);
      },
      () => this.onLift(c) && !tooFastToGetOut(c),
    );
    return true;
  }

  // the price is asked again at the moment of paying: stars can come while the menu is open, and the car can drive off before it closes
  // `shown` is the price on the menu: if the car took more damage while it was open, he names the new price instead of taking it
  private repair(c: Car, shown: number) {
    const { toast, wallet } = this.g;
    if (!this.onLift(c) || tooFastToGetOut(c)) return;
    const kr = this.repairQuote(c);
    if (typeof kr === 'number' && kr !== shown) this.openRepair(c);
    else if (typeof kr === 'string') toast(kr, 3.5);
    else if (!pay(wallet, kr)) toast(SHORT(kr), 3.5);
    else {
      c.dmg = 0;
      toast(OWNER_SAYS + '”Så där! Som ny. Nästan.” −' + fmtKr(kr) + '.', 4);
    }
  }

  /** The car you drive stands on the lift and has damage Plåt-Pelle would mend: his price, else null. */
  repairKr(): number | null {
    const c = this.g.game.pcar;
    if (!this.onLift(c)) return null;
    const kr = this.repairQuote(c);
    return typeof kr === 'number' ? kr || null : null;
  }

  /** The car you drive stands on the ring, and Skroten would make an offer for it. */
  buys() {
    const { game, atSkroten } = this.g;
    return !!(game.inCar && game.pcar && atSkroten() && typeof this.offer(game.pcar) === 'number');
  }

  // the offer is made again at the moment of sale: stars can come while the menu is open, and the car can drive off before it closes
  private sell(c: Car) {
    const { game, toast, wallet, sellCar, atSkroten } = this.g;
    if (game.pcar !== c || !atSkroten() || tooFastToGetOut(c)) return;
    const kr = this.offer(c);
    if (typeof kr === 'string') {
      toast(kr, 3.5);
      return;
    }
    sellCar(c);
    earn(wallet, kr);
    toast(OWNER_SAYS + '”Affärer ä affärer. Ja frågar inte var den kommer ifrån.” +' + fmtKr(kr) + '.', 4);
  }

  /** E by a car on his lot: his price on the menu plate, or a word about the police. */
  offerCar = (c: Car) => {
    const { stars, openMenu, toast, carName } = this.g;
    if (stars) {
      toast(CHASED, 3.5);
      return;
    }
    const kr = c.saleKr;
    openMenu(
      'skrot-buy',
      OWNER_SAYS + '”Den där ' + carName(c) + '? ' + fmtKr(kr) + ', å den ä din.”',
      [
        ['buy', 'Köp <small>' + fmtKr(kr) + '</small>'],
        ['no', 'Nä, inte idag'],
      ],
      k => {
        if (k === 'buy') this.buy(c);
      },
      () => this.standsByCar(c),
    );
  };

  // you stand on foot by the car for sale, with no police after you: what keeps his menu open
  private standsByCar(c: Car) {
    const { game, player, stars } = this.g;
    return !game.inCar && !stars && c.saleKr > 0 && Math.hypot(player.x - c.x, player.z - c.z) < SALE_REACH_M;
  }

  // all asked again at the moment of paying, as for a sale: stars can come while the menu is open, and you can walk off before it closes
  private buy(c: Car) {
    const { stars, toast, wallet } = this.g;
    if (!c.saleKr) return;
    if (!stars && !this.standsByCar(c)) return; // walked off or got in: no sale, and no word
    if (stars) {
      toast(CHASED, 3.5);
      return;
    }
    const kr = c.saleKr;
    if (!pay(wallet, kr)) toast(SHORT(kr), 3.5);
    else {
      c.saleKr = 0;
      c.owned = true;
      c.bought = true;
      toast(OWNER_SAYS + '”Affärer ä affärer! Den ä din nu. Kör försiktigt.” −' + fmtKr(kr) + '.', 4);
    }
  }
}

/** Skroten's cars for sale as the fleet parks them: in the world, at Plåt-Pelle's price. `typeOf` gives a model's type; a model without one is left out. */
export function carsForSale(lot: readonly YardCar[], typeOf: (model: string) => CarType | undefined): CarForSale[] {
  const out: CarForSale[] = [];
  for (const s of lot) {
    const type = typeOf(s.model),
      kr = type && salePrice(type, s.model);
    if (!type || !kr) continue;
    out.push({ ...yardToWorld(s.u, s.v), h: yardHeading(s.turn), type, model: s.model, colour: s.colour, kr });
  }
  return out;
}
