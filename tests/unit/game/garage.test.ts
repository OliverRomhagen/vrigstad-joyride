import { describe, expect, it } from 'vitest';
import type { Car } from '../../../src/game/cars';
import { Garage, type GarageDeps } from '../../../src/game/garage';
import type { MenuItem } from '../../../src/game/pets';
import { ENGINE_STEP, PAINTS, RIMS } from '../../../src/game/sim/car-mods';
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
  let onLift = true;
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
    changed: c => void calls.push('changed ' + JSON.stringify(c.mods)),
  };
  return {
    gr: new Garage(g),
    car,
    calls,
    wallet,
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

  it('paints the car when you pay, shows it at once, and brings the shelf back', () => {
    const t = garage({ kr: 1000 });
    t.gr.open();
    t.choose('paint');
    expect(t.menu().kind).toBe('garage-paint');
    t.choose('kiosk-gul');
    expect(t.car.mods).toEqual({ paint: 'kiosk-gul' });
    expect(t.wallet.kr).toBe(1000 - PAINTS['kiosk-gul'].kr);
    expect(t.calls[0]).toBe('changed {"paint":"kiosk-gul"}');
    expect(t.menu().kind).toBe('garage-paint');
    expect(t.menu().items.find(([k]) => k === 'kiosk-gul')![1]).toContain('på bilen');
  });

  it('keeps the parts already on the car when it fits another', () => {
    const t = garage({ kr: 5000, car: { mods: { glow: 'rosa' } } });
    t.gr.open();
    t.choose('rims');
    t.choose('krom');
    expect(t.car.mods).toEqual({ glow: 'rosa', rims: 'krom' });
    expect(t.wallet.kr).toBe(5000 - RIMS.krom.kr);
  });

  it("takes nothing and fits nothing when you can't pay", () => {
    const t = garage({ kr: 100 });
    t.gr.open();
    t.choose('engine');
    t.choose('1');
    expect(t.car.mods).toBeUndefined();
    expect(t.wallet.kr).toBe(100);
    expect(t.calls[0]).toContain('Kom tebaks när du har pengarna');
  });

  it('tunes the engine once', () => {
    const t = garage({ kr: 5000 });
    t.gr.open();
    t.choose('engine');
    t.choose('1');
    expect(t.car.mods).toEqual({ engine: 1 });
    expect(t.wallet.kr).toBe(5000 - ENGINE_STEP.kr);
    t.choose('1'); // already tuned: no second charge
    expect(t.wallet.kr).toBe(5000 - ENGINE_STEP.kr);
  });

  it('takes a part off again for free, and charges nothing to pick the one already on', () => {
    const t = garage({ kr: 0, car: { mods: { rims: 'guld', glow: 'bla' } } });
    t.gr.open();
    t.choose('rims');
    t.choose('guld');
    expect(t.car.mods).toEqual({ rims: 'guld', glow: 'bla' });
    expect(t.calls).toEqual([]);
    t.choose('off');
    expect(t.car.mods).toEqual({ glow: 'bla' });
    expect(t.wallet.kr).toBe(0);
  });

  it('fits nothing if the car has left the lift while the menu was open', () => {
    const t = garage({ kr: 1000 });
    t.gr.open();
    t.choose('glow');
    expect(t.menu().stay!()).toBe(true);
    t.driveOff();
    expect(t.menu().stay!()).toBe(false);
    t.choose('gron');
    expect(t.car.mods).toBeUndefined();
    expect(t.wallet.kr).toBe(1000);
  });

  it('goes back to the front from a shelf', () => {
    const t = garage();
    t.gr.open();
    t.choose('glow');
    t.choose('no');
    expect(t.menu().kind).toBe('garage');
  });
});
