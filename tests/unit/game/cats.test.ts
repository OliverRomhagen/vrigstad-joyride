import * as THREE from 'three';
import { describe, expect, it } from 'vitest';
import { type Cat, type CatCar, CatColony, type CatDeps, canTend } from '../../../src/game/cats';
import type { BuildingIndex } from '../../../src/world/buildings';

// A colony with no houses (so nothing spawns), flat dry ground and the player at the origin, walking.
function colony(water: (x: number, z: number) => boolean = () => false) {
  const toasts: string[] = [];
  const player = { x: 0, z: 0, speed: 0 };
  const drive = { inCar: false, pcar: null as CatCar | null, cars: [] as CatCar[] };
  const pockets = { treats: 0 };
  const deps: CatDeps = {
    scene: new THREE.Scene(),
    // only what the cats touch; a real index needs the map data
    buildings: { collide: () => false, grid: new Map(), footprints: [] } as unknown as BuildingIndex,
    inWater: water,
    groundAt: () => 0,
    half: 1100,
    coarse: false,
    wrap: a => Math.atan2(Math.sin(a), Math.cos(a)),
    geoCache: {},
    boxGeo: () => new THREE.BufferGeometry(),
    paintMat: new THREE.MeshBasicMaterial(),
    blob: () => {},
    cars: drive.cars,
    toast: msg => {
      toasts.push(msg);
    },
    player,
    keys: {},
    joy: { on: false },
    kmenu: { hidden: true },
    get inCar() {
      return drive.inCar;
    },
    get pcar() {
      return drive.pcar;
    },
    inside: null,
    useTreat: () => {
      if (pockets.treats <= 0) return false;
      pockets.treats--;
      return true;
    },
    scratched: () => {},
  };
  const c = new CatColony(deps);
  const cat: Cat = {
    x: 1,
    z: 0,
    h: 0,
    want: 0,
    state: 'sit',
    t: 5,
    nope: 0,
    phase: 0,
    mesh: new THREE.Mesh(),
    epa: null,
    hop: null,
    ride: null,
    pets: 0,
    owned: false,
    name: 'Kisse',
  };
  c.cats.push(cat);
  deps.scene.add(cat.mesh);
  return { c, cat, player, toasts, drive, pockets };
}

// pets until the cat asks to be adopted; returns how many tries it took
function petUntilReady(c: CatColony, cat: Cat) {
  for (let i = 1; i <= 200; i++) {
    cat.nope = 0;
    if (c.pet(cat)) return i;
  }
  throw new Error('never ready');
}

