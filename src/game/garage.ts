// Plåt-Pelle's garage (#3), the lab experiment ?lab=garage: the lift's jobs on one screen, where what you pick shows on the car
// before you pay, and one bill pays for it all. Skroten (skroten.ts) still prices, refuses and does each job; this keeps the
// choices and the try-on. garage-hud.ts draws it. No three.js or DOM here.
import type { Car } from './cars';
import { fmtKr, type Wallet } from './economy';
import { tooFastToGetOut } from './player';
import type { Decal } from './sim/paint-jobs';
import {
  accelOf,
  type CarMods,
  damageShare,
  gripShare,
  hasLimiterSwitch,
  topSpeedOf,
  type Upgrade,
} from './sim/upgrades';
import type { LiftJob, LiftOffer, Skroten } from './skroten';
import type { GameState } from './state';

export type GarageCat = 'fix' | Upgrade | 'paint' | 'special' | 'decal';
export const GARAGE_TABS = [
  { id: 'work', label: 'Verkstan', cats: ['fix', 'engine', 'springs', 'body'] },
  { id: 'paint', label: 'Lack & dekor', cats: ['paint', 'special', 'decal'] },
] as const satisfies readonly { id: string; label: string; cats: readonly GarageCat[] }[];
export type GarageTab = (typeof GARAGE_TABS)[number]['id'];
export const CAT_LABELS: Readonly<Record<GarageCat, string>> = {
  fix: 'Laga',
  engine: 'Motor',
  springs: 'Fjädring',
  body: 'Kaross',
  paint: 'Lack',
  special: 'Speciallack',
  decal: 'Dekor',
};
const MANY_DONE = '”Klart! Den känner du knappt igen. Snuten inte heller, hoppas ja.”';
const KMH_PER_MS = 3.6;
// where each stat's bar is full: a little over the best a car on the lift gets to
const BAR_TOP_KMH = 200,
  BAR_ACC = 14,
  BAR_GRIP = 1.6;

/** A choice on the open shelf, as the HUD draws it. */
export interface GarageChoice {
  name: string;
  help: string;
  price: string; // 'Fitted' for what the car has, else its price
  swatch: string | null; // a paint's colour
  picked: boolean;
  locked: boolean; // can't be picked: an upgrade doesn't come off again
}
/** One row of what the picks do to the car: now, and with what's picked. Shares are 0–1, for a bar. */
export interface GarageStat {
  label: string;
  from: string;
  to: string;
  fromShare: number;
  toShare: number;
  better: boolean; // the picks improve it, or leave it
}
type Choice = { choice: GarageChoice; set(): void };

/** What the garage reads from the rest of the game. */
export interface GarageDeps {
  skroten: Pick<Skroten, 'liftOffer' | 'liftJob' | 'lift'>;
  game: Pick<GameState, 'pcar'>;
  wallet: Wallet;
  carName(c: Car): string;
}

/** The garage's state: the car on the lift, the open shelf, and what you've picked for it. */
export class Garage {
  private readonly g: GarageDeps;
  private c: Car | null = null;
  private offer: LiftOffer | null = null;
  private own = { color: '', decal: null as Decal | null }; // the car's look before any try-on
  private want = {
    fix: false,
    mods: { engine: false, springs: false, body: false } as CarMods,
    paint: '',
    decal: null as Decal | null,
  };
  private said: string | null = null;
  tab: GarageTab = 'work';
  cat: GarageCat = 'fix';
  version = 0; // goes up whenever what the HUD draws changes

  constructor(g: GarageDeps) {
    this.g = g;
  }

  get isOpen() {
    return !!this.c;
  }
  get car() {
    return this.c;
  }

  /** Opens on the car on the lift: false when Plåt-Pelle won't work on it. */
  open(c: Car): boolean {
    const offer = this.g.skroten.liftOffer(c);
    if (typeof offer === 'string') return false;
    this.c = c;
    this.load(offer);
    this.tab = 'work';
    this.cat = offer.fixKr ? 'fix' : 'engine';
    this.said = null;
    this.version++;
    return true;
  }

