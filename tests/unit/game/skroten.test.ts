import { describe, expect, it } from 'vitest';
import type { Car } from '../../../src/game/cars';
import { fmtKr } from '../../../src/game/economy';
import type { MenuItem } from '../../../src/game/pets';
import { carsForSale, OWNER_LINES, Skroten, type SkrotenDeps } from '../../../src/game/skroten';
import { OWNER_UV, type YardCar, yardHeading, yardToWorld } from '../../../src/game/skroten-yard';
import { newGameState } from '../../../src/game/state';

const LIFT = { x: 50, z: 0 };

// You drive `car` onto Skroten's ring with `stars`; `open` holds the last menu, `choose` picks from it.
function skroten(o: { car?: Partial<Car>; model?: string; stars?: number; kr?: number } = {}) {
  const calls: string[] = [];
  let open: {
    kind: string;
    title: string;
    items: MenuItem[];
    pick: (k: string) => void;
    stay?: (() => boolean) | null;
  } | null = null;
  const car = { type: 'volvo', dmg: 0, x: 0, z: 0, v: 0, ...o.car } as Car;
  const game = { ...newGameState(), inCar: true, pcar: car as Car | null },
    wallet = { kr: o.kr ?? 0 };
  let onRing = true;
  const g: SkrotenDeps = {
    game,
    player: { x: 0, z: 0 },
    stars: o.stars ?? 0,
    openMenu: (kind, title, items, pick, stay) => {
      open = { kind, title, items, pick, stay };
    },
    toast: m => void calls.push('toast ' + m),
    atSkroten: () => onRing,
    liftAt: LIFT,
    modelId: () => o.model,
    carName: () => 'Volvo 240',
    wallet,
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
    driveOntoLift: () => {
      onRing = false;
      car.x = LIFT.x + 1;
      car.z = LIFT.z;
    },
  };
}

