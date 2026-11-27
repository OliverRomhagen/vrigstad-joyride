import { describe, expect, it } from 'vitest';
import {
  type Car,
  type CarForSale,
  type CarMode,
  Fleet,
  newCar,
  type TrafficCar,
  TURBO_AT,
} from '../../../src/game/cars';
import { Commands } from '../../../src/game/commands';
import { CRASH_COOL_S, DMG_MAX } from '../../../src/game/health';
import { UPGRADES } from '../../../src/game/sim/upgrades';
import { type CarType, specFor } from '../../../src/game/sim/vehicle-spec';
import { BuildingIndex } from '../../../src/world/buildings';
import { BuildingKind, ROAD_WIDTH_M, RoadClass, type WorldData } from '../../../src/world/data';
import { makeRnd } from '../../../src/world/random';
import { RoadNetwork } from '../../../src/world/roads';
import { Water } from '../../../src/world/water';
import { makeWorld, square } from '../world/fixture';

const DT = 1 / 60;
const SIZE_M = 2000; // big enough that no test reaches the map's edge
// a primary road from south to north along x = 0, and a street across it at z = 0
const MAIN_ROAD = { c: RoadClass.PRIMARY, n: 'Storgatan', p: [0, 900, 0, -900] };
const STREET = { c: RoadClass.STREET, n: 'Gästgivaregatan', p: [-600, 0, 600, 0] };

/** A new car from the real newCar, with the type's first colour: the tests roll nothing for the paint. */
function car(type: CarType, x: number, z: number, h: number, mode: CarMode): Car {
  const T = specFor(type);
  return newCar(type, x, z, h, mode, T, T.cols[0]!);
}

function fleet(world: Partial<WorldData> = { r: [MAIN_ROAD] }, canPark = (_x: number, _z: number) => true) {
  const data = makeWorld({ size: SIZE_M, ...world });
  const roads = new RoadNetwork(data, { heightAt: () => 0 });
  const base = makeRnd(1);
  let rolls = 0; // how often the game's main stream was rolled
  const rnd = () => {
    rolls++;
    return base();
  };
  const log = {
    crashes: [] as [Car, Car | null][],
    rammed: [] as Car[],
    placed: new Set<Car>(),
    models: [] as (string | null | undefined)[],
  };
  const player = { x: 0, z: -800 };
  const cars: Fleet = new Fleet({
    roads,
    buildings: new BuildingIndex(data),
    water: new Water(data, roads),
    half: SIZE_M / 2,
    rnd,
    pick: a => a[Math.floor(rnd() * a.length)],
    addCar: (type, x, z, h, mode, model) => {
      log.models.push(model);
      return cars.add(car(type, x, z, h, mode));
    },
    placeCar: c => {
      log.placed.add(c);
    },
    crash: (c, o) => {
      log.crashes.push([c, o]);
    },
    rammed: (_c, o) => {
      log.rammed.push(o);
    },
    canPark,
    player,
    inCar: false,
  });
  return { cars, log, player, rolls: () => rolls };
}

/** Drives `c` for `s` seconds with the same inputs every frame. */
function driveFor(f: Fleet, c: Car, s: number, thr: number, steer: number, brake: boolean, canDrift = false) {
  for (let t = 0; t < s; t += DT) f.drive(c, thr, steer, brake, DT, canDrift);
}

describe('newCar', () => {
  it('stands still where it is put, nose and line of travel the same way, undamaged and owned by nobody', () => {
    const T = specFor('saab'),
      c = newCar('saab', 10, -20, 1.2, 'parked', T, '#8c1c1c');
    expect(c).toMatchObject({
      type: 'saab',
      T,
      x: 10,
      z: -20,
      h: 1.2,
      vh: 1.2,
      v: 0,
      mode: 'parked',
      owned: false,
      dmg: 0,
      color: '#8c1c1c',
    });
    expect(c.hitAt).toBeLessThan(-CRASH_COOL_S); // a new car can take a hit at once
  });
});

describe('Fleet.add and remove', () => {
  it('holds every car it is given, and lets go of one when it is removed', () => {
    const { cars } = fleet(),
      a = cars.add(car('volvo', 0, 0, 0, 'parked')),
      b = cars.add(car('polis', 5, 0, 0, 'police'));
    expect(cars.cars).toEqual([a, b]);
    cars.remove(a);
    expect(cars.cars).toEqual([b]);
    cars.remove(a); // removing it twice changes nothing
    expect(cars.cars).toEqual([b]);
  });
});