  /** Closes, and puts the car's own look back on it. */
  close() {
    if (!this.c) return;
    this.tryOn(this.own.color, this.own.decal);
    this.c = null;
    this.offer = null;
    this.version++;
  }

  /** Every frame: closes once the car leaves the lift, drives off, or the police come (he won't work then). */
  settle() {
    const c = this.c;
    if (c && (this.g.game.pcar !== c || this.g.skroten.lift() === null || tooFastToGetOut(c))) this.close();
  }

  setTab(id: GarageTab) {
    const tab = GARAGE_TABS.find(t => t.id === id);
    if (!tab) return;
    this.tab = id;
    this.cat = tab.cats[0];
    this.said = null;
    this.version++;
  }
  stepTab(d: 1 | -1) {
    const i = GARAGE_TABS.findIndex(t => t.id === this.tab);
    this.setTab(GARAGE_TABS[(i + d + GARAGE_TABS.length) % GARAGE_TABS.length]!.id);
  }
  setCat(cat: GarageCat) {
    this.cat = cat;
    this.said = null;
    this.version++;
  }
  stepCat(d: 1 | -1) {
    const cats = this.cats(),
      i = cats.indexOf(this.cat);
    this.setCat(cats[(i + d + cats.length) % cats.length]!);
  }
  /** The open tab's shelves. */
  cats(): readonly GarageCat[] {
    return GARAGE_TABS.find(t => t.id === this.tab)!.cats;
  }

  /** What the open shelf offers. */
  choices(): GarageChoice[] {
    return this.shelf().map(s => s.choice);
  }
  /** What's picked on a shelf, for the menu of shelves. */
  pickedName(cat: GarageCat): string {
    return this.shelf(cat).find(s => s.choice.picked)?.choice.name ?? '';
  }
  /** The shelf has a pick that isn't on the car yet. */
  changed(cat: GarageCat): boolean {
    const w = this.want;
    if (cat === 'fix') return w.fix;
    if (cat === 'paint' || cat === 'special')
      return w.paint !== this.own.color && this.isSpecial(w.paint) === (cat === 'special');
    if (cat === 'decal') return w.decal !== this.own.decal;
    return w.mods[cat] !== this.c?.mods[cat];
  }

  /** Picks the i-th choice on the open shelf, and tries it on. */
  pick(i: number) {
    const s = this.shelf()[i];
    if (!s || s.choice.locked) return;
    s.set();
    this.tryOn(this.want.paint, this.want.decal);
    this.said = null;
    this.version++;
  }

  /** Takes every pick back off. */
  undo() {
    if (!this.c || !this.offer) return;
    this.tryOn(this.own.color, this.own.decal); // load reads the car's own look off the car
    this.load(this.offer);
    this.said = null;
    this.version++;
  }

  /** The jobs picked and what they cost together. */
  bill(): { jobs: number; kr: number } {
    const jobs = this.jobs();
    return { jobs: jobs.length, kr: jobs.reduce((s, j) => s + j.kr, 0) };
  }

  /** Pays for every pick: Skroten does each job, asked again now. False when nothing was done. */
  pay(): boolean {
    const c = this.c,
      jobs = this.jobs(),
      kr = jobs.reduce((s, j) => s + j.kr, 0);
    if (!c || !jobs.length) return false;
    if (kr > this.g.wallet.kr) {
      this.said = '”' + fmtKr(kr) + ', sa ja. Kom tebaks när du har pengarna.”';
      this.version++;
      return false;
    }
    this.tryOn(this.own.color, this.own.decal); // he paints from the car's own look, as on his menus
    let done = 0;
    for (const { job } of jobs) if (this.g.skroten.liftJob(c, job)) done++;
    const offer = this.g.skroten.liftOffer(c);
    if (typeof offer === 'string') this.close();
    else {
      this.load(offer);
      this.said = done > 1 ? MANY_DONE : null;
      this.version++;
    }
    return done > 0;
  }

