// Cats: lounge by the house walls, wander a little, bolt from cars and running feet, and can be petted.
// Moved from src/game/main.ts (#177); main.ts passes in what the cats read from the rest of the game.
import * as THREE from 'three';
import { BUILDING_CELL_M as BC, type BuildingIndex } from '../world/buildings';
import { clamp } from '../world/math';
import { pointInPolygon as inPoly } from '../world/polygon';
import { makeRnd } from '../world/random';

const CAT_NEAR = 150, CAT_FAR = 210;   // spawn / despawn radius around the player (m)
const CAT_WALK = 0.7, CAT_RUN = 6.5, CAT_PET_M = 1.6;               // m/s, m/s, reach to pet (m)
const CAT_SCARE_CAR_M = 12, CAT_SCARE_RUN_M = 5;                    // a moving car / sprinting player closer than this sends it running
// [coat, ears and paws, chest and muzzle (optional)]
const CAT_COLS = [['#d9822b', '#f0e0c8'], ['#1e1e20', '#1e1e20'], ['#7d7f84', '#e8e4dc'], ['#ece9e2', '#ece9e2'], ['#8a6a48', '#3f3226'], ['#1e1e20', '#ece9e2', '#ece9e2']];
const CAT_PET_OK = 0.5, CAT_PET_TREAT_OK = 0.75;   // chance a pet goes well, without / with a treat
const CAT_SCRATCH_S = 5, CAT_PET_S = 3;            // after a scratch / a good pet the cat can't be petted for this long (s), so E can't be spammed for better odds
// \n puts each speaker on their own line in the toast: the cat first, then the player
const CAT_PET = ['”Mjau.”\n”Ja du ä la en go kisse, du.”', '”Prrrrr…”\n”Hör på’n, han spinner som en EPA-traktor!”', '”Kiss kiss kiss… nämen kom hit då, lilla vän.”',
  '”Där ja, bakom örona. Dä gillar du, va?”'];
const CAT_SCRATCH = ['Dä kommer svida ett tag.', 'Dä kommer synas i mårra.', 'Din lilla skitkatt!'].map(t => '”AJAJAJ! Kattafan rev mä! ' + t + '”');
const CAT_BOLT = ['”Nä men vart ska du? Kom tebaks!”', '”Mjäu!”\n”Jaha, där sprang du. Dä va la dä då.”', '”Du behöver inte springa iväg! Ja ä la inte farli, din lilla fjant!”'];

type Point = { x: number; z: number };
export interface Cat extends Point { h: number; want: number; state: 'sit' | 'walk' | 'flee'; t: number; nope: number; phase: number; mesh: THREE.Mesh }

/** What the cats read from the rest of the game. The getters are read when used, so main.ts can declare those later. */
export interface CatDeps {
  scene: THREE.Scene;
  buildings: BuildingIndex;
  inWater(x: number, z: number): boolean;
  groundAt(x: number, z: number): number;
  half: number;                          // half the playable square's side (m)
  coarse: boolean;                       // touch screen: fewer cats
  wrap(a: number): number;
  geoCache: Record<string, THREE.BufferGeometry>;
  boxGeo(parts: (number | string)[][]): THREE.BufferGeometry;
  paintMat: THREE.Material;
  blob(parent: THREE.Object3D, w: number, l: number): void;
  cars: readonly (Point & { v: number })[];
  toast(msg: string, secs: number): void;
  readonly player: Point & { speed: number };
  readonly keys: Record<string, boolean | undefined>;
  readonly joy: { on: boolean };
  readonly kmenu: HTMLElement;
  readonly inCar: boolean;
  readonly inside: unknown;
  /** takes a treat from the player's pockets if there is one */
  useTreat(): boolean;
}

/** The cats around the player: spawns them by the house walls, moves them, and lets the player pet one. */
export class CatColony {
  /** the live cats, in spawn order */
  readonly cats: Cat[] = [];
  private readonly g: CatDeps;
  private readonly max: number;   // count around the player
  private readonly rnd = makeRnd(9094);
  private readonly collide: BuildingIndex['collide'];
  private spawnT = 0;              // s until the next spawn check
  private lastX = 1e9;             // where the player was at the last spawn check (m)
  private lastZ = 1e9;

  constructor(g: CatDeps) {
    this.g = g;
    this.max = g.coarse ? 8 : 14;
    this.collide = g.buildings.collide.bind(g.buildings);
  }

