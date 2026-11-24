// The garage (#3, the `garage` lab experiment): Plåt-Pelle tunes and restyles the car you drive onto the workshop's lift.
// A part is paid for and put on the moment you pick it, so it shows on the car while the menu is still open, and the
// list comes back for the next one. Mending stays Skroten's (skroten.ts); this only offers it. No three.js or DOM here.
import type { Car } from './cars';
import { fmtKr, pay, type Wallet } from './economy';
import type { MenuItem } from './pets';
import { tooFastToGetOut } from './player';
import { type CarMods, ENGINE_STEP, GLOWS, PAINTS, RIMS } from './sim/car-mods';
import { CHASED, NO_POLICE, OWNER_SAYS } from './skroten';
import type { GameState } from './state';

/** What the garage reads from the rest of the game. */
export interface GarageDeps {
  game: Pick<GameState, 'inCar' | 'pcar'>;
  readonly stars: number;
  openMenu(
    kind: string,
    title: string,
    items: MenuItem[],
    pick: (k: string) => void,
    stay?: (() => boolean) | null,
  ): void;
  toast(msg: string, secs?: number): void;
  wallet: Wallet;
  onLift(c: Car | null): boolean; // the car you drive stands on the workshop's lift
  repairKr(): number | null; // what Plåt-Pelle asks to mend it; null when there's nothing to mend
  repair(): void; // his repair offer, on the menu plate
  carName(c: Car): string;
  changed(c: Car): void; // rendering puts the new parts on
}

type Shelf = 'paint' | 'rims' | 'glow' | 'engine';
// a part's key on the menu: its id, or OFF for taking it off again, which is free
const OFF = 'off';

/** Plåt-Pelle's garage on the workshop's lift. */
export class Garage {
  private readonly g: GarageDeps;

  constructor(g: GarageDeps) {
    this.g = g;
  }

  // the car you drive, on the lift, slow enough to get out of: what keeps a garage menu open
  private here(c: Car) {
    const { game, onLift } = this.g;
    return game.inCar && game.pcar === c && onLift(c) && !tooFastToGetOut(c);
  }

  // why he won't work on c, or null
  private refusal(c: Car) {
    if (this.g.stars) return CHASED;
    return c.type === 'polis' ? NO_POLICE : null;
  }

  /** The car you drive stands on the lift and he would work on it: what the prompt offers. */
  available() {
    const c = this.g.game.pcar;
    return !!c && this.g.game.inCar && this.g.onLift(c) && !this.refusal(c);
  }

  /** E on the lift: the garage's menu. False off the lift, or when he refuses (he says why), so E gets you out. */
  open = () => {
    const c = this.g.game.pcar;
    if (!c || !this.g.game.inCar || !this.g.onLift(c)) return false;
    const no = this.refusal(c);
    if (no) {
      this.g.toast(no, 3.5);
      return false;
    }
    this.front(c);
    return true;
  };

  private front(c: Car) {
    const { openMenu, repairKr, repair, carName } = this.g,
      kr = repairKr();
    const items: MenuItem[] = [
      ...(kr ? [['fix', 'Laga <small>' + fmtKr(kr) + '</small>'] as MenuItem] : []),
      ['paint', 'Lack'],
      ['rims', 'Fälgar'],
      ['glow', 'Neon under bilen'],
      ['engine', 'Motor'],
      ['no', 'Klar'],
    ];
    openMenu(
      'garage',
      OWNER_SAYS + '”En ' + carName(c) + ', va? Va ska vi göra mä den?”',
      items,
      k => {
        if (k === 'fix') repair();
        else if (k !== 'no') this.shelf(c, k as Shelf);
      },
      () => this.here(c),
    );
  }

  private shelf(c: Car, shelf: Shelf) {
    const mods = c.mods ?? {},
      items: MenuItem[] = [];
    const add = (id: string, name: string, kr: number, on: boolean) =>
      items.push([id, name + ' <small>' + (on ? 'på bilen' : kr ? fmtKr(kr) : 'gratis') + '</small>']);
    let title = OWNER_SAYS;
    if (shelf === 'paint') {
      title += '”Vilken färg? Ja lackar om den på en kafferast.”';
      for (const [id, p] of Object.entries(PAINTS)) add(id, p.name, p.kr, mods.paint === id);
      if (mods.paint) add(OFF, 'Originallacken', 0, false);
    } else if (shelf === 'rims') {
      title += '”Fälgar gör hela bilen, säjer ja alltid.”';
      for (const [id, r] of Object.entries(RIMS)) add(id, r.name, r.kr, mods.rims === id);
      if (mods.rims) add(OFF, 'Originalfälgarna', 0, false);
    } else if (shelf === 'glow') {
      title += '”Neon under bilen? Då ser dom dej ända från Torget.”';
      for (const [id, n] of Object.entries(GLOWS)) add(id, n.name, n.kr, mods.glow === id);
      if (mods.glow) add(OFF, 'Inget neon', 0, false);
    } else {
      title += mods.engine ? '”Den ä redan trimmad. Mer än så vågar inte ens ja.”' : '”Lite mer kräm i motorn?”';
      add('1', ENGINE_STEP.name, ENGINE_STEP.kr, !!mods.engine);
    }
    items.push(['no', 'Tebaks']);
    this.g.openMenu(
      'garage-' + shelf,
      title,
      items,
      k => (k === 'no' ? this.front(c) : this.fit(c, shelf, k)),
      () => this.here(c),
    );
  }

  // asked again at the moment of paying, as at Skroten: stars can come while the menu is open, and the car can drive off
  private fit(c: Car, shelf: Shelf, id: string) {
    const { toast, wallet, changed } = this.g;
    if (!this.here(c)) return;
    const no = this.refusal(c);
    if (no) {
      toast(no, 3.5);
      return;
    }
    const mods: CarMods = { ...c.mods },
      kr = price(shelf, id);
    if (kr === null || isOn(mods, shelf, id)) return this.shelf(c, shelf);
    if (!pay(wallet, kr)) {
      toast(OWNER_SAYS + '”' + fmtKr(kr) + ', sa ja. Kom tebaks när du har pengarna.”', 3.5);
      return this.shelf(c, shelf);
    }
    if (shelf === 'engine') mods.engine = 1;
    else if (id === OFF) delete mods[shelf];
    else Object.assign(mods, { [shelf]: id }); // price() has checked id is on this shelf
    c.mods = mods;
    changed(c);
    toast(OWNER_SAYS + (kr ? '”Så där! Snyggt, va?” −' + fmtKr(kr) + '.' : '”Bort mä dä. Ingen kostnad.”'), 3);
    this.shelf(c, shelf);
  }
}

/** What a part costs: OFF is free; null for a key that isn't on the shelf. */
function price(shelf: Shelf, id: string): number | null {
  if (shelf === 'engine') return id === '1' ? ENGINE_STEP.kr : null;
  if (id === OFF) return 0;
  const parts: Readonly<Record<string, { kr: number }>> = shelf === 'paint' ? PAINTS : shelf === 'rims' ? RIMS : GLOWS;
  return Object.hasOwn(parts, id) ? parts[id]!.kr : null;
}

// the car already has this part, or already has none of this kind
function isOn(mods: CarMods, shelf: Shelf, id: string) {
  if (shelf === 'engine') return !!mods.engine;
  return id === OFF ? !mods[shelf] : mods[shelf] === id;
}