  /** What Plåt-Pelle says over the shelf. */
  line(): string {
    if (this.said) return this.said;
    const { kr } = this.bill();
    if (kr > this.g.wallet.kr) return '”' + fmtKr(kr) + ', sa ja. Kom tebaks när du har pengarna.”';
    const c = this.c,
      o = this.offer;
    if (!c || !o) return '';
    const price = (cat: 'paint' | 'special') => fmtKr(o.paints.find(p => p.special === (cat === 'special'))?.kr ?? 0);
    switch (this.cat) {
      case 'fix':
        return o.fixKr
          ? '”Den där ' + this.g.carName(c) + ' ä allt tilltufsad. ' + fmtKr(o.fixKr) + ', så blir den som ny.”'
          : '”Fin ' + this.g.carName(c) + '! Va ska ja göra mä den?”';
      case 'engine':
        return c.type === 'epa'
          ? '”En trimmad EPA? Dä har ja aldrig gjort förut. Aldrig nånsin.”'
          : '”Vill du ha mer fart i kärran? Ja trimmar allt.”';
      case 'springs':
        return '”Sportfjädring, så ligger ho som klistrad på vägen.”';
      case 'body':
        return '”Lite extra plåt i dörrarna, så tål ho en smäll.”';
      case 'paint':
        return '”Vicken färg ska den ha? ' + price('paint') + ', vilken du vill.”';
      case 'special':
        return '”Dom här har ingen annan. ' + price('special') + ', å du blir ensam i stan om färgen.”';
      case 'decal':
        return o.decals.length
          ? '”Lite dekor? Ja målar för hand, så den blir som ingen annans.”'
          : '”På en traktor? Dä finns ju ingen plåt å måla på.”';
    }
  }

  /** What the picks do to the car, now → with them. */
  stats(): GarageStat[] {
    const c = this.c;
    if (!c) return [];
    const now = c,
      next = { ...c, mods: this.want.mods },
      kmh = (x: Car) => Math.round(topSpeedOf(x) * KMH_PER_MS),
      pct = (v: number) => Math.round(v * 100) + ' %';
    const row = (
      label: string,
      a: number,
      b: number,
      full: number,
      fa: string,
      fb: string,
      lowerIsBetter = false,
    ): GarageStat => ({
      label,
      from: fa,
      to: fb,
      fromShare: Math.min(1, a / full),
      toShare: Math.min(1, b / full),
      better: lowerIsBetter ? b <= a : b >= a,
    });
    const [ta, tb] = [kmh(now), kmh(next)],
      [aa, ab] = [accelOf(now), accelOf(next)],
      [ga, gb] = [gripShare(now.mods), gripShare(next.mods)],
      [da, db] = [damageShare(now.mods), damageShare(next.mods)];
    return [
      row('Toppfart', ta, tb, BAR_TOP_KMH, ta + ' km/h', tb + ' km/h'),
      row('Acceleration', aa, ab, BAR_ACC, aa.toFixed(1) + ' m/s²', ab.toFixed(1) + ' m/s²'),
      row('Grepp', ga, gb, BAR_GRIP, pct(ga), pct(gb)),
      row('Krockskada', da, db, 1, pct(da), pct(db), true),
    ];
  }

  /** A tuned EPA-traktor's switch, which the picks would give it: a line for under the stats, or null. */
  note(): string | null {
    const c = this.c;
    return c && !hasLimiterSwitch(c) && hasLimiterSwitch({ type: c.type, mods: this.want.mods })
      ? 'T flips the limiter under the wheel: a Volvo’s top speed.'
      : null;
  }

  private load(offer: LiftOffer) {
    const c = this.c!;
    this.offer = offer;
    this.own = { color: c.color, decal: c.decal };
    this.want = { fix: false, mods: { ...c.mods }, paint: c.color, decal: c.decal };
    this.tryOn(c.color, c.decal);
  }

