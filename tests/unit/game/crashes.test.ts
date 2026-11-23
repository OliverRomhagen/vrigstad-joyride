import { describe, expect, it } from 'vitest';
import type { Car } from '../../../src/game/cars';
import type { Cat } from '../../../src/game/cats';
import { Crashes } from '../../../src/game/crashes';
import { newGameState } from '../../../src/game/state';

const HARD_MS = 27; // 20 m/s over CRASH_MIN_MS: 45 damage, and it hurts the driver
// only what a crash reads of a car
const car = (o: Partial<Car> = {}) => ({ x: 0, z: 0, v: 0, mode: 'parked', dmg: 0, hitAt: -9, ...o }) as Car;

function crashes(o: { cat?: boolean; viewer?: { x: number; z: number }; god?: boolean } = {}) {
  const game = newGameState(),
    toasts: string[] = [],
    hurts: number[] = [],
    shakes: number[] = [];
  const pcar = car({ mode: 'player' });
  game.inCar = true;
  game.pcar = pcar;
  const owned = o.cat ? ({ name: 'Måns', ride: pcar } as unknown as Cat) : null;
  const c = new Crashes({
    game,
    colony: { owned },
    viewer: o.viewer ?? { x: 0, z: 0 },
    toast: msg => void toasts.push(msg),
    hurtPlayer: n => void hurts.push(n),
    god: o.god ?? false,
    shake: d => void shakes.push(d),
  });
  return { c, game, pcar, toasts, hurts, shakes };
}

describe('Crashes.crash', () => {
  it('in god mode, damages the other car but not yours, and still shakes the camera', () => {
    const t = crashes({ god: true }),
      other = car();
    t.c.crash(t.pcar, other, HARD_MS);
    expect(t.pcar.dmg).toBe(0);
    expect(other.dmg).toBe(45);
    expect(t.shakes).toEqual([45]);
  });

  it('hurts you, shakes the camera and says one line, at most once every few seconds', () => {
    const t = crashes();
    t.c.crash(t.pcar, null, HARD_MS);
    expect(t.hurts).toHaveLength(1);
    expect(t.hurts[0]).toBeGreaterThan(0);
    expect(t.shakes).toEqual([45]);
    expect(t.toasts).toHaveLength(1);
    expect(t.toasts[0]).toMatch(/^”(AJ|Hoppsan|Va fan)/); // a crash line, not a smoke or wreck line
    t.game.clockS = 2; // past the car's own cooldown, inside the line's
    t.pcar.dmg = 0; // so the hit doesn't make it smoke, which has its own line
    t.c.crash(t.pcar, null, HARD_MS);
    expect(t.hurts).toHaveLength(2);
    expect(t.toasts).toHaveLength(1);
  });

  it('says the car is wrecked, and with your cat along says it to the cat', () => {
    const alone = crashes();
    alone.pcar.dmg = 90;
    alone.c.crash(alone.pcar, null, HARD_MS);
    expect(alone.toasts.at(-1)).toContain('The car is wrecked.');
    const withCat = crashes({ cat: true });
    withCat.pcar.dmg = 90;
    withCat.c.crash(withCat.pcar, null, HARD_MS);
    expect(withCat.toasts.at(-1)).toContain('”Ut, Måns!');
  });

  it('tells you a police car is wrecked only when it happens near the camera', () => {
    const near = crashes(),
      far = crashes({ viewer: { x: 500, z: 0 } });
    for (const t of [near, far]) t.c.crash(car({ mode: 'police', dmg: 90 }), null, HARD_MS);
    expect(near.toasts).toHaveLength(1);
    expect(near.toasts[0]).toMatch(/^”.+” The police car is wrecked\.$/); // your line, then what happened
    expect(far.toasts).toEqual([]);
  });
});

describe('Crashes.catRideLines', () => {
  it('tells your cat to hold on above about 90 km/h, once until you slow down', () => {
    const t = crashes({ cat: true });
    t.pcar.v = 26;
    t.c.catRideLines();
    t.c.catRideLines();
    expect(t.toasts).toHaveLength(1);
    t.pcar.v = 19;
    t.c.catRideLines();
    t.pcar.v = 26;
    t.c.catRideLines();
    expect(t.toasts).toHaveLength(2);
    const noCat = crashes();
    noCat.pcar.v = 26;
    noCat.c.catRideLines();
    expect(noCat.toasts).toEqual([]);
  });
});
