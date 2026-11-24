import { describe, expect, it } from 'vitest';
import type { Car } from '../../../src/game/cars';
import { Garage, type GarageDeps } from '../../../src/game/garage';
import type { MenuItem } from '../../../src/game/pets';
import { type CarMods, ENGINE_STEP, PAINTS, RIMS } from '../../../src/game/sim/car-mods';
import { CHASED, NO_POLICE } from '../../../src/game/skroten';
import { newGameState } from '../../../src/game/state';

// You drive `car` onto the lift with `kr` in your wallet; `menu` is the last menu opened, `choose` picks from it.
function garage(o: { car?: Partial<Car>; kr?: number; stars?: number; repairKr?: number | null } = {}) {
  const calls: string[] = [];
  let open: {
    kind: string;
    title: string;
    items: MenuItem[];
    pick: (k: string) => void;
    stay?: (() => boolean) | null;
  };
  const car = { type: 'volvo', dmg: 0, x: 0, z: 0, v: 0, ...o.car } as Car;
  const game = { ...newGameState(), inCar: true, pcar: car as Car | null },
    wallet = { kr: o.kr ?? 0 };
  let onLift = true,
    shownNow: CarMods | null = null; // what the car shows, as rendering was last told
  const g: GarageDeps = {
    game,
    stars: o.stars ?? 0,
    openMenu: (kind, title, items, pick, stay) => {
      open = { kind, title, items, pick, stay };
    },
    toast: m => void calls.push('toast ' + m),
    wallet,
    onLift: c => onLift && c === car,
    repairKr: () => o.repairKr ?? null,
    repair: () => void calls.push('repair'),
    carName: () => 'Volvo 240',
    changed: (_c, shown) => {
      calls.push('shown ' + JSON.stringify(shown));
      shownNow = shown;
    },
  };
  return {
    gr: new Garage(g),
    car,
    calls,
    wallet,
    shown: () => shownNow,
    menu: () => open,
    keys: () => open.items.map(([k]) => k),
    choose: (k: string) => open.pick(k),
    driveOff: () => {
      onLift = false;
    },
  };
}

