import { describe, expect, it } from 'vitest';
import { type Car, type CarMode, Fleet, type TrafficCar, TURBO_AT } from '../../../src/game/cars';
import { DMG_MAX } from '../../../src/game/health';
import { type CarType, specFor } from '../../../src/game/sim/vehicle-spec';
import { BuildingIndex } from '../../../src/world/buildings';
import { ROAD_WIDTH_M, RoadClass, type WorldData } from '../../../src/world/data';
import { makeRnd } from '../../../src/world/random';
import { RoadNetwork } from '../../../src/world/roads';
import { Water } from '../../../src/world/water';
import { makeWorld } from '../world/fixture';

const DT = 1 / 60;
const SIZE_M = 2000; // big enough that no test reaches the map's edge
// a primary road from south to north along x = 0, and a street across it at z = 0
const MAIN_ROAD = { c: RoadClass.PRIMARY, n: 'Storgatan', p: [0, 900, 0, -900] };
const STREET = { c: RoadClass.STREET, n: 'Gästgivaregatan', p: [-600, 0, 600, 0] };

/** A car as main.ts's addCar makes it, without the meshes. */
function newCar(type: CarType, x: number, z: number, h: number, mode: CarMode): Car {
  return {
    type,
    T: specFor(type),
    x,
    z,
    h,
    vh: h,
    v: 0,
    st: 0,
    thr: 0,
    slip: 0,
    drift: 0,
    charge: 0,
    yr: 0,
    spin: 0,
    loose: 0,
    flickDir: 0,
    flickT: 9,
    flickHeld: 0,
    boost: 0,
    mode,
    wet: false,
    owned: false,
    blocked: 0,
    ghost: 0,
    stuck: 0,
    rev: 0,
    revSteer: 1,
    dmg: 0,
    hitAt: -9,
  };
}

function fleet(world: Partial<WorldData> = { r: [MAIN_ROAD] }, canPark = (_x: number, _z: number) => true) {
  const data = makeWorld({ size: SIZE_M, ...world });
  const roads = new RoadNetwork(data, { heightAt: () => 0 });
  const rnd = makeRnd(1);
  const log = { crashes: [] as [Car, Car | null][], rammed: [] as Car[], placed: new Set<Car>() };
  const player = { x: 0, z: -800 };
  const cars: Fleet = new Fleet({
    roads,
    buildings: new BuildingIndex(data),
    water: new Water(data, roads),
    half: SIZE_M / 2,
    rnd,
    pick: a => a[Math.floor(rnd() * a.length)],
    addCar: (type, x, z, h, mode) => {
      const c = newCar(type, x, z, h, mode);
      cars.cars.push(c);
      return c;
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
  return { cars, log, player };
}

/** Drives `c` for `s` seconds with the same inputs every frame. */
function driveFor(f: Fleet, c: Car, s: number, thr: number, steer: number, brake: boolean, canDrift = false) {
  for (let t = 0; t < s; t += DT) f.drive(c, thr, steer, brake, DT, canDrift);
}

describe('drive', () => {
  it('speeds up under full throttle, and never past the top speed', () => {
    const { cars } = fleet();
    const c = newCar('volvo', 0, 800, 0, 'player');
    let fastest = 0;
    for (let t = 0; t < 20; t += DT) {
      cars.drive(c, 1, 0, false, DT);
      fastest = Math.max(fastest, c.v);
    }
    expect(c.v).toBeGreaterThan(c.T.max * 0.8);
    expect(fastest).toBeLessThanOrEqual(c.T.max);
    expect(c.z).toBeLessThan(800); // heading 0 is north, towards -z
  });

  it('is slower off the road', () => {
    const { cars } = fleet();
    const c = newCar('volvo', 300, 800, 0, 'player');
    driveFor(cars, c, 20, 1, 0, false);
    expect(c.v).toBeLessThanOrEqual(c.T.max * c.T.off);
  });

  it('brakes to a stop', () => {
    const { cars } = fleet();
    const c = newCar('volvo', 0, 800, 0, 'player');
    c.v = 20;
    driveFor(cars, c, 2, 0, 0, true);
    expect(c.v).toBe(0);
  });

  it('drifts on brake and steering at speed, but only for the player', () => {
    const { cars } = fleet();
    const you = newCar('volvo', 0, 800, 0, 'player'),
      police = newCar('polis', 0, 600, 0, 'police');
    you.v = police.v = 20;
    cars.drive(you, 0, 1, true, DT, true);
    cars.drive(police, 0, 1, true, DT);
    expect(you.drift).toBe(1);
    expect(police.drift).toBe(0);
  });

  it('fires a mini-turbo when a long enough slide ends', () => {
    const { cars } = fleet();
    const c = newCar('volvo', 0, 800, 0, 'player');
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
    const c = newCar('volvo', 0, 800, 0, 'player');
    c.dmg = DMG_MAX;
    c.v = 10;
    driveFor(cars, c, 1, 1, 0, false);
    expect(c.v).toBeLessThan(10);
    expect(c.thr).toBe(0);
  });

  it('crashes into a car it hits and pushes a parked one away', () => {
    const { cars, log } = fleet();
    const c = newCar('volvo', 0, 800, 0, 'player'),
      parked = newCar('saab', 0, 798, 0, 'parked');
    cars.cars.push(c, parked);
    c.v = 10;
    cars.drive(c, 0, 0, false, DT);
    expect(log.crashes).toContainEqual([c, parked]);
    expect(parked.z).toBeLessThan(798);
    expect(log.placed.has(parked)).toBe(true);
  });

  it('reports ramming a police car only at speed', () => {
    const { cars, log } = fleet();
    const c = newCar('volvo', 0, 800, 0, 'player'),
      police = newCar('polis', 0, 798, 0, 'police');
    cars.cars.push(c, police);
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

  it('waits behind a car, and drives through it after 6 s', () => {
    const { cars } = fleet();
    // 400 m along the main road from its south end, heading north
    const c = Object.assign(newCar('volvo', 0, 500, 0, 'ai'), {
      ri: 0,
      a: 0,
      dir: 1,
      t: 400,
      first: true,
    }) as TrafficCar;
    cars.cars.push(c);
    cars.updateTraffic(c, DT); // the first frame puts it in its lane
    cars.cars.push(newCar('saab', c.x + Math.sin(c.h) * 6, c.z - Math.cos(c.h) * 6, c.h, 'parked'));
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

  it('parks none along a primary road', () => {
    const { cars } = fleet();
    cars.parkCars();
    expect(cars.cars).toEqual([]);
  });
});