describe('drive', () => {
  it('speeds up under full throttle, and never past the top speed', () => {
    const { cars } = fleet();
    const c = car('volvo', 0, 800, 0, 'player');
    let fastest = 0;
    for (let t = 0; t < 20; t += DT) {
      cars.drive(c, 1, 0, false, DT);
      fastest = Math.max(fastest, c.v);
    }
    expect(c.v).toBeGreaterThan(c.T.max * 0.8);
    expect(fastest).toBeLessThanOrEqual(c.T.max);
    expect(c.z).toBeLessThan(800); // heading 0 is north, towards -z
  });

  it("goes faster with Plåt-Pelle's engine tune, up to the tuned top speed", () => {
    const { cars } = fleet();
    const tuned = car('volvo', 0, 800, 0, 'player'),
      stock = car('volvo', 0, 800, 0, 'player');
    tuned.mods.engine = true;
    driveFor(cars, tuned, 3, 1, 0, false);
    driveFor(cars, stock, 3, 1, 0, false);
    expect(tuned.v).toBeGreaterThan(stock.v * 1.15); // quicker off the mark
    driveFor(cars, tuned, 30, 1, 0, false);
    expect(tuned.v).toBeGreaterThan(tuned.T.max);
    expect(tuned.v).toBeLessThanOrEqual(tuned.T.max * UPGRADES.ENGINE_TOP);
  });

  it('steers sooner on sport springs', () => {
    const { cars } = fleet();
    const sprung = car('volvo', 0, 800, 0, 'player'),
      stock = car('volvo', 0, 800, 0, 'player');
    sprung.mods.springs = true;
    driveFor(cars, sprung, 0.05, 0, 1, false);
    driveFor(cars, stock, 0.05, 0, 1, false);
    expect(sprung.st).toBeGreaterThan(stock.st);
  });

  it('stops with its nose at a wall, not inside it (#201)', () => {
    // a house north of the road's south end, its south wall at z = 700
    const { cars } = fleet({ r: [MAIN_ROAD], b: [{ p: square(-20, 660, 40), h: 5, k: BuildingKind.OTHER }] });
    const c = car('volvo', 0, 712, 0, 'player'); // heading north, 9.6 m from the wall
    driveFor(cars, c, 3, 0.4, 0, false);
    expect(c.z - c.T.lengthM / 2).toBeCloseTo(700, 0); // the nose at the wall: before, it went 0.9 m in
    expect(c.z - c.T.lengthM / 2).toBeGreaterThan(699.8);
  });

  it('is slower off the road', () => {
    const { cars } = fleet();
    const c = car('volvo', 300, 800, 0, 'player');
    driveFor(cars, c, 20, 1, 0, false);
    expect(c.v).toBeLessThanOrEqual(c.T.max * c.T.off);
  });

  it('brakes to a stop', () => {
    const { cars } = fleet();
    const c = car('volvo', 0, 800, 0, 'player');
    c.v = 20;
    driveFor(cars, c, 2, 0, 0, true);
    expect(c.v).toBe(0);
  });

  it('drifts on brake and steering at speed, but only for the player', () => {
    const { cars } = fleet();
    const you = car('volvo', 0, 800, 0, 'player'),
      police = car('polis', 0, 600, 0, 'police');
    you.v = police.v = 20;
    cars.drive(you, 0, 1, true, DT, true);
    cars.drive(police, 0, 1, true, DT);
    expect(you.drift).toBe(1);
    expect(police.drift).toBe(0);
  });

  it('fires a mini-turbo when a long enough slide ends', () => {
    const { cars } = fleet();
    const c = car('volvo', 0, 800, 0, 'player');
    c.v = 25;
    driveFor(cars, c, 2, 1, 1, true, true);
    expect(c.drift).toBe(1);
    expect(c.charge).toBeGreaterThan(TURBO_AT[0]);
    cars.drive(c, 1, 0, false, DT, true);
    expect(c.drift).toBe(0);
    expect(c.boost).toBeGreaterThan(0);
  });

  it('only rolls when it is wrecked', () => {
    const { cars } = fleet();
    const c = car('volvo', 0, 800, 0, 'player');
    c.dmg = DMG_MAX;
    c.v = 10;
    driveFor(cars, c, 1, 1, 0, false);
    expect(c.v).toBeLessThan(10);
    expect(c.thr).toBe(0);
  });

  it('crashes into a car it hits and pushes a parked one away', () => {
    const { cars, log } = fleet();
    const c = car('volvo', 0, 800, 0, 'player'),
      parked = car('saab', 0, 798, 0, 'parked');
    cars.add(c);
    cars.add(parked);
    c.v = 10;
    cars.drive(c, 0, 0, false, DT);
    expect(log.crashes).toContainEqual([c, parked]);
    expect(parked.z).toBeLessThan(798);
    expect(log.placed.has(parked)).toBe(true);
  });

  it('never shoves a parked car into a wall', () => {
    // a house north of the road's south end, its south wall at z = 700; the parked car stands with its nose 0.1 m from it
    const { cars, log } = fleet({ r: [MAIN_ROAD], b: [{ p: square(-20, 660, 40), h: 5, k: BuildingKind.OTHER }] });
    const parked = car('saab', 0, 0, 0, 'parked'),
      c = car('volvo', 0, 0, 0, 'player');
    parked.z = 700.1 + parked.T.lengthM / 2;
    c.z = parked.z + (parked.T.lengthM + c.T.lengthM) / 2 + 2;
    cars.add(c);
    cars.add(parked);
    driveFor(cars, c, 3, 1, 0, false); // full throttle into its tail, for 3 s
    expect(log.crashes).toContainEqual([c, parked]);
    expect(parked.z - parked.T.lengthM / 2).toBeGreaterThan(699.8); // the same margin as a car you drive into the wall
  });

  it("never shoves a car for sale on Skroten's lot: it can't be pushed out of the yard", () => {
    const { cars } = fleet();
    const c = car('volvo', 0, 800, 0, 'player'),
      forSale = car('saab', 0, 798, 0, 'parked');
    forSale.saleKr = 2500;
    cars.add(c);
    cars.add(forSale);
    c.v = 10;
    cars.drive(c, 0, 0, false, DT);
    expect(forSale.z).toBe(798);
    expect(c.z).toBeGreaterThan(798); // yours is pushed back off it instead
  });

  it('reports ramming a police car only at speed', () => {
    const { cars, log } = fleet();
    const c = car('volvo', 0, 800, 0, 'player'),
      police = car('polis', 0, 798, 0, 'police');
    cars.add(c);
    cars.add(police);
    c.v = 3;
    cars.drive(c, 0, 0, false, DT);
    expect(log.rammed).toEqual([]);
    c.z = 800;
    police.z = 798;
    c.v = 10;
    cars.drive(c, 0, 0, false, DT);
    expect(log.rammed).toEqual([police]);
  });
});

