// Skroten buys the car you drive in (#76): drive onto its ring, press E, and Plåt-Pelle makes an offer by the car's model and damage.
// He mends, upgrades and paints the car you drive onto the workshop's lift (special paints and decals too), and sells the cars on his lot: press E by one for his price. Neither with the police after you, and he never buys a police car.
// On foot you can talk to him. main.ts passes in the menu plate, the wallet and what happens to the car. No three.js or DOM here.
import type { Car, CarForSale } from './cars';
import {
  carPrice,
  DECAL_KR,
  earn,
  fmtKr,
  pay,
  RESPRAY_KR,
  repairPrice,
  SPECIAL_PAINT_KR,
  salePrice,
  UPGRADE_KR,
  type Wallet,
} from './economy';
import type { MenuItem } from './pets';
import { tooFastToGetOut } from './player';
import { DECAL_NAMES, DECAL_ORDER, type Decal, WORKSHOP_PAINTS } from './sim/paint-jobs';
import { UPGRADE_ORDER, UPGRADES, type Upgrade } from './sim/upgrades';
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
const UPGRADE_NAMES: Readonly<Record<Upgrade, string>> = {
  engine: 'Trimma motorn',
  springs: 'Sportfjädring',
  body: 'Förstärkt kaross',
};
const UPGRADE_DONE: Readonly<Record<Upgrade, string>> = {
  engine: '”Nu går ho! Säj inte till snuten va ja gjort.”',
  springs: '”Nu ligger ho som klistrad på vägen.”',
  body: '”Ja har svetsat in lite extra plåt. Nu tål ho en smäll.”',
};
const DECAL_DONE: Readonly<Record<Decal, string>> = {
  flames: '”Flammor! Nu ser den snabb ut, i alla fall.”',
  stripes: '”Rallyränder. Nu ä dä bara å hitta en grusväg.”',
  'rally-number': '”Sextinie. Dä va mitt nummer när ja körde folkrace. Hehe.”',
};
const EPA_TUNED =
  '”En trimmad EPA? Dä har ja aldrig gjort förut. Aldrig nånsin. Å knappen under ratten har du inte fått av mej.”'; // the key for the switch is on the speed plate (prompt.ts)
/** What he says when you talk to him on foot, one after the other. */
export const OWNER_LINES = [
  '”Tjena! Har du nån bil du vill bli av mä? Kör in den på ringen.”',
  '”Ja köper allt som rullar. Å dä mesta som inte gör dä.”',
  '”Polisbilar rör ja inte. Ja ä inte dum.”',
  '”Bilarna vid skylten å under taket ä till salu. Fint skick. Nästan.”',
  '”Ä bilen tilltufsad? Kör in den på lyften i verkstan, så lagar ja den.”',
  '”Vill du ha mer fart i kärran? Lyften, i verkstan. Ja trimmar allt.”',
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
  getOut(): void; // puts you on foot beside the car you drive
}

// one choice on a lift menu: its key, its line, its price, and the job, which says what he says
interface LiftChoice {
  key: string;
  label: string;
  kr: number;
  done: () => string;
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

  // why Plåt-Pelle won't touch c on the lift, or null when he will
  private refusesLift(c: Car): string | null {
    if (this.g.stars) return CHASED;
    return repairPrice(c.type, this.g.modelId(c), 0) === null ? NO_POLICE : null;
  }

