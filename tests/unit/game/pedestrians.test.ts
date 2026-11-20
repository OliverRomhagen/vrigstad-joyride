import * as THREE from 'three';
import { describe, expect, it } from 'vitest';
import {
  Crowd,
  type CrowdDeps,
  MAD_GIVE_UP_M,
  MAD_S,
  type Npc,
  type PersonMesh,
  SHOVE_HP,
} from '../../../src/game/pedestrians';
import type { BuildingIndex } from '../../../src/world/buildings';
import type { RoadLine } from '../../../src/world/roads';

const mesh = () =>
  Object.assign(new THREE.Group(), { legs: [new THREE.Object3D(), new THREE.Object3D()] }) as PersonMesh;

// One footpath along x from -200 to 200 and no roads in the grid (so nothing spawns); the player on foot at the origin.
function crowd() {
  const toasts: string[] = [],
    hurts: number[] = [];
  const player = { x: 0, z: 0 },
    drive = { inCar: false, pcar: null as { x: number; z: number; v: number } | null },
    cars: { x: number; z: number; v: number }[] = [];
  const path: RoadLine = {
    p: [
      [-200, 0],
      [200, 0],
    ],
    c: 9,
    n: '',
  } as unknown as RoadLine;
  const deps: CrowdDeps = {
    scene: new THREE.Scene(),
    roads: { lines: [path], grid: new Map() },
    // only what the pedestrians touch; a real index needs the map data
    buildings: { collide: () => false, footprints: [] } as unknown as BuildingIndex,
    labels: [],
    groundAt: () => 0,
    coarse: false,
    wrap: a => Math.atan2(Math.sin(a), Math.cos(a)),
    rnd: () => 0.5,
    pick: a => a[0],
    personParts: mesh,
    advance: n => {
      n.dir = -n.dir;
      n.a += n.dir > 0 ? 0 : 1;
    },
    cars,
    player,
    get inCar() {
      return drive.inCar;
    },
    get pcar() {
      return drive.pcar;
    },
    toast: msg => {
      toasts.push(msg);
    },
    hurtPlayer: hp => {
      hurts.push(hp);
    },
  };
  const c = new Crowd(deps);
  // standing still on the path 30 m east of the player
  const n: Npc = {
    ri: 0,
    a: 0,
    dir: 1,
    t: 230,
    side: 1,
    speed: 1.2,
    idle: 100,
    walk: 20,
    x: 30,
    z: 0,
    h: 0,
    phase: 0,
    first: false,
    mad: 0,
    cool: 0,
    back: 0,
    mesh: mesh(),
  };
  c.npcs.push(n);
  const run = (secs: number) => {
    for (let t = 0; t < secs; t += 0.05) c.update(player, 0.05);
  };
  return { c, n, player, drive, cars, toasts, hurts, run };
}

describe('pedestrians you drive into', () => {
  it('get angry when the player hits them fast, and not when they nudge them', () => {
    const w = crowd(),
      car = { x: 31, z: 0, v: 2 };
    w.cars.push(car);
    w.drive.pcar = car;
    w.drive.inCar = true;
    w.run(0.05);
    expect(w.n.mad).toBe(0);
    car.v = 10;
    w.run(0.05);
    expect(w.n.mad).toBeGreaterThan(MAD_S - 0.1);
    expect(w.toasts).toHaveLength(1);
  });

  it('ignore other cars hitting them', () => {
    const w = crowd();
    w.cars.push({ x: 31, z: 0, v: 10 });
    w.run(0.05);
    expect(w.n.mad).toBe(0);
  });

  it('run the player down on foot and shove them', () => {
    const w = crowd();
    w.n.mad = MAD_S;
    w.run(8);
    expect(w.hurts[0]).toBe(SHOVE_HP);
    expect(Math.hypot(w.player.x, w.player.z)).toBeGreaterThan(0.5); // pushed away from where they stood
    expect(w.toasts.length).toBeGreaterThan(0);
  });

  it('give up when the player gets far away, then walk back to their path', () => {
    const w = crowd();
    w.n.mad = MAD_S;
    w.n.x = MAD_GIVE_UP_M + 10;
    w.n.z = 20;
    w.run(0.05);
    expect(w.n.mad).toBe(0);
    expect(w.n.back).toBeGreaterThan(0);
    w.run(15);
    expect(Math.abs(w.n.z)).toBeLessThan(0.5);
    expect(w.hurts).toHaveLength(0);
  });
});
