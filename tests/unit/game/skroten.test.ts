import { describe, expect, it } from 'vitest';
import type { Car } from '../../../src/game/cars';
import type { MenuItem } from '../../../src/game/pets';
import { Skroten, type SkrotenDeps } from '../../../src/game/skroten';
import { newGameState } from '../../../src/game/state';

// You drive `car` onto Skroten's ring with `stars`; `open` holds the last menu, `choose` picks from it.
function skroten(o: { car?: Partial<Car>; model?: string; stars?: number } = {}) {
  const calls: string[] = [];
  let open: {
    kind: string;
    title: string;
    items: MenuItem[];
    pick: (k: string) => void;
    stay?: (() => boolean) | null;
  } | null = null;
  const car = { type: 'volvo', dmg: 0, ...o.car } as Car;
  const game = { ...newGameState(), inCar: true, pcar: car as Car | null },
    wallet = { kr: 0 };
  let onRing = true;
  const g: SkrotenDeps = {
    game,
    stars: o.stars ?? 0,
    openMenu: (kind, title, items, pick, stay) => {
      open = { kind, title, items, pick, stay };
    },
    toast: m => void calls.push('toast ' + m),
    atSkroten: () => onRing,
    modelId: () => o.model,
    earn: kr => {
      wallet.kr += kr;
    },
    sellCar: c => {
      calls.push('sold ' + c.type);
      game.inCar = false;
      game.pcar = null;
    },
  };
  return {
    s: new Skroten(g),
    g,
    calls,
    game,
    wallet,
    menu: () => open,
    choose: (k: string) => open!.pick(k),
    leaveRing: () => {
      onRing = false;
    },
  };
}

describe('Skroten', () => {
  it('offers a price for the car by its model and damage, and pays it when you sell', () => {
    const t = skroten({ model: 'volvo240', car: { dmg: 50 } });
    t.s.open();
    expect(t.menu()!.title).toBe('”Den där? Ja ger dej 450 riksdaler för den.”');
    t.choose('sell');
    expect(t.wallet.kr).toBe(450);
    expect(t.calls[0]).toBe('sold volvo');
    expect(t.game.inCar).toBe(false);
  });

  it('keeps the car when you say no', () => {
    const t = skroten();
    t.s.open();
    t.choose('no');
    expect(t.wallet.kr).toBe(0);
    expect(t.game.inCar).toBe(true);
  });

  it('refuses with the police after you, and never buys a police car', () => {
    const chased = skroten({ stars: 1 });
    chased.s.open();
    expect(chased.menu()).toBeNull();
    expect(chased.calls[0]).toContain('Inte mä snuten i hälarna!');
    const polis = skroten({ car: { type: 'polis' } });
    polis.s.open();
    expect(polis.menu()).toBeNull();
    expect(polis.calls[0]).toContain('En polisbil?');
  });

  it('makes the offer again at the sale: stars that came while the menu was open stop it', () => {
    const t = skroten();
    t.s.open();
    (t.g as { stars: number }).stars = 1;
    t.choose('sell');
    expect(t.wallet.kr).toBe(0);
    expect(t.game.inCar).toBe(true);
  });

  it('keeps the menu open only while that car stands on the ring', () => {
    const t = skroten();
    t.s.open();
    const stay = t.menu()!.stay!;
    expect(stay()).toBe(true);
    t.leaveRing();
    expect(stay()).toBe(false);
  });
});