describe('owning a cat', () => {
  it('asks to be adopted on the third good pet, not before', () => {
    const { c, cat } = colony();
    petUntilReady(c, cat);
    expect(cat.pets).toBe(3);
  });

  it('a scratch or a bolt starts the count over', () => {
    const { c, cat } = colony();
    let run = 0;
    for (let i = 0; i < 200; i++) {
      cat.nope = 0;
      const before = cat.pets,
        ready = c.pet(cat);
      if (cat.pets === before + 1) run++;
      else {
        expect(cat.pets).toBe(0);
        run = 0;
      } // good: one more; bad: back to zero
      expect(ready).toBe(run === 3);
      if (ready) return;
    }
    throw new Error('never ready');
  });

  it('needs three good pets again after a no', () => {
    const { c, cat } = colony();
    petUntilReady(c, cat);
    c.decline(cat);
    expect(cat.pets).toBe(0);
    petUntilReady(c, cat);
    expect(cat.pets).toBe(3);
  });

  it('an adopted cat always purrs and never asks again', () => {
    const { c, cat, toasts } = colony();
    petUntilReady(c, cat);
    c.adopt(cat);
    expect(c.owned).toBe(cat);
    toasts.length = 0;
    for (let i = 0; i < 20; i++) {
      cat.nope = 0;
      expect(c.pet(cat)).toBe(false);
    }
    expect(toasts.every(t => !t.includes('AJAJAJ'))).toBe(true);
  });

  it('petting your own cat keeps your treats; its menu gives them, one at a time, while you have any', () => {
    const { c, cat, pockets, toasts } = colony();
    petUntilReady(c, cat);
    c.adopt(cat);
    pockets.treats = 1;
    cat.nope = 0;
    c.pet(cat);
    expect(pockets.treats).toBe(1);
    expect(toasts.at(-1)).not.toContain('godisbit');
    expect(c.treat(cat)).toBe(true);
    expect(pockets.treats).toBe(0);
    expect(c.treat(cat)).toBe(false);
  });

  it('a stray takes no treat from its menu, and still gets one with a pet', () => {
    const { c, cat, pockets } = colony();
    pockets.treats = 2;
    expect(c.treat(cat)).toBe(false);
    expect(pockets.treats).toBe(2);
    c.pet(cat);
    expect(pockets.treats).toBe(1);
  });

  it('playing makes your cat pounce a little way off and land sitting', () => {
    const { c, cat, player } = colony();
    petUntilReady(c, cat);
    c.adopt(cat);
    const x = cat.x,
      z = cat.z;
    c.play(cat);
    expect(cat.state).toBe('hop');
    expect(c.nearest()).toBeNull(); // no menu mid-pounce
    for (let i = 0; i < 20; i++) c.update(player, 1 / 30);
    expect(cat.state).toBe('sit');
    expect(Math.hypot(cat.x - x, cat.z - z)).toBeCloseTo(0.8);
  });

  it('a second cat cannot be adopted while you own one', () => {
    const { c, cat } = colony();
    petUntilReady(c, cat);
    c.adopt(cat);
    const other: Cat = { ...cat, mesh: new THREE.Mesh(), owned: false, pets: 0 };
    c.cats.push(other);
    for (let i = 0; i < 50; i++) {
      other.nope = 0;
      expect(c.pet(other)).toBe(false);
    }
  });

  it('follows the player, stays out of the way, and is never despawned', () => {
    const { c, cat, player } = colony();
    c.adopt(cat);
    player.x = 30;
    for (let i = 0; i < 600; i++) c.update(player, 1 / 30);
    expect(Math.hypot(cat.x - player.x, cat.z - player.z)).toBeLessThan(3);
    expect(Math.hypot(cat.x - player.x, cat.z - player.z)).toBeGreaterThan(1.6); // outside petting reach while it follows
    player.x = 1000; // far past the despawn radius
    c.update(player, 1 / 30);
    expect(c.cats).toContain(cat);
    expect(Math.hypot(cat.x - player.x, cat.z - player.z)).toBeLessThan(10); // caught up out of sight
  });
});

describe('your cat rides along', () => {
  // a car of this type 6 m from the player, with the player in it
  function getIn(type: string) {
    const t = colony(),
      car: CatCar = { type, x: 6, z: 0, h: 0, v: 0, mesh: new THREE.Object3D() };
    t.drive.cars.push(car);
    t.c.adopt(t.cat);
    t.drive.inCar = true;
    t.drive.pcar = car;
    return { ...t, car };
  }
  const run = (c: CatColony, p: { x: number; z: number }, s: number) => {
    for (let i = 0; i < s * 30; i++) c.update(p, 1 / 30);
  };

  for (const [type, y] of [
    ['epa', 0.77],
    ['traktor', 2.72],
    ['volvo', 0.8],
    ['saab', 0.8],
    ['polis', 0.8],
  ] as const) {
    it(`gets into the ${type} and sits ${y} m up`, () => {
      const { c, cat, car, player } = getIn(type);
      run(c, player, 3);
      expect(cat.ride).toBe(car);
      expect(cat.mesh.parent).toBe(car.mesh);
      expect(cat.mesh.position.y).toBeCloseTo(y);
      expect(cat.mesh.visible).toBe(type === 'epa' || type === 'traktor'); // inside a car it is hidden behind the glass
    });
  }

  it('gets out when you do, and follows you again', () => {
    const { c, cat, car, player, drive } = getIn('volvo');
    run(c, player, 3);
    drive.inCar = false;
    drive.pcar = null;
    run(c, player, 4);
    expect(cat.ride).toBeNull();
    expect(car.cat).toBeNull();
    expect(cat.mesh.visible).toBe(true);
    expect(Math.hypot(cat.x - player.x, cat.z - player.z)).toBeLessThan(3);
  });

  it('lands on the side away from you, out of petting reach, so E gets you back in', () => {
    const { c, cat, car, player, drive } = getIn('volvo');
    run(c, player, 3);
    player.x = car.x - 2;
    player.z = car.z; // getting out puts you 2 m to the car's left
    drive.inCar = false;
    drive.pcar = null;
    run(c, player, 0.6); // the hop down
    expect(cat.x).toBeGreaterThan(car.x);
    expect(cat.state).not.toBe('walk'); // it doesn't wander off
    run(c, player, 4);
    expect(c.nearest()).toBeNull();
    expect(Math.hypot(cat.x - player.x, cat.z - player.z)).toBeLessThan(3);
  });

  it('makes a stray on the EPA flak hop off', () => {
    const { c, cat, car, player } = getIn('epa');
    const stray: Cat = { ...cat, mesh: new THREE.Mesh(), owned: false, x: 6, z: 0, state: 'sit', ride: car };
    car.mesh.add(stray.mesh);
    car.cat = stray;
    c.cats.push(stray);
    run(c, player, 3);
    expect(cat.ride).toBe(car);
    expect(stray.ride).toBeNull();
  });

  it('stays put when the car is out of reach', () => {
    const { c, cat, car, player } = getIn('volvo');
    car.x = 500;
    run(c, player, 3);
    expect(cat.ride).toBeNull();
  });
});

