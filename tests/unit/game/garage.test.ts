import { describe, expect, it } from 'vitest';
import type { Car } from '../../../src/game/cars';
import { DECAL_KR, RESPRAY_KR, SPECIAL_PAINT_KR, UPGRADE_KR } from '../../../src/game/economy';
import { Garage } from '../../../src/game/garage';
import { WORKSHOP_PAINTS } from '../../../src/game/sim/paint-jobs';
import { noMods } from '../../../src/game/sim/upgrades';
import { type CarType, specFor } from '../../../src/game/sim/vehicle-spec';
import { Skroten } from '../../../src/game/skroten';
import { newGameState } from '../../../src/game/state';

const LIFT = { x: 50, z: 0 };

// You drive `car` onto the workshop's lift with `kr` in your pocket; E there opens the garage, not the lift's menus.
function onLift(o: { type?: CarType; car?: Partial<Car>; kr?: number } = {}) {
  const type = o.type ?? 'volvo',
    toasts: string[] = [],
    police = { stars: 0 };
  const car = {
    type,
    T: specFor(type),
    color: specFor(type).cols[0]!,
    mods: noMods(),
    decal: null,
    limiterOff: false,
    dmg: 0,
    x: LIFT.x + 1,
    z: LIFT.z,
    v: 0,
    ...o.car,
  } as Car;
  const game = { ...newGameState(), inCar: true, pcar: car as Car | null },
    wallet = { kr: o.kr ?? 0 };
  const skroten: Skroten = new Skroten({
    game,
    player: { x: 0, z: 0 },
    get stars() {
      return police.stars;
    },
    openMenu: () => {
      throw new Error('the lift menu opened instead of the garage');
    },
    toast: m => void toasts.push(m),
    atSkroten: () => false,
    liftAt: LIFT,
    modelId: () => undefined,
    carName: () => 'Volvo 240',
    wallet,
    sellCar: () => {},
    garage: c => garage.open(c),
  });
  const garage = new Garage({ skroten, game, wallet, carName: () => 'Volvo 240' });
  // picks the choice named `name` on shelf `cat`
  const pick = (cat: Parameters<Garage['setShelf']>[0], name: string) => {
    garage.setTab(cat === 'paint' || cat === 'special' || cat === 'decal' ? 'paint' : 'work');
    garage.setShelf(cat);
    const i = garage.choices().findIndex(c => c.name === name);
    expect(i, name + ' on ' + cat).toBeGreaterThanOrEqual(0);
    garage.pick(i);
  };
  return { skroten, garage, car, game, wallet, toasts, police, pick };
}