  private tryOn(color: string, decal: Decal | null) {
    if (!this.c) return;
    this.c.color = color;
    this.c.decal = decal;
  }

  private isSpecial(paint: string) {
    return !!this.offer?.paints.find(p => p.paint === paint)?.special;
  }

  private jobs(): { job: LiftJob; kr: number }[] {
    const o = this.offer,
      c = this.c,
      w = this.want,
      out: { job: LiftJob; kr: number }[] = [];
    if (!o || !c) return out;
    if (w.fix && o.fixKr) out.push({ job: { kind: 'fix' }, kr: o.fixKr });
    for (const u of o.upgrades)
      if (w.mods[u.upgrade] && !u.fitted) out.push({ job: { kind: 'upgrade', upgrade: u.upgrade }, kr: u.kr });
    const paint = o.paints.find(p => p.paint === w.paint);
    if (w.paint !== this.own.color && paint) out.push({ job: { kind: 'paint', paint: w.paint }, kr: paint.kr });
    if (w.decal !== this.own.decal)
      out.push({
        job: { kind: 'decal', decal: w.decal },
        kr: w.decal ? (o.decals.find(d => d.decal === w.decal)?.kr ?? 0) : 0,
      });
    return out;
  }

  // the choices on a shelf, each with what picking it does
  private shelf(cat: GarageCat = this.cat): Choice[] {
    const o = this.offer,
      c = this.c,
      w = this.want;
    if (!o || !c) return [];
    const choice = (
      name: string,
      help: string,
      price: string,
      picked: boolean,
      extra: Partial<GarageChoice> = {},
    ): GarageChoice => ({
      name,
      help,
      price,
      swatch: null,
      picked,
      locked: false,
      ...extra,
    });
    if (cat === 'fix') {
      if (!o.fixKr) return [{ choice: choice('Hel', 'Not a dent on it', 'Fitted', true), set: () => {} }];
      return [
        {
          choice: choice('Som den ä', 'Dents and all', '', !w.fix),
          set: () => {
            w.fix = false;
          },
        },
        {
          choice: choice('Laga', 'Mends every dent', fmtKr(o.fixKr), w.fix),
          set: () => {
            w.fix = true;
          },
        },
      ];
    }
    if (cat === 'paint' || cat === 'special') {
      return o.paints
        .filter(p => p.special === (cat === 'special'))
        .map(p => {
          const own = p.paint === this.own.color;
          return {
            choice: choice(
              p.name,
              own ? 'The paint it has' : p.special ? 'Only at Plåt-Pelle’s' : 'A full respray',
              own ? 'Fitted' : fmtKr(p.kr),
              w.paint === p.paint,
              {
                swatch: p.paint,
              },
            ),
            set: () => {
              w.paint = p.paint;
            },
          };
        });
    }
    if (cat === 'decal') {
      const none: Choice = {
        choice: choice(
          'Ingen',
          o.decals.length ? 'Just paint' : 'A tractor has no panels for one',
          this.own.decal === null ? 'Fitted' : 'Free',
          w.decal === null,
        ),
        set: () => {
          w.decal = null;
        },
      };
      return [
        none,
        ...o.decals.map(d => ({
          choice: choice(
            d.name,
            'Painted by hand',
            this.own.decal === d.decal ? 'Fitted' : fmtKr(d.kr),
            w.decal === d.decal,
          ),
          set: () => {
            w.decal = d.decal;
          },
        })),
      ];
    }
    const u = o.upgrades.find(x => x.upgrade === cat)!;
    return [
      {
        choice: choice(
          'Standard',
          u.fitted ? 'Doesn’t come off again' : 'As it is',
          u.fitted ? '' : 'Fitted',
          !w.mods[cat],
          { locked: u.fitted },
        ),
        set: () => {
          w.mods[cat] = false;
        },
      },
      {
        choice: choice(u.name, u.help, u.fitted ? 'Fitted' : fmtKr(u.kr), w.mods[cat]),
        set: () => {
          w.mods[cat] = true;
        },
      },
    ];
  }
}