describe('sending your cat home, calling it and setting it free', () => {
  const run = (c: CatColony, p: { x: number; z: number }, s: number) => {
    for (let i = 0; i < s * 30; i++) c.update(p, 1 / 30);
  };

  it('goes home out of the world, even from a car, and comes back running when called', () => {
    const { c, cat, player, drive } = colony();
    const car: CatCar = { type: 'volvo', x: 2, z: 0, h: 0, v: 0, mesh: new THREE.Object3D() };
    c.adopt(cat);
    drive.inCar = true;
    drive.pcar = car;
    run(c, player, 3);
    expect(cat.ride).toBe(car);
    c.sendHome();
    expect(c.home).toBe(true);
    expect(c.cats).not.toContain(cat);
    expect(car.cat).toBeNull();
    expect(cat.mesh.parent).toBeNull();
    drive.inCar = false;
    drive.pcar = null;
    c.call(player);
    expect(c.home).toBe(false);
    expect(c.cats).toContain(cat);
    expect(cat.mesh.visible).toBe(true);
    expect(Math.hypot(cat.x - player.x, cat.z - player.z)).toBeGreaterThan(10); // out of sight at first
    run(c, player, 15);
    expect(Math.hypot(cat.x - player.x, cat.z - player.z)).toBeLessThan(3);
  });

  it('set free, it is a stray again: it stops following and can be adopted anew', () => {
    const { c, cat, player } = colony();
    c.adopt(cat);
    c.setFree();
    expect(c.owned).toBeNull();
    expect(cat.owned).toBe(false);
    player.x = 30;
    run(c, player, 10);
    expect(Math.hypot(cat.x - player.x, cat.z - player.z)).toBeGreaterThan(20);
    player.x = 0;
    cat.x = 1;
    cat.z = 0;
    petUntilReady(c, cat);
  });

  it('set free while at home, it is gone for good', () => {
    const { c, cat } = colony();
    c.adopt(cat);
    c.sendHome();
    c.setFree();
    expect(c.home).toBe(false);
    expect(c.owned).toBeNull();
    expect(c.cats).not.toContain(cat);
  });
});