describe("Plåt-Pelle's garage (?lab=garage)", () => {
  it('opens instead of the lift menus, on the shelf to mend a damaged car', () => {
    const t = onLift({ car: { dmg: 40 } });
    expect(t.skroten.open()).toBe(true);
    expect(t.garage.isOpen).toBe(true);
    expect(t.garage.car).toBe(t.car);
    expect(t.garage.cat).toBe('fix');
    expect(t.garage.choices().map(c => c.name)).toEqual(['Som den ä', 'Laga']);
  });

  it('tries a paint on, and puts the car’s own paint back when you leave without paying', () => {
    const t = onLift(),
      own = t.car.color,
      other = specFor('volvo').cols[1]!;
    t.skroten.open();
    t.garage.setTab('paint');
    t.garage.setShelf('paint');
    t.garage.pick(t.garage.choices().findIndex(c => c.swatch === other));
    expect(t.car.color).toBe(other);
    expect(t.garage.bill()).toEqual({ jobs: 1, kr: RESPRAY_KR });
    t.garage.close();
    expect(t.car.color).toBe(own);
    expect(t.wallet.kr).toBe(0);
  });

  it('pays one bill for every pick, and Plåt-Pelle does each job', () => {
    const t = onLift({ kr: 5000 }),
      special = WORKSHOP_PAINTS[0]!;
    t.skroten.open();
    t.pick('engine', 'Trimma motorn');
    t.pick('springs', 'Sportfjädring');
    t.pick('special', special.name);
    t.pick('decal', 'Flammor');
    const kr = UPGRADE_KR.engine + UPGRADE_KR.springs + SPECIAL_PAINT_KR + DECAL_KR;
    expect(t.garage.bill()).toEqual({ jobs: 4, kr });
    expect(t.garage.pay()).toBe(true);
    expect(t.wallet.kr).toBe(5000 - kr);
    expect(t.car.mods).toEqual({ engine: true, springs: true, body: false });
    expect(t.car.color).toBe(special.paint);
    expect(t.car.decal).toBe('flames');
    expect(t.garage.bill().jobs).toBe(0);
    t.garage.setTab('work');
    t.garage.setShelf('engine');
    expect(t.garage.choices()[0]).toMatchObject({ name: 'Standard', locked: true }); // an upgrade doesn't come off again
    expect(t.garage.choices()[1]!.price).toBe('Fitted');
  });

  it('does nothing and takes nothing when the bill is more than you have', () => {
    const t = onLift({ kr: 100 });
    t.skroten.open();
    t.pick('engine', 'Trimma motorn');
    expect(t.garage.line()).toContain('Kom tebaks när du har pengarna');
    expect(t.garage.pay()).toBe(false);
    expect(t.wallet.kr).toBe(100);
    expect(t.car.mods.engine).toBe(false);
  });

  it('keeps the car’s own look when E opens it again while it’s open', () => {
    const t = onLift(),
      own = t.car.color,
      other = specFor('volvo').cols[1]!;
    t.skroten.open();
    t.garage.setTab('paint');
    t.garage.setShelf('paint');
    t.garage.pick(t.garage.choices().findIndex(c => c.swatch === other));
    expect(t.skroten.open()).toBe(true); // E again, through the lift
    t.garage.close();
    expect(t.car.color).toBe(own);
  });

  it('shows the new price, and takes nothing, when the car is knocked while the garage is open', () => {
    const t = onLift({ car: { dmg: 40 }, kr: 5000 });
    t.skroten.open();
    t.pick('fix', 'Laga');
    const billed = t.garage.bill().kr;
    t.car.dmg = 80;
    expect(t.garage.pay()).toBe(false);
    expect(t.wallet.kr).toBe(5000);
    expect(t.car.dmg).toBe(80);
    const rebilled = t.garage.bill().kr;
    expect(rebilled).toBeGreaterThan(billed); // the bill now says what it costs
    expect(t.garage.pay()).toBe(true);
    expect(t.wallet.kr).toBe(5000 - rebilled);
    expect(t.car.dmg).toBe(0);
  });

  it('takes every pick back off with Ångra', () => {
    const t = onLift();
    t.skroten.open();
    t.pick('decal', 'Rallyränder');
    t.pick('engine', 'Trimma motorn');
    t.garage.undo();
    expect(t.car.decal).toBe(null);
    expect(t.garage.bill().jobs).toBe(0);
  });

  it('closes when the car leaves the lift or the police come, and puts its look back', () => {
    const t = onLift();
    t.skroten.open();
    t.pick('decal', 'Flammor');
    t.car.x = 0;
    t.garage.settle();
    expect(t.garage.isOpen).toBe(false);
    expect(t.car.decal).toBe(null);

    const u = onLift();
    u.skroten.open();
    u.police.stars = 1;
    u.garage.settle();
    expect(u.garage.isOpen).toBe(false);
  });

  it('shows what the picks do to the car before you pay', () => {
    const t = onLift();
    t.skroten.open();
    t.pick('engine', 'Trimma motorn');
    t.pick('body', 'Förstärkt kaross');
    const [top, , , crash] = t.garage.stats();
    const kmh = specFor('volvo').max * 3.6;
    expect(top).toMatchObject({ from: Math.round(kmh) + ' km/h', to: Math.round(kmh * 1.15) + ' km/h', better: true });
    expect(crash).toMatchObject({ from: '100 %', to: '50 %', better: true });
  });

  it('turns the car’s model on the turntable as you drag, but not the car, and faces it the way it came when it closes', () => {
    const t = onLift({ car: { h: 1 } });
    t.garage.spin(100); // nothing to turn before it opens
    expect(t.garage.turn).toBe(0);
    t.skroten.open();
    t.garage.spin(100);
    expect(t.garage.turn).toBeGreaterThan(0.5);
    expect(t.car.h).toBe(1);
    t.garage.spin(-100);
    expect(t.garage.turn).toBeCloseTo(0);
    t.garage.spin(1000); // past a full round, it stays an angle
    expect(Math.abs(t.garage.turn)).toBeLessThanOrEqual(Math.PI);
    t.garage.close();
    expect(t.garage.turn).toBe(0);
  });

  it('tells a tuned EPA-traktor about its limiter switch', () => {
    const t = onLift({ type: 'epa' });
    t.skroten.open();
    expect(t.garage.note()).toBe(null);
    t.pick('engine', 'Trimma motorn');
    expect(t.garage.note()).toContain('limiter');
  });

  it('offers a tractor no decals, which has no panels for one', () => {
    const t = onLift({ type: 'traktor' });
    t.skroten.open();
    t.garage.setTab('paint');
    t.garage.setShelf('decal');
    expect(t.garage.choices().map(c => c.name)).toEqual(['Ingen']);
  });
});

describe('Skroten.liftJob', () => {
  it('sprays no paint off his menus, and none the car already has', () => {
    const t = onLift({ kr: 1000 });
    expect(t.skroten.liftJob(t.car, { kind: 'paint', paint: '#123456' })).toBe(false);
    expect(t.skroten.liftJob(t.car, { kind: 'paint', paint: t.car.color })).toBe(false);
    expect(t.wallet.kr).toBe(1000);
  });

  it('works on nothing with the police after you', () => {
    const t = onLift({ kr: 1000 });
    t.police.stars = 2;
    expect(t.skroten.liftOffer(t.car)).toContain('snuten');
    expect(t.skroten.liftJob(t.car, { kind: 'upgrade', upgrade: 'engine' })).toBe(false);
    expect(t.car.mods.engine).toBe(false);
  });
});