  // what he asks to mend c: 0 for a whole car
  private repairKr(c: Car) {
    return repairPrice(c.type, this.g.modelId(c), c.dmg) ?? 0;
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
   * E on the ring: Skroten's offer for the car you drive, on the menu plate; on the lift, the work he'll do on it. False when there is none:
   * elsewhere, or refused (it says why).
   */
  open = () => {
    const { game, openMenu, toast, atSkroten } = this.g,
      c = game.pcar;
    if (this.onLift(c)) return this.openLift(c);
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

  // the lift's menu: mending, the upgrades the car hasn't got, a respray, his special paints and decals; it comes back after each job, for the next
  private openLift(c: Car) {
    const { openMenu, toast, carName } = this.g,
      no = this.refusesLift(c);
    if (no) {
      if (c.dmg > 0) toast(no, 3.5); // a whole car: E gets you out, as the prompt says, without a word every time
      return false;
    }
    const fix = this.repairKr(c),
      items: MenuItem[] = [];
    if (fix) items.push(['fix', 'Laga <small>' + fmtKr(fix) + '</small>']);
    for (const u of UPGRADE_ORDER)
      if (!c.mods[u])
        items.push([u, UPGRADE_NAMES[u] + ' <small>' + fmtKr(UPGRADE_KR[u]) + ' · ' + upgradeHelp(u, c) + '</small>']);
    if (otherPaints(c).length) items.push(['paint', 'Lacka om <small>' + fmtKr(RESPRAY_KR) + '</small>']);
    items.push(['special', 'Speciallack <small>' + fmtKr(SPECIAL_PAINT_KR) + ' · only here</small>']);
    if (c.type !== 'traktor') items.push(['decal', 'Dekor <small>' + fmtKr(DECAL_KR) + ' · only here</small>']); // a tractor has no panels to paint them on
    items.push(['out', 'Kliv ur'], ['no', 'Nä, dä får va']); // E on the lift opens this menu, so getting out is on it
    openMenu(
      'skrot-lift',
      OWNER_SAYS +
        (fix
          ? '”Den där ' + carName(c) + ' ä allt tilltufsad. ' + fmtKr(fix) + ', så blir den som ny.”'
          : '”Fin ' + carName(c) + '! Va ska ja göra mä den?”'),
      items,
      k => {
        if (k === 'paint') this.openPaint(c);
        else if (k === 'special') this.openSpecialPaint(c);
        else if (k === 'decal') this.openDecal(c);
        else if (k === 'out') {
          if (this.readyOnLift(c)) this.g.getOut(); // as E asks: the menu's stay() runs only now and then
        } else if (k === 'fix' ? this.repair(c, fix) : isUpgrade(k) && this.upgrade(c, k)) this.openLift(c);
      },
      () => this.readyOnLift(c),
    );
    return true;
  }

  private openPaint(c: Car) {
    this.openChoices(
      c,
      'skrot-paint',
      '”Vicken färg ska den ha? ' + fmtKr(RESPRAY_KR) + ', vilken du vill.”',
      otherPaints(c).map((p, i) => ({
        key: 'p' + i,
        label: swatch(p) + paintName(p),
        kr: RESPRAY_KR,
        done: () => {
          c.color = p;
          return '”Snyggt! Som från fabriken.”';
        },
      })),
      'Nä, den ä fin som den ä',
    );
  }

  // his special paints, which only this lift sells
  private openSpecialPaint(c: Car) {
    this.openChoices(
      c,
      'skrot-special',
      '”Specialfäääj! De kan du inte hitta nån annanstans. ' +
        fmtKr(SPECIAL_PAINT_KR) +
        ', å du får det fräsigaste åket i stan.”',
      WORKSHOP_PAINTS.filter(p => p.paint !== c.color).map(({ paint, name }, i) => ({
        key: 'p' + i,
        label: swatch(paint) + name,
        kr: SPECIAL_PAINT_KR,
        done: () => {
          c.color = paint;
          return '”' + name + '! Den kommer folk å prata om.”';
        },
      })),
      'Nä, inte idag',
    );
  }

  // his decals, and taking one off for free
  private openDecal(c: Car) {
    const put = (decal: Decal | null) => () => {
      c.decal = decal;
      return decal ? DECAL_DONE[decal] : '”Bort mä den. Dä kostar inget.”';
    };
    const choices: LiftChoice[] = DECAL_ORDER.filter(d => d !== c.decal).map(d => ({
      key: d,
      label: DECAL_NAMES[d],
      kr: DECAL_KR,
      done: put(d),
    }));
    if (c.decal) choices.push({ key: 'off', label: 'Ta bort dekoren <small>free</small>', kr: 0, done: put(null) });
    this.openChoices(
      c,
      'skrot-decal',
      '”Lite dekor? ' + fmtKr(DECAL_KR) + '. Ja målar för hand, så den blir som ingen annans.”',
      choices,
      'Nä, inte idag',
    );
  }

  // one of the lift's smaller menus: a job per choice, then back to the lift's menu, as `no` goes back without one
  private openChoices(c: Car, kind: string, says: string, choices: readonly LiftChoice[], no: string) {
    this.g.openMenu(
      kind,
      OWNER_SAYS + says,
      [...choices.map((ch): MenuItem => [ch.key, ch.label]), ['no', no]],
      k => {
        const ch = choices.find(x => x.key === k);
        if (ch ? this.work(c, ch.kr, ch.done) : k === 'no') this.openLift(c);
      },
      () => this.readyOnLift(c),
    );
  }

  // the car stands still on the lift: what keeps its menus open, and what a job or getting out asks first
  private readyOnLift(c: Car) {
    return this.onLift(c) && !tooFastToGetOut(c);
  }

  // each job is checked and priced again at the moment of paying: stars can come while the menu is open, and the car can drive off
  // before it closes. `done` does the job once it's paid for, and says what he says. True when it was done.
  private work(c: Car, kr: number, done: () => string): boolean {
    const { toast, wallet } = this.g;
    if (!this.readyOnLift(c)) return false;
    const no = this.refusesLift(c);
    if (no) toast(no, 3.5);
    else if (!pay(wallet, kr)) toast(SHORT(kr), 3.5);
    else {
      toast(OWNER_SAYS + done() + (kr ? ' −' + fmtKr(kr) + '.' : ''), 4);
      return true;
    }
    return false;
  }

  // `shown` is the price on the menu: if the car took more damage while it was open, he names the new price instead of taking it
  private repair(c: Car, shown: number) {
    const kr = this.repairKr(c);
    if (kr !== shown) {
      if (this.onLift(c)) this.openLift(c);
      return false;
    }
    return (
      !!kr &&
      this.work(c, kr, () => {
        c.dmg = 0;
        return '”Så där! Som ny. Nästan.”';
      })
    );
  }

  private upgrade(c: Car, u: Upgrade) {
    return (
      !c.mods[u] &&
      this.work(c, UPGRADE_KR[u], () => {
        c.mods[u] = true;
        return u === 'engine' && c.type === 'epa' ? EPA_TUNED : UPGRADE_DONE[u];
      })
    );
  }

  /** The car you drive stands on the lift, and Plåt-Pelle would work on it: his price to mend it (0 for a whole car), else null. */
  liftRepairKr(): number | null {
    const c = this.g.game.pcar;
    return this.onLift(c) && !this.refusesLift(c) ? this.repairKr(c) : null;
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

// a paint's colour as a square in the menu
const swatch = (paint: string) => '<i class="swatch" style="--paint:' + paint + '"></i>';

const isUpgrade = (k: string): k is Upgrade => (UPGRADE_ORDER as readonly string[]).includes(k);
const pct = (share: number) => Math.round(share * 100) + ' %';

// what an upgrade does, from its numbers now (the tunables can change them)
function upgradeHelp(u: Upgrade, c: Car) {
  if (u === 'engine' && c.type === 'epa') return Math.round(UPGRADES.EPA_TOP_MS * 3.6) + ' km/h · a limiter switch';
  if (u === 'engine') return '+' + pct(UPGRADES.ENGINE_TOP - 1) + ' top speed';
  if (u === 'springs') return 'grips and steers better';
  return pct(1 - UPGRADES.BODY_DAMAGE) + ' less crash damage';
}

// the colours a respray can give c: its type's other paints (he turns police cars away before this: refusesLift)
const otherPaints = (c: Car) => c.T.cols.filter(p => p !== c.color);

/** A paint's name in Swedish, as Plåt-Pelle would say it: from its hue and how light it is. `paint` is #rrggbb. */
export function paintName(paint: string): string {
  const n = Number.parseInt(paint.slice(1), 16),
    r = (n >> 16) / 255,
    g = ((n >> 8) & 255) / 255,
    b = (n & 255) / 255,
    hi = Math.max(r, g, b),
    lo = Math.min(r, g, b),
    chroma = hi - lo,
    light = (hi + lo) / 2;
  if (chroma < 0.1) return light < 0.2 ? 'Svart' : light > 0.78 ? 'Vit' : light < 0.4 ? 'Mörkgrå' : 'Grå';
  let hue = hi === r ? ((g - b) / chroma) % 6 : hi === g ? (b - r) / chroma + 2 : (r - g) / chroma + 4;
  hue = (hue * 60 + 360) % 360;
  if (hue >= 25 && hue < 65 && chroma < 0.25 && light > 0.55) return 'Beige';
  const name =
    hue < 15 || hue >= 330
      ? 'röd'
      : hue < 40
        ? 'orange'
        : hue < 70
          ? 'gul'
          : hue < 165
            ? 'grön'
            : hue < 255
              ? 'blå'
              : hue < 290
                ? 'lila'
                : 'rosa';
  if (name === 'röd' && light < 0.36) return 'Vinröd';
  const shade = light < 0.3 ? 'mörk' : light > 0.7 ? 'ljus' : '';
  return shade ? shade[0]!.toUpperCase() + shade.slice(1) + name : name[0]!.toUpperCase() + name.slice(1);
}