describe('strays on the EPA flak', () => {
  const run = (c: CatColony, p: { x: number; z: number }, s: number) => {
    for (let i = 0; i < s * 30; i++) c.update(p, 1 / 30);
  };
  // a standing EPA by a sitting stray, the player out of the way
  function epaScene() {
    const t = colony(),
      car: CatCar = { type: 'epa', x: 4, z: 0, h: 0, v: 0, mesh: new THREE.Object3D() };
    t.drive.cars.push(car);
    t.player.x = -20;
    return { ...t, car };
  }

  it('trots over, hops on, rides while it drives, and hops off once it has stood still a while', () => {
    const { c, cat, car, player } = epaScene();
    for (let i = 0; i < 3000 && !cat.ride; i++) {
      if (cat.state === 'walk' || cat.state === 'flee') {
        cat.state = 'sit';
        cat.t = 99;
      }
      c.update(player, 1 / 30);
    }
    expect(cat.ride).toBe(car);
    expect(car.cat).toBe(cat);
    car.v = 5;
    run(c, player, 5); // driving: it stays on, whatever its timer says
    expect(cat.ride).toBe(car);
    car.v = 0; // standing: it gets off within a couple of minutes (and may come back on later)
    let off = false;
    for (let i = 0; i < 120 * 30 && !off; i++) {
      c.update(player, 1 / 30);
      off = !cat.ride && cat.state !== 'hop' && !car.cat;
    }
    expect(off).toBe(true);
  });

  it('adopted mid-hop onto the flak, it lands on the ground and leaves the EPA free', () => {
    const { c, cat, car, player } = epaScene();
    for (let i = 0; i < 3000 && cat.state !== 'hop'; i++) {
      if (cat.state === 'walk' || cat.state === 'flee') {
        cat.state = 'sit';
        cat.t = 99;
      }
      c.update(player, 1 / 30);
    }
    expect(cat.hop?.onto).toBe(car);
    c.adopt(cat);
    run(c, player, 2);
    expect(cat.ride).toBeNull();
    expect(car.cat).toBeNull();
  });

  it('your cat sent home mid-hop into your car leaves the car free', () => {
    const { c, cat, car, player, drive } = epaScene();
    c.adopt(cat);
    cat.x = 2; // within hopping reach of the EPA
    drive.inCar = true;
    drive.pcar = car;
    c.update(player, 1 / 30);
    expect(cat.hop?.onto).toBe(car);
    c.sendHome();
    expect(car.cat).toBeNull();
    expect(cat.hop).toBeNull();
  });
});

describe('your cat and water', () => {
  it('catches up on dry land when it ends up in the lake', () => {
    const wet = (x: number) => x > 50; // a lake east of x = 50
    const { c, cat, player } = colony(wet);
    c.adopt(cat);
    cat.x = 60; // in the lake
    for (let i = 0; i < 30; i++) c.update(player, 1 / 30);
    expect(wet(cat.x)).toBe(false);
    expect(Math.hypot(cat.x - player.x, cat.z - player.z)).toBeLessThan(10);
  });
});

describe('naming your cat', () => {
  it('takes a trimmed name of at most 16 characters, ignores a blank one, and uses it when you talk to it', () => {
    const { c, cat, toasts } = colony();
    expect(cat.name).toBe('Kisse');
    c.rename('  Måns  ');
    expect(cat.name).toBe('Kisse'); // not yours yet
    c.adopt(cat);
    c.rename('  Måns  ');
    expect(cat.name).toBe('Måns');
    c.rename('   ');
    expect(cat.name).toBe('Måns');
    c.rename('Kattis von Vrigstad den Store');
    expect(cat.name).toBe('Kattis von Vrigs');
    c.rename('Måns');
    c.sendHome();
    expect(toasts.at(-1)).toContain('Måns');
  });
});

describe("a cat's menu", () => {
  const player = { x: 0, z: 0 };
  it("stays open while you are on foot within 4 m and the cat isn't running off", () => {
    expect(canTend({ x: 3.9, z: 0, state: 'sit' }, player, false)).toBe(true);
    expect(canTend({ x: 0, z: 2, state: 'follow' }, player, false)).toBe(true); // your own cat, following you
    expect(canTend({ x: 4, z: 0, state: 'sit' }, player, false)).toBe(false);
    expect(canTend({ x: 3, z: 3, state: 'follow' }, player, false)).toBe(false); // 4.24 m away
  });
  it('closes when the cat bolts or you get in a car', () => {
    expect(canTend({ x: 1, z: 0, state: 'flee' }, player, false)).toBe(false);
    expect(canTend({ x: 1, z: 0, state: 'sit' }, player, true)).toBe(false);
  });
});