describe('brake lights (#304)', () => {
  it('light while braking, and go out once stopped and released', () => {
    const { cars } = fleet();
    const c = car('volvo', 0, 800, 0, 'player');
    driveFor(cars, c, 4, 1, 0, false);
    expect(c.brk).toBe(false); // accelerating
    cars.drive(c, 0, 0, true, DT);
    expect(c.brk).toBe(true);
    driveFor(cars, c, 3, 0, 0, true);
    expect(c.v).toBe(0);
    expect(c.brk).toBe(true); // held on at a stop, as a foot on the pedal
    cars.drive(c, 0, 0, false, DT);
    expect(c.brk).toBe(false);
  });

  it('stay out when coasting, and light when slowing by reverse throttle', () => {
    const { cars } = fleet();
    const c = car('volvo', 0, 800, 0, 'player');
    driveFor(cars, c, 4, 1, 0, false);
    driveFor(cars, c, 1, 0, 0, false);
    expect(c.v).toBeGreaterThan(5);
    expect(c.brk).toBe(false); // lifting off on the road
    driveFor(cars, c, 0.3, -1, 0, false);
    expect(c.brk).toBe(true); // S at speed slows harder than coasting
  });

  it('stay out when the ground slows the car: off-road drag and the off-road speed cap', () => {
    const { cars } = fleet();
    const c = car('volvo', 0, 800, 0, 'player');
    driveFor(cars, c, 6, 1, 0, false);
    expect(c.v).toBeGreaterThan(c.T.max * c.T.off); // faster than the car may go off the road
    c.x = 200; // off the road, which runs along x = 0: the cap slows it by 14 m/s²
    for (let t = 0; t < 1; t += DT) {
      cars.drive(c, 1, 0, false, DT);
      expect(c.brk).toBe(false);
    }
    for (let t = 0; t < 1; t += DT) {
      cars.drive(c, 0, 0, false, DT); // coasting on grass: 5 m/s² of drag, no foot on the pedal
      expect(c.brk).toBe(false);
    }
  });

  it('show on a traffic car slowing for a parked one, and stay on while it waits', () => {
    const { cars } = fleet();
    const c = Object.assign(car('volvo', 0, 500, 0, 'ai'), { ri: 0, a: 0, dir: 1, t: 400, first: true }) as TrafficCar;
    cars.add(c);
    for (let t = 0; t < 3; t += DT) cars.updateTraffic(c, DT); // up to speed
    expect(c.brk).toBe(false);
    cars.add(car('saab', c.x + Math.sin(c.h) * 10, c.z - Math.cos(c.h) * 10, c.h, 'parked')); // inside LOOK_CAR_M
    cars.updateTraffic(c, DT);
    expect(c.v).toBeGreaterThan(0);
    expect(c.brk).toBe(true);
    for (let t = 0; t < 2; t += DT) cars.updateTraffic(c, DT);
    expect(c.v).toBe(0);
    expect(c.brk).toBe(true);
  });
});

