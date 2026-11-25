import { describe, expect, it } from 'vitest';
import { Commands } from '../../../src/game/commands';
import { DMG_MAX } from '../../../src/game/health';
import { KIOSK, Places, type PlacesDeps, SKROTEN, streetDoor } from '../../../src/game/places';
import { HOME } from '../../../src/game/player';
import { RoadClass } from '../../../src/world/data';
import { square } from '../world/fixture';

// A road from a to b, a primary road unless `c` says otherwise.
const road = (ax: number, az: number, bx: number, bz: number, c: RoadClass = RoadClass.PRIMARY) => ({
  p: [
    [ax, az],
    [bx, bz],
  ] as [number, number][],
  c,
});

// The Gästgivaregatan safehouse is the house around (39.9, -43.6): a 20 m square, with a street 10 m north of it.
function places(o: Partial<PlacesDeps> = {}) {
  const toasts: string[] = [],
    lyingLow: number[] = [];
  const g: PlacesDeps = {
    footprints: [{ p: square(30, -50, 20) }],
    roads: [road(0, -60, 80, -60)],
    police: [],
    stars: 0,
    lieLow: s => lyingLow.push(s),
    toast: m => toasts.push(m),
    ...o,
  };
  return { places: new Places(g), toasts, lyingLow };
}

// streetDoor, with -0 turned into 0 so toEqual can compare it
const door = (...a: Parameters<typeof streetDoor>) => {
  const d = streetDoor(...a);
  return d && { mx: d.mx + 0, mz: d.mz + 0, nx: d.nx + 0, nz: d.nz + 0 };
};

describe('streetDoor', () => {
  it('puts the door in the middle of the wall nearest the street, facing out', () => {
    // a 10 m house at the origin with a street 5 m north of it (z points south)
    expect(door(square(0, 0, 10), [road(-20, -5, 30, -5)])).toEqual({ mx: 5, mz: 0, nx: 0, nz: -1 });
    expect(door(square(0, 0, 10), [road(15, -20, 15, 30)])).toEqual({ mx: 10, mz: 5, nx: 1, nz: 0 });
  });

  it('faces a street, not a nearer track', () => {
    const roads = [road(-20, -1, 30, -1, RoadClass.TRACK), road(15, -20, 15, 30, RoadClass.SERVICE)];
    expect(door(square(0, 0, 10), roads)).toEqual({ mx: 10, mz: 5, nx: 1, nz: 0 });
  });

  it('has no door on a house whose walls are all shorter than 2.5 m', () => {
    expect(door(square(0, 0, 2), [road(-20, -5, 30, -5)])).toBeNull();
  });
});

describe('Places', () => {
  it('has a ring outside each safehouse door that is found, then the kiosk counter and Skroten', () => {
    const { places: p } = places();
    expect(p.doors).toEqual([{ mx: 40, mz: -50, nx: 0, nz: -1 }]);
    expect(p.list).toEqual([
      { kind: 'safe', name: 'Gästgivaregatan', x: 40, z: -51.4 },
      { kind: 'kiosk', name: 'Kiosken', x: KIOSK.x, z: KIOSK.z + KIOSK.counterZ },
      { kind: 'skrot', name: 'Skroten', x: SKROTEN.x, z: SKROTEN.z },
    ]);
  });

  it('takes you to Torget, the kiosk, Skroten, its lift or a safehouse with go, turned where a spot says', () => {
    const { places: p } = places(),
      c = new Commands(),
      went: [number, number, number | undefined][] = [];
    p.registerCommands(
      c,
      (x, z, name, h) => {
        went.push([x, z, h]);
        return 'You are at ' + name + '.';
      },
      { verkstan: { x: 50, z: 60, name: "Plåt-Pelle's lift", h: 1.5 } },
    );
    expect(c.run('go Skroten')).toBe('You are at Skroten.');
    expect(went.at(-1)).toEqual([SKROTEN.x, SKROTEN.z, undefined]); // a car keeps its heading
    expect(c.run('go torget')).toBe('You are at Torget.');
    expect(went.at(-1)).toEqual([HOME.x, HOME.z, undefined]);
    expect(c.run('go kiosk')).toBe('You are at Kiosken.');
    expect(c.run('go gästgivaregatan')).toBe('You are at Gästgivaregatan.');
    expect(c.run('go mars')).toBe(
      'No place called mars. Pick one of: gästgivaregatan, kiosk, skroten, torget, verkstan. Usage: go <place>',
    );
    expect(c.run('tp kiosk')).toBe('You are at Kiosken.');
    expect(c.complete('go ')).toEqual(['gästgivaregatan', 'kiosk', 'skroten', 'torget', 'verkstan']);
    expect(c.run('go verkstan')).toBe("You are at Plåt-Pelle's lift.");
    expect(went.at(-1)).toEqual([50, 60, 1.5]); // turned to drive in
  });

  it('finds Skroten for a car within 4 m of its ring, never for you on foot', () => {
    const { places: p } = places();
    expect(p.skrotenAt(SKROTEN.x + 3.9, SKROTEN.z)?.name).toBe('Skroten');
    expect(p.skrotenAt(SKROTEN.x + 4.1, SKROTEN.z)).toBeNull();
    expect(p.nearest(SKROTEN.x, SKROTEN.z)).toBeNull();
  });

  it('finds the place whose ring you stand on, within 2.2 m', () => {
    const { places: p } = places();
    expect(p.nearest(40, -49.3)?.name).toBe('Gästgivaregatan');
    expect(p.nearest(40, -49.1)).toBeNull();
  });

  it('lets you lie low inside, and back out', () => {
    const { places: p, toasts, lyingLow } = places({ stars: 2 }),
      safe = p.list[0],
      you = { x: 41, z: -52, speed: 4 };
    expect(p.enter(safe, you)).toBe(true);
    expect(p.inside).toBe(safe);
    expect(you).toEqual({ x: 40, z: -51.4, speed: 0 });
    expect(lyingLow).toEqual([60]);
    expect(p.leave()).toBe(true);
    expect(p.inside).toBeNull();
    expect(toasts.at(-1)).toBe('Back outside, and still wanted.');
    expect(p.leave()).toBe(false);
  });

  it('keeps you out while a working police car is within 60 m', () => {
    const police = [{ x: 40, z: 8, dmg: 0 }]; // 59.4 m from the ring
    const { places: p, lyingLow } = places({ police }),
      you = { x: 40, z: -51.4, speed: 0 };
    expect(p.enter(p.list[0], you)).toBe(false);
    expect(p.inside).toBeNull();
    expect(lyingLow).toEqual([]);
    police[0].dmg = DMG_MAX; // a wrecked one can't see you
    expect(p.enter(p.list[0], you)).toBe(true);
  });
});