describe('Garage', () => {
  it('opens on the lift with a shelf for each kind of part, and repairs when the car is damaged', () => {
    const t = garage({ repairKr: 120 });
    expect(t.gr.available()).toBe(true);
    expect(t.gr.open()).toBe(true);
    expect(t.menu().kind).toBe('garage');
    expect(t.keys()).toEqual(['fix', 'paint', 'rims', 'glow', 'engine', 'no']);
    t.choose('fix');
    expect(t.calls).toEqual(['repair']);
  });

  it('offers no repair for a whole car', () => {
    const t = garage();
    t.gr.open();
    expect(t.keys()).not.toContain('fix');
  });

  it("doesn't open off the lift, for a police car, or with stars, and says why", () => {
    const off = garage();
    off.driveOff();
    expect(off.gr.available()).toBe(false);
    expect(off.gr.open()).toBe(false);
    const police = garage({ car: { type: 'polis' } });
    expect(police.gr.open()).toBe(false);
    expect(police.calls).toEqual(['toast ' + NO_POLICE]);
    const chased = garage({ stars: 1 });
    expect(chased.gr.available()).toBe(false);
    expect(chased.gr.open()).toBe(false);
    expect(chased.calls).toEqual(['toast ' + CHASED]);
  });

  it('shows a part on the car when you pick it, and takes the money only when you buy it', () => {
    const t = garage({ kr: 1000 });
    t.gr.open();
    t.choose('paint');
    expect(t.menu().kind).toBe('garage-paint');
    t.choose('kiosk-gul');
    expect(t.shown()).toEqual({ paint: 'kiosk-gul' }); // on show
    expect(t.car.mods).toBeUndefined(); // not bought
    expect(t.wallet.kr).toBe(1000);
    expect(t.keys()[0]).toBe('buy');
    expect(t.menu().items[0]![1]).toBe('Köp Kioskgul <small>600 riksdaler</small>');
    expect(t.menu().items.find(([k]) => k === 'kiosk-gul')![1]).toContain('provar');
    t.choose('buy');
    expect(t.car.mods).toEqual({ paint: 'kiosk-gul' });
    expect(t.wallet.kr).toBe(1000 - PAINTS['kiosk-gul'].kr);
    expect(t.menu().kind).toBe('garage-paint');
    expect(t.keys()).not.toContain('buy');
    expect(t.menu().items.find(([k]) => k === 'kiosk-gul')![1]).toContain('på bilen');
  });

  it('tries one part after another, and shows the car as it was when you go back without buying', () => {
    const t = garage({ kr: 1000, car: { mods: { glow: 'rosa' } } });
    t.gr.open();
    t.choose('rims');
    t.choose('krom');
    t.choose('guld');
    expect(t.shown()).toEqual({ glow: 'rosa', rims: 'guld' });
    t.choose('no');
    expect(t.shown()).toEqual({ glow: 'rosa' });
    expect(t.car.mods).toEqual({ glow: 'rosa' });
    expect(t.wallet.kr).toBe(1000);
    expect(t.menu().kind).toBe('garage');
  });

  it('takes a part off the car once the garage closes, however it closed', () => {
    const t = garage({ kr: 1000 });
    t.gr.open();
    t.choose('glow');
    t.choose('gron');
    t.gr.settle(true); // still open: stays on show
    expect(t.shown()).toEqual({ glow: 'gron' });
    t.gr.settle(false); // closed, by Esc, driving off or another menu
    expect(t.shown()).toEqual({});
    const shows = t.calls.length;
    t.gr.settle(false); // nothing on show any more: no more calls
    expect(t.calls).toHaveLength(shows);
  });

  it('keeps the parts already on the car when it buys another', () => {
    const t = garage({ kr: 5000, car: { mods: { glow: 'rosa' } } });
    t.gr.open();
    t.choose('rims');
    t.choose('krom');
    t.choose('buy');
    expect(t.car.mods).toEqual({ glow: 'rosa', rims: 'krom' });
    expect(t.wallet.kr).toBe(5000 - RIMS.krom.kr);
  });

  it("takes nothing when you can't pay, and keeps the part on show", () => {
    const t = garage({ kr: 100 });
    t.gr.open();
    t.choose('engine');
    t.choose('1');
    t.choose('buy');
    expect(t.car.mods).toBeUndefined();
    expect(t.wallet.kr).toBe(100);
    expect(t.calls.at(-1)).toContain('Kom tebaks när du har pengarna');
    expect(t.keys()[0]).toBe('buy');
  });

  it('tunes the engine once', () => {
    const t = garage({ kr: 5000 });
    t.gr.open();
    t.choose('engine');
    t.choose('1');
    t.choose('buy');
    expect(t.car.mods).toEqual({ engine: 1 });
    expect(t.wallet.kr).toBe(5000 - ENGINE_STEP.kr);
    t.choose('1'); // already tuned: nothing to try or buy
    expect(t.keys()).toEqual(['1', 'no']);
    expect(t.wallet.kr).toBe(5000 - ENGINE_STEP.kr);
  });

  it('takes a part off at once and for free, and picking the one on the car only stops trying', () => {
    const t = garage({ kr: 0, car: { mods: { rims: 'guld', glow: 'bla' } } });
    t.gr.open();
    t.choose('rims');
    t.choose('krom');
    t.choose('guld'); // the one it has: back to its own
    expect(t.shown()).toEqual({ rims: 'guld', glow: 'bla' });
    expect(t.keys()).not.toContain('buy');
    t.choose('off');
    expect(t.car.mods).toEqual({ glow: 'bla' });
    expect(t.shown()).toEqual({ glow: 'bla' });
    expect(t.wallet.kr).toBe(0);
  });

  it('sells nothing if the car has left the lift while the menu was open, and stops showing the part', () => {
    const t = garage({ kr: 1000 });
    t.gr.open();
    t.choose('glow');
    t.choose('gron');
    expect(t.menu().stay!()).toBe(true);
    t.driveOff();
    expect(t.menu().stay!()).toBe(false);
    t.choose('buy');
    expect(t.car.mods).toBeUndefined();
    expect(t.wallet.kr).toBe(1000);
    expect(t.shown()).toEqual({});
  });

  it('goes back to the front from a shelf', () => {
    const t = garage();
    t.gr.open();
    t.choose('glow');
    t.choose('no');
    expect(t.menu().kind).toBe('garage');
  });
});