describe('traffic', () => {
  it('turns back at the end of a road', () => {
    const { cars } = fleet();
    const at = { ri: 0, a: 0, dir: 1 }; // the road has two vertices, so a + dir is its end
    cars.advance(at);
    expect(at).toEqual({ ri: 0, a: 1, dir: -1 });
  });

  it('spawns on a driveable road, away from the given point', () => {
    const { cars, player } = fleet();
    const c = cars.spawnTraffic(player);
    expect(c).toBeDefined();
    expect(c?.mode).toBe('ai');
    expect(Math.hypot(c!.x - player.x, c!.z - player.z)).toBeGreaterThanOrEqual(260);
    expect(cars.cars).toEqual([c]);
  });

  it('spawns only where no other car stands, parked or in traffic (#409)', () => {
    // traffic spawns at a road's vertices: five of them, 20 m apart, the first one taken by a parked car
    const { cars } = fleet({ r: [{ c: RoadClass.PRIMARY, n: 'Storgatan', p: [0, 40, 0, 20, 0, 0, 0, -20, 0, -40] }] });
    cars.add(car('volvo', 1, 40, 0, 'parked'));
    for (let i = 0; i < 10; i++) cars.spawnTraffic(null);
    expect(cars.cars).toHaveLength(4); // the last vertex is never a spawn, so three are left, and the parked car
    for (const c of cars.cars)
      for (const o of cars.cars) if (o !== c) expect(Math.hypot(o.x - c.x, o.z - c.z)).toBeGreaterThanOrEqual(7);
  });

  it('waits behind a car, and drives through it after 6 s', () => {
    const { cars } = fleet();
    // 400 m along the main road from its south end, heading north
    const c = Object.assign(car('volvo', 0, 500, 0, 'ai'), {
      ri: 0,
      a: 0,
      dir: 1,
      t: 400,
      first: true,
    }) as TrafficCar;
    cars.add(c);
    cars.updateTraffic(c, DT); // the first frame puts it in its lane
    cars.add(car('saab', c.x + Math.sin(c.h) * 6, c.z - Math.cos(c.h) * 6, c.h, 'parked'));
    for (let t = 0; t < 5; t += DT) cars.updateTraffic(c, DT);
    expect(c.v).toBe(0);
    for (let t = 0; t < 2; t += DT) cars.updateTraffic(c, DT);
    expect(c.ghost).toBeGreaterThan(0);
    expect(c.v).toBeGreaterThan(0);
  });
});