describe('Skroten', () => {
  it('offers a price for the car by its model and damage, and pays it when you sell', () => {
    const t = skroten({ model: 'volvo240', car: { dmg: 50 } });
    t.s.open();
    expect(t.menu()!.title).toBe('Plåt-Pelle: ”Den där? Ja ger dej 450 riksdaler för den.”');
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

  it('lets you talk to Plåt-Pelle on foot beside him, one line after the other', () => {
    const t = skroten(),
      at = yardToWorld(OWNER_UV.u, OWNER_UV.v);
    Object.assign(t.g.player, { x: at.x + 2.9, z: at.z });
    expect(t.s.nearOwner()).toBe(false); // still in the car
    t.game.inCar = false;
    expect(t.s.nearOwner()).toBe(true);
    expect(t.s.nearOwner({ x: at.x + 4, z: at.z })).toBe(false); // a car nearer than him: E gets you in
    expect(t.s.nearOwner({ x: at.x + 7, z: at.z })).toBe(true);
    Object.assign(t.g.player, { x: at.x + 3.1 });
    expect(t.s.nearOwner()).toBe(false);
    t.s.talk();
    t.s.talk();
    expect(t.calls).toEqual(['toast Plåt-Pelle: ' + OWNER_LINES[0], 'toast Plåt-Pelle: ' + OWNER_LINES[1]]);
  });

  it('has nothing but a warning for you with the police after you', () => {
    const t = skroten({ stars: 2 });
    t.s.talk();
    expect(t.calls[0]).toContain('Försvinn!');
  });

  it('makes no offer off the ring, and says why when it refuses', () => {
    const off = skroten();
    off.leaveRing();
    expect(off.s.open()).toBe(false);
    expect(off.s.buys()).toBe(false);
    expect(off.calls).toEqual([]);
    const chased = skroten({ stars: 1 });
    expect(chased.s.buys()).toBe(false);
    expect(chased.s.open()).toBe(false);
    expect(chased.calls[0]).toContain('Inte mä snuten');
    const ok = skroten();
    expect(ok.s.buys()).toBe(true);
    expect(ok.s.open()).toBe(true);
  });

  it('does not sell a car that has left the ring or is moving when you pick Sälj', () => {
    const gone = skroten();
    gone.s.open();
    gone.leaveRing();
    gone.choose('sell');
    expect(gone.wallet.kr).toBe(0);
    const moving = skroten({ car: { v: 10 } });
    moving.s.open();
    moving.choose('sell');
    expect(moving.wallet.kr).toBe(0);
    expect(moving.game.inCar).toBe(true);
  });
});

describe('Plåt-Pelle mends the car on the lift', () => {
  it('names his price for the damage, and mends the car once you pay', () => {
    const t = skroten({ model: 'volvo240', car: { dmg: 50 }, kr: 500 });
    t.driveOntoLift();
    expect(t.s.repairs()).toBe(200);
    expect(t.s.open()).toBe(true);
    expect(t.menu()!.kind).toBe('skrot-fix');
    expect(t.menu()!.title).toContain(fmtKr(200));
    t.choose('fix');
    expect(t.g.game.pcar!.dmg).toBe(0);
    expect(t.wallet.kr).toBe(300);
    expect(t.game.inCar).toBe(true);
  });

  it('keeps the damage and your money when you say no, or cannot pay', () => {
    const no = skroten({ car: { dmg: 50 }, kr: 500 });
    no.driveOntoLift();
    no.s.open();
    no.choose('no');
    expect(no.g.game.pcar!.dmg).toBe(50);
    expect(no.wallet.kr).toBe(500);
    const broke = skroten({ car: { dmg: 50 }, kr: 10 });
    broke.driveOntoLift();
    broke.s.open();
    broke.choose('fix');
    expect(broke.g.game.pcar!.dmg).toBe(50);
    expect(broke.wallet.kr).toBe(10);
    expect(broke.calls.at(-1)).toContain('Kom tebaks när du har pengarna');
  });

  it('has nothing to mend on a whole car, and mends nothing for the police or with them after you', () => {
    for (const [o, says] of [
      [{ car: { dmg: 0 } }, 'Den ä ju hel!'],
      [{ car: { dmg: 50, type: 'polis' } }, 'En polisbil?'],
      [{ car: { dmg: 50 }, stars: 1 }, 'Inte mä snuten i hälarna!'],
    ] as const) {
      const t = skroten({ ...o, kr: 1000 } as Parameters<typeof skroten>[0]);
      t.driveOntoLift();
      expect(t.s.repairs()).toBeNull();
      expect(t.s.open()).toBe(false);
      expect(t.menu()).toBeNull();
      expect(t.calls.at(-1)).toContain(says);
    }
  });

  it('offers nothing off the lift, keeps the menu only while the car stands on it, and mends none that left', () => {
    const t = skroten({ car: { dmg: 50 }, kr: 500 });
    t.leaveRing();
    expect(t.s.repairs()).toBeNull();
    expect(t.s.open()).toBe(false);
    t.driveOntoLift();
    t.s.open();
    expect(t.menu()!.stay!()).toBe(true);
    t.g.game.pcar!.x = LIFT.x + 10;
    expect(t.menu()!.stay!()).toBe(false);
    t.choose('fix');
    expect(t.g.game.pcar!.dmg).toBe(50);
    expect(t.wallet.kr).toBe(500);
  });
});

describe('Skroten sells the cars on its lot', () => {
  // you stand on foot `away` m from a Volvo on the lot that costs 2 000, with `kr` in your pocket
  function lot(o: { kr?: number; stars?: number; away?: number } = {}) {
    const t = skroten({ kr: o.kr ?? 5000, stars: o.stars }),
      car = { type: 'volvo', x: 0, z: 0, saleKr: 2000, owned: false, dmg: 0 } as Car;
    t.game.inCar = false;
    t.game.pcar = null;
    Object.assign(t.g.player, { x: o.away ?? 2, z: 0 });
    return { ...t, car };
  }

  it('sells nothing to someone who walked off, and closes the menu once the police are after you', () => {
    const away = lot();
    away.s.offerCar(away.car);
    Object.assign(away.g.player, { x: 50 }); // walked off before choosing
    away.choose('buy');
    expect(away.wallet.kr).toBe(5000);
    expect(away.car.owned).toBe(false);
    const chased = lot();
    chased.s.offerCar(chased.car);
    expect(chased.menu()!.stay!()).toBe(true);
    (chased.g as { stars: number }).stars = 1;
    expect(chased.menu()!.stay!()).toBe(false);
  });

  it('names its price, and the car is yours once you pay it', () => {
    const t = lot();
    t.s.offerCar(t.car);
    expect(t.menu()!.title).toBe('Plåt-Pelle: ”Den där Volvo 240? ' + fmtKr(2000) + ', å den ä din.”');
    t.choose('buy');
    expect(t.wallet.kr).toBe(3000);
    expect(t.car.owned).toBe(true);
    expect(t.car.bought).toBe(true);
    expect(t.car.saleKr).toBe(0);
    expect(t.calls[0]).toContain('Den ä din nu');
  });

  it('keeps the car and your money when you say no, or cannot pay', () => {
    const no = lot();
    no.s.offerCar(no.car);
    no.choose('no');
    expect(no.wallet.kr).toBe(5000);
    expect(no.car.owned).toBe(false);
    const broke = lot({ kr: 1999 });
    broke.s.offerCar(broke.car);
    broke.choose('buy');
    expect(broke.wallet.kr).toBe(1999);
    expect(broke.car.owned).toBe(false);
    expect(broke.calls[0]).toContain('Kom tebaks när du har pengarna');
  });

  it('sells nothing with the police after you, even when they come while the menu is open', () => {
    const chased = lot({ stars: 1 });
    chased.s.offerCar(chased.car);
    expect(chased.menu()).toBeNull();
    expect(chased.calls[0]).toContain('Inte mä snuten');
    const late = lot();
    late.s.offerCar(late.car);
    (late.g as { stars: number }).stars = 1;
    late.choose('buy');
    expect(late.wallet.kr).toBe(5000);
    expect(late.car.owned).toBe(false);
  });

  it('keeps his price on the plate only while you stand by the car on foot', () => {
    const t = lot();
    t.s.offerCar(t.car);
    const stay = t.menu()!.stay!;
    expect(stay()).toBe(true);
    Object.assign(t.g.player, { x: 6 });
    expect(stay()).toBe(false);
  });

  it("turns the yard's cars for sale into cars in the world, priced by model, leaving out models with no type", () => {
    const spot = (model: YardCar['model'], u: number): YardCar => ({
      u,
      v: 30,
      turn: Math.PI,
      tilt: 0,
      pitch: 0,
      model,
      colour: '#1f3b6a',
      wrecked: false,
      stack: 0,
    });
    const types: Record<string, 'volvo' | 'saab'> = { volvo240: 'volvo', saab900: 'saab', impala1970: 'volvo' },
      cars = carsForSale(
        [spot('volvo240', 16), spot('saab900', 19), spot('impala1970', 21), spot('micra-k11', 24)],
        id => types[id],
      );
    expect(cars.map(c => [c.model, c.type, c.kr])).toEqual([
      ['volvo240', 'volvo', 2000],
      ['saab900', 'saab', 2500],
      ['impala1970', 'volvo', 4000],
    ]);
    const at = yardToWorld(16, 30);
    expect(cars[0]).toMatchObject({ x: at.x, z: at.z, h: yardHeading(Math.PI), colour: '#1f3b6a' });
  });
});