  /** Despawns far cats, spawns near ones, and moves every cat; T is where the player (or their car) is. */
  update(T: Point, dt: number) {
    const { cats } = this;
    this.spawnT -= dt;
    if (this.spawnT <= 0) { this.spawnT = 0.5;
      const jump = Math.hypot(T.x - this.lastX, T.z - this.lastZ) > 120; this.lastX = T.x; this.lastZ = T.z;
      for (let i = cats.length - 1; i >= 0; i--) if (Math.hypot(cats[i].x - T.x, cats[i].z - T.z) > CAT_FAR) { this.g.scene.remove(cats[i].mesh); cats.splice(i, 1); }
      for (let i = 0; i < (jump ? 30 : 2) && cats.length < this.max; i++) this.spawn(T, jump ? 4 : 80);
    }
    for (const k of cats) this.updateCat(k, dt);
  }

  /** E goes to the closer of a cat and a place, so a cat sitting by the kiosk or a safehouse door can still be petted. */
  catFirst(kt: Cat | null, pl: Point | null) { const { player } = this.g; return !!kt && (!pl || this.g.kmenu.hidden && Math.hypot(kt.x - player.x, kt.z - player.z) < Math.hypot(pl.x - player.x, pl.z - player.z)); }

  /** The cat within petting reach of the player, if one is calm enough. */
  nearest() { const g = this.g; if (g.inCar || g.inside) return null; const { player } = g; let best: Cat | null = null, bd = CAT_PET_M;
    for (const k of this.cats) { const d = Math.hypot(k.x - player.x, k.z - player.z); if (d < bd && k.state !== 'flee' && k.nope <= 0) { bd = d; best = k; } } return best; }

  /** Pets a cat: it purrs, scratches or bolts. A treat goes into the cat whatever happens next. */
  pet(k: Cat) {
    const { player, toast } = this.g, treat = this.g.useTreat(), r = this.rnd(), pre = treat ? '”Här, en godisbit.”\n' : '';
    k.want = Math.atan2(player.x - k.x, -(player.z - k.z));
    if (r < (treat ? CAT_PET_TREAT_OK : CAT_PET_OK)) { k.state = 'sit'; k.t = 6 + this.rnd() * 6; k.nope = CAT_PET_S; toast(pre + this.pick(CAT_PET), 3); }
    else if (this.rnd() < 0.5) { k.state = 'sit'; k.t = 3 + this.rnd() * 4; k.nope = CAT_SCRATCH_S; toast(pre + this.pick(CAT_SCRATCH), 3.5); }
    else { k.state = 'flee'; k.t = 2 + this.rnd(); k.want = Math.atan2(k.x - player.x, -(k.z - player.z)); toast(pre + this.pick(CAT_BOLT), 3); }
  }

  private pick<T>(a: T[]) { return a[Math.floor(this.rnd() * a.length)]; }

  private geo(c: string[]) {
    const { geoCache, boxGeo } = this.g;
    return geoCache['cat' + c] || (geoCache['cat' + c] = boxGeo([[0.2, 0.17, 0.42, 0, 0.2, 0, c[0]], [0.17, 0.15, 0.15, 0, 0.31, -0.25, c[0]],
      [0.05, 0.06, 0.03, -0.05, 0.41, -0.26, c[1]], [0.05, 0.06, 0.03, 0.05, 0.41, -0.26, c[1]], [0.03, 0.03, 0.01, -0.04, 0.33, -0.33, '#c8d24a'], [0.03, 0.03, 0.01, 0.04, 0.33, -0.33, '#c8d24a'],
      [0.05, 0.13, 0.05, -0.07, 0.06, -0.15, c[1]], [0.05, 0.13, 0.05, 0.07, 0.06, -0.15, c[1]], [0.05, 0.13, 0.05, -0.07, 0.06, 0.15, c[1]], [0.05, 0.13, 0.05, 0.07, 0.06, 0.15, c[1]],
      [0.04, 0.3, 0.04, 0, 0.4, 0.22, c[0]], ...(c[2] ? [[0.14, 0.12, 0.02, 0, 0.21, -0.215, c[2]], [0.09, 0.05, 0.01, 0, 0.27, -0.33, c[2]]] : [])]));
  }

