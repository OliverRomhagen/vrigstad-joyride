import * as THREE from 'three';
import { describe, expect, it } from 'vitest';
import { type Cat, CatColony, type CatDeps } from '../../../src/game/cats';
import type { BuildingIndex } from '../../../src/world/buildings';

// A colony with no houses (so nothing spawns), flat dry ground and the player at the origin, walking.
function colony() {
  const toasts: string[] = [];
  const player = { x: 0, z: 0, speed: 0 };
  const deps: CatDeps = {
    scene: new THREE.Scene(),
    // only what the cats touch; a real index needs the map data
    buildings: { collide: () => false, grid: new Map(), footprints: [] } as unknown as BuildingIndex,
    inWater: () => false,
    groundAt: () => 0,
    half: 1100,
    coarse: false,
    wrap: a => Math.atan2(Math.sin(a), Math.cos(a)),
    geoCache: {},
    boxGeo: () => new THREE.BufferGeometry(),
    paintMat: new THREE.MeshBasicMaterial(),
    blob: () => {},
    cars: [],
    toast: msg => { toasts.push(msg); },
    player,
    keys: {},
    joy: { on: false },
    kmenu: { hidden: true } as HTMLElement,
    inCar: false,
    pcar: null,
    inside: null,
    useTreat: () => false,
  };
  const c = new CatColony(deps);
  const cat: Cat = { x: 1, z: 0, h: 0, want: 0, state: 'sit', t: 5, nope: 0, phase: 0, mesh: new THREE.Mesh(), epa: null, hop: null, ride: null, pets: 0, owned: false };
  c.cats.push(cat);
  deps.scene.add(cat.mesh);
  return { c, cat, player, toasts };
}

// pets until the cat asks to be adopted; returns how many tries it took
function petUntilReady(c: CatColony, cat: Cat) {
  for (let i = 1; i <= 200; i++) { cat.nope = 0; if (c.pet(cat)) return i; }
  throw new Error('never ready');
}

describe('owning a cat', () => {
  it('asks to be adopted on the third good pet, not before', () => {
    const { c, cat } = colony();
    petUntilReady(c, cat);
    expect(cat.pets).toBe(3);
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
    for (let i = 0; i < 20; i++) { cat.nope = 0; expect(c.pet(cat)).toBe(false); }
    expect(toasts.every(t => !t.includes('AJAJAJ'))).toBe(true);
  });

  it('a second cat cannot be adopted while you own one', () => {
    const { c, cat } = colony();
    petUntilReady(c, cat);
    c.adopt(cat);
    const other: Cat = { ...cat, mesh: new THREE.Mesh(), owned: false, pets: 0 };
    c.cats.push(other);
    for (let i = 0; i < 50; i++) { other.nope = 0; expect(c.pet(other)).toBe(false); }
  });

  it('follows the player, stays out of the way, and is never despawned', () => {
    const { c, cat, player } = colony();
    c.adopt(cat);
    player.x = 30;
    for (let i = 0; i < 600; i++) c.update(player, 1 / 30);
    expect(Math.hypot(cat.x - player.x, cat.z - player.z)).toBeLessThan(3);
    expect(Math.hypot(cat.x - player.x, cat.z - player.z)).toBeGreaterThan(1.6);   // outside petting reach while it follows
    player.x = 1000;                                                                 // far past the despawn radius
    c.update(player, 1 / 30);
    expect(c.cats).toContain(cat);
    expect(Math.hypot(cat.x - player.x, cat.z - player.z)).toBeLessThan(10);         // caught up out of sight
  });
});