describe('parkCars', () => {
  it('parks cars along the kerb of streets, at least 7 m apart', () => {
    const { cars } = fleet({ r: [STREET] });
    cars.parkCars();
    const kerbM = ROAD_WIDTH_M[RoadClass.STREET] / 2 + 1.35;
    expect(cars.cars.length).toBeGreaterThan(10);
    for (const c of cars.cars) {
      expect(c.mode).toBe('parked');
      expect(Math.abs(c.z)).toBeCloseTo(kerbM);
      for (const o of cars.cars) if (o !== c) expect(Math.hypot(o.x - c.x, o.z - c.z)).toBeGreaterThanOrEqual(7);
    }
  });

  it('parks only where canPark allows', () => {
    const { cars } = fleet({ r: [STREET] }, (_x, z) => z < 0); // as if the south side of the street were pavement
    cars.parkCars();
    expect(cars.cars.length).toBeGreaterThan(5);
    for (const c of cars.cars) expect(c.z).toBeLessThan(0);
  });

  it('replaces a sold car with one parked out of sight', () => {
    const { cars } = fleet({ r: [STREET] });
    cars.parkCars();
    const sold = cars.cars.pop()!,
      before = cars.cars.length,
      you = { x: 0, z: 0 };
    cars.replaceSold(sold, you);
    expect(cars.cars.length).toBe(before + 1);
    const c = cars.cars[before]!;
    expect(c.mode).toBe('parked');
    expect(Math.hypot(c.x - you.x, c.z - you.z)).toBeGreaterThanOrEqual(260);
  });

  it('parks no replacement in sight of you', () => {
    const { cars } = fleet({ r: [STREET] }, (x, z) => Math.hypot(x, z) < 260); // only spots within sight are free
    cars.parkCars();
    const sold = cars.cars.pop()!,
      before = cars.cars.length;
    cars.replaceSold(sold, { x: 0, z: 0 });
    expect(cars.cars.length).toBe(before);
  });

  it('parks no replacement for a car you took from traffic, which was already replaced', () => {
    const { cars } = fleet({ r: [MAIN_ROAD, STREET] }), // traffic on the main road, parking on the street
      you = { x: 0, z: 0 },
      taken = cars.spawnTraffic(null)!,
      before = cars.cars.length;
    cars.replaceTaken(taken, you);
    expect(cars.cars.length).toBe(before + 1);
    cars.remove(taken);
    cars.replaceSold(taken, you);
    expect(cars.cars.length).toBe(before);
  });

  it('parks none along a primary road', () => {
    const { cars } = fleet();
    cars.parkCars();
    expect(cars.cars).toEqual([]);
  });
});

describe('the car command', () => {
  const MODELS = new Map<string, CarType>([
    ['volvo240', 'volvo'],
    ['traktor', 'traktor'],
  ]);

  it('parks a car of that model next to you, already yours', () => {
    const { cars, log, player } = fleet(),
      c = new Commands();
    cars.registerCommands(
      c,
      MODELS,
      () => 0,
      x => x.T.name,
    );
    expect(c.run('car Volvo240')).toBe('Parked a ' + specFor('volvo').name + ' next to you.');
    const parked = cars.cars.at(-1)!;
    expect(parked.owned).toBe(true);
    expect(Math.hypot(parked.x - player.x, parked.z - player.z)).toBeCloseTo(3.5);
    expect(log.models.at(-1)).toBe('volvo240');
    c.run('car traktor');
    expect(log.models.at(-1)).toBeNull(); // the tractor has no model of its own, and rolls for none
  });

  it('refuses a model it does not know, and Tab offers the ones it does', () => {
    const { cars } = fleet(),
      c = new Commands();
    cars.registerCommands(
      c,
      MODELS,
      () => 0,
      x => x.T.name,
    );
    expect(c.run('car lada')).toBe('No model called lada. Pick one of: traktor, volvo240. Usage: car <model>');
    expect(c.complete('car ')).toEqual(['traktor', 'volvo240']);
  });

  it('gets no replacement when it is sold, so the cheat adds no cars to the village', () => {
    const { cars } = fleet({ r: [STREET] }),
      c = new Commands();
    cars.registerCommands(
      c,
      MODELS,
      () => 0,
      x => x.T.name,
    );
    c.run('car volvo240');
    const sold = cars.cars.pop()!;
    cars.replaceSold(sold, { x: 0, z: 0 });
    expect(cars.cars).toEqual([]);
  });
});

describe("Skroten's lot", () => {
  // two spots side by side, as close as the yard's fresh row puts them, far from the fixture's player at (0, -800);
  // the parked cars roll no paint, so their colour is the type's first
  const LOT: CarForSale[] = [
    { x: 100, z: 0, h: 0.5, type: 'volvo', model: 'volvo240', colour: '#123456', kr: 2000 },
    { x: 102.9, z: 0, h: 0.5, type: 'saab', model: 'micra-k11', colour: '#654321', kr: 1000 },
  ];

  it('parks each car for sale on its spot at its price, and selling one back parks no replacement', () => {
    const { cars, log } = fleet({ r: [STREET] });
    cars.parkForSale(LOT);
    expect(cars.cars.map(c => [c.type, c.x, c.z, c.h, c.mode, c.saleKr])).toEqual([
      ['volvo', 100, 0, 0.5, 'parked', 2000],
      ['saab', 102.9, 0, 0.5, 'parked', 1000],
    ]);
    expect(log.models).toEqual(['volvo240', 'micra-k11']);
    const sold = cars.cars.pop()!;
    cars.replaceSold(sold, { x: 0, z: 0 });
    expect(cars.cars.length).toBe(1);
  });
});