  // a spot just outside a random wall of a house in the cell around (x, z)
  private spawn(T: Point, minD: number) {
    const { grid: bGrid, footprints: bPolys } = this.g.buildings, { inWater, paintMat, blob, scene } = this.g, HALF = this.g.half, rnd = this.rnd;
    for (let t = 0; t < 10; t++) {
      const ang = rnd() * Math.PI * 2, dist = minD + rnd() * (CAT_NEAR - minD), l = bGrid.get(Math.floor((T.x + Math.sin(ang) * dist) / BC) + ',' + Math.floor((T.z + Math.cos(ang) * dist) / BC));
      if (!l) continue;
      const p = bPolys[this.pick(l)].p, i = Math.floor(rnd() * p.length / 2) * 2, j = (i + 2) % p.length, ex = p[j] - p[i], ez = p[j + 1] - p[i + 1], len = Math.hypot(ex, ez); if (len < 2) continue;
      const s = rnd(), mx = p[i] + ex * s, mz = p[i + 1] + ez * s, out = 0.6 + rnd() * 1.4; let nx = ez / len, nz = -ex / len;
      if (inPoly(p, mx + nx * 0.3, mz + nz * 0.3)) { nx = -nx; nz = -nz; }
      const o = { x: mx + nx * out, z: mz + nz * out }; this.collide(o, 0.3);
      if (Math.abs(o.x) > HALF - 10 || Math.abs(o.z) > HALF - 10 || inWater(o.x, o.z) || Math.hypot(o.x - T.x, o.z - T.z) < minD) continue;
      const mesh = new THREE.Mesh(this.geo(this.pick(CAT_COLS)), paintMat); mesh.castShadow = true; mesh.rotation.order = 'YXZ'; mesh.scale.setScalar(1.1 + rnd() * 0.25); blob(mesh, 0.32, 0.55);
      const k: Cat = { x: o.x, z: o.z, h: Math.atan2(nx, -nz), want: 0, state: 'sit', t: 3 + rnd() * 15, nope: 0, phase: 0, mesh }; k.want = k.h;
      scene.add(mesh); this.cats.push(k); return;
    }
  }

  private updateCat(k: Cat, dt: number) {
    const g = this.g, { player, wrap, inWater, groundAt } = g, HALF = g.half, rnd = this.rnd;
    let fx = 0, fz = 0;
    for (const c of g.cars) if (Math.abs(c.v) > 2) { const dx = k.x - c.x, dz = k.z - c.z, d = Math.hypot(dx, dz); if (d < CAT_SCARE_CAR_M && d > 0.01) { fx += dx / d; fz += dz / d; } }
    if (!g.inCar && !g.inside && (g.joy.on ? player.speed > 7.5 : g.keys.run && player.speed > 6)) {   // the stick passes 6 m/s on a normal push, so only a full push counts
      const dx = k.x - player.x, dz = k.z - player.z, d = Math.hypot(dx, dz); if (d < CAT_SCARE_RUN_M && d > 0.01) { fx += dx / d; fz += dz / d; } }
    if (fx || fz) { k.state = 'flee'; k.t = 1.5 + rnd(); k.want = Math.atan2(fx, -fz); }
    k.t -= dt; if (k.nope > 0) k.nope -= dt;
    if (k.t <= 0) { if (k.state === 'sit') { k.state = 'walk'; k.t = 2 + rnd() * 4; k.want = rnd() * Math.PI * 2; } else { k.state = 'sit'; k.t = 4 + rnd() * 16; } }
    const sp = k.state === 'flee' ? CAT_RUN : k.state === 'walk' ? CAT_WALK : 0;
    k.h = wrap(k.h + wrap(k.want - k.h) * Math.min(1, dt * (sp > 1 ? 10 : 3)));
    if (sp) { const nx = k.x + Math.sin(k.h) * sp * dt, nz = k.z - Math.cos(k.h) * sp * dt;
      if (inWater(nx, nz)) k.want = wrap(k.h + Math.PI); else { k.x = clamp(nx, -HALF + 2, HALF - 2); k.z = clamp(nz, -HALF + 2, HALF - 2); }
      if (this.collide(k, 0.25) && k.state === 'walk') k.want = wrap(k.h + (rnd() < 0.5 ? 1.6 : -1.6));
      k.phase += sp * dt * 9; }
    k.mesh.position.set(k.x, groundAt(k.x, k.z) + (sp ? Math.abs(Math.sin(k.phase)) * 0.03 : 0), k.z); k.mesh.rotation.y = -k.h;
    k.mesh.rotation.x += ((k.state === 'sit' ? 0.3 : 0) - k.mesh.rotation.x) * Math.min(1, dt * 4);   // sitting: front up, rear down
  }
}
