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
// riding on an EPA-traktor's flak: a sitting cat near a standing EPA now and then trots over and hops up, and stays on while it drives
const CAT_EPA_M = 8, CAT_EPA_ON = 0.03, CAT_EPA_OFF = 0.08, CAT_EPA_RIDE_S = 20;   // range (m); chance per second to go for it / to hop off a standing EPA; shortest ride (s)
const CAT_TROT = 1.4, CAT_HOP_S = 0.5, FLAK_Y = 0.98;                // m/s; seconds per hop; flak floor height in the car's frame (m), where +z points backwards
const _cv = new THREE.Vector3();
type Seat = { x: number; y: number; z: number; ry: number; rx: number; inside?: boolean; hi: string };
// where a riding cat sits, in the car's frame (m; +z points backwards), how it is turned (rad; rx > 0 is sitting up), and what you say when
// your own cat gets on: on the EPA's flak looking out the back, on the tractor's cab roof, or on the back seat of any other car, where it
// is hidden (the car glass isn't see-through). Only the EPA takes cats that aren't yours. {n} is your cat's name.
const CAT_SEATS: Record<string, Seat> = { epa: { x: 0, y: FLAK_Y, z: 1.5, ry: Math.PI, rx: 0.3, hi: '”Upp på flaket mä dä, {n}!”' },
  traktor: { x: 0, y: 2.72, z: 0.8, ry: 0, rx: 0.3, hi: '”Håll i dä, {n}, nu åker vi traktor!”' },
  car: { x: 0.35, y: 0.8, z: 0.55, ry: 0, rx: 0.3, inside: true, hi: '”Mjau.”\n”Hoppa in, {n}. Baksätet ä ditt.”' } };
const CAT_BOARD_M = 3;                         // your cat hops into your car from this close (m)
// owning a cat: enough good pets of the same cat and it asks to come home with you; then it follows you on foot
export const CAT_ADOPT_PETS = 3;                      // good pets in a row of one cat before it can be adopted; a scratch or a bolt starts over
const CAT_FOLLOW_M = 2.5, CAT_FIND_M = 60;     // an owned cat walks after you when further than this (m); further than CAT_FIND_M it catches up out of sight
// [coat, ears and paws, chest and muzzle (optional)]
const CAT_COLS = [['#d9822b', '#f0e0c8'], ['#1e1e20', '#1e1e20'], ['#7d7f84', '#e8e4dc'], ['#ece9e2', '#ece9e2'], ['#8a6a48', '#3f3226'], ['#1e1e20', '#ece9e2', '#ece9e2']];
const CAT_PET_OK = 0.5, CAT_PET_TREAT_OK = 0.75;   // chance a pet goes well, without / with a treat
const CAT_SCRATCH_S = 5, CAT_PET_S = 3;            // after a scratch / a good pet the cat can't be petted for this long (s), so E can't be spammed for better odds
// \n puts each speaker on their own line in the toast: the cat first, then the player
const CAT_PET = ['”Mjau.”\n”Ja du ä la en go kisse, du.”', '”Prrrrr…”\n”Hör på’n, han spinner som en EPA-traktor!”', '”Kiss kiss kiss… nämen kom hit då, lilla vän.”',
  '”Där ja, bakom örona. Dä gillar du, va?”'];
const CAT_SCRATCH = ['Dä kommer svida ett tag.', 'Dä kommer synas i mårra.', 'Din lilla skitkatt!'].map(t => '”AJAJAJ! Kattafan rev mä! ' + t + '”');
const CAT_PET_OWN = ['”Prrrrr…”\n”Ja, du ä min katt, du.”', '”Mjau!”\n”Ja ja, vi går snart, {n}.”', '”Där ja. Vem ä en go kisse? {n} ä en go kisse.”'];   // {n}: its name
export const CAT_NAME = 'Kisse', CAT_NAME_MAX = 16;   // a new cat's name until you give it one; longest name (characters)
const CAT_BOLT = ['”Nä men vart ska du? Kom tebaks!”', '”Mjäu!”\n”Jaha, där sprang du. Dä va la dä då.”', '”Du behöver inte springa iväg! Ja ä la inte farli, din lilla fjant!”'];

type Point = { x: number; z: number };
/** A car as the cats see it; `cat` is the cat on (or hopping onto) an EPA's flak. */
export interface CatCar extends Point { type: string; v: number; h: number; mesh: THREE.Object3D; cat?: Cat | null; trimmad?: boolean }
/** A hop onto a car (`onto`, to `seat`) or down to the ground at (tx, tz). */
interface Hop { x0: number; y0: number; z0: number; onto: CatCar | null; tx: number; tz: number; p: number; seat: Seat }
export interface Cat extends Point { name: string; h: number; want: number; state: 'sit' | 'walk' | 'flee' | 'epa' | 'hop' | 'follow'; t: number; nope: number; phase: number; mesh: THREE.Mesh;
  epa: CatCar | null; hop: Hop | null; ride: CatCar | null;   // the EPA it trots to / its hop / the EPA it rides on
  pets: number; owned: boolean }                             // good pets in a row, towards adopting it; the player's own cat

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
  cars: readonly CatCar[];
  toast(msg: string, secs: number): void;
  readonly player: Point & { speed: number };
  readonly keys: Record<string, boolean | undefined>;
  readonly joy: { on: boolean };
  readonly kmenu: HTMLElement;
  readonly inCar: boolean;
  readonly pcar: CatCar | null;          // the player's car, if they drive one
  readonly inside: unknown;
  /** takes a treat from the player's pockets if there is one */
  useTreat(): boolean;
}

/** The cats around the player: spawns them by the house walls, moves them, and lets the player pet one. */
export class CatColony {
  /** the live cats, in spawn order */
  readonly cats: Cat[] = [];
  /** the player's own cat, if they adopted one */
  owned: Cat | null = null;
  /** the owned cat was sent home: it is out of the world until it is called */
  home = false;
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
      for (let i = cats.length - 1; i >= 0; i--) if (!cats[i].owned && Math.hypot(cats[i].x - T.x, cats[i].z - T.z) > CAT_FAR) { this.drop(cats[i]); cats.splice(i, 1); }
      for (let i = 0; i < (jump ? 30 : 2) && cats.length < this.max; i++) this.spawn(T, jump ? 4 : 80);
    }
    for (const k of cats) this.updateCat(k, dt);
  }

  /** E goes to the closer of a cat and a place, so a cat sitting by the kiosk or a safehouse door can still be petted. */
  catFirst(kt: Cat | null, pl: Point | null) { const { player } = this.g; return !!kt && (!pl || this.g.kmenu.hidden && Math.hypot(kt.x - player.x, kt.z - player.z) < Math.hypot(pl.x - player.x, pl.z - player.z)); }

  /** The cat within petting reach of the player, if one is calm enough. */
  nearest() { const g = this.g; if (g.inCar || g.inside) return null; const { player } = g; let best: Cat | null = null, bd = CAT_PET_M;
    for (const k of this.cats) { const d = Math.hypot(k.x - player.x, k.z - player.z); if (d < bd && k.state !== 'flee' && k.state !== 'hop' && !k.ride && k.nope <= 0) { bd = d; best = k; } } return best; }

  /** Pets a cat: it purrs, scratches or bolts; your own cat always purrs. A treat goes into the cat whatever happens next.
   *  True when that was the good pet that makes the cat ready to be adopted. */
  pet(k: Cat) {
    const { player, toast } = this.g, treat = this.g.useTreat(), r = this.rnd(), pre = treat ? '”Här, en godisbit.”\n' : '';
    k.want = Math.atan2(player.x - k.x, -(player.z - k.z));
    if (k.owned || r < (treat ? CAT_PET_TREAT_OK : CAT_PET_OK)) { k.state = 'sit'; k.t = 6 + this.rnd() * 6; k.nope = CAT_PET_S; toast(pre + this.pick(k.owned ? CAT_PET_OWN : CAT_PET).replace('{n}', () => k.name), 3);
      if (k.owned) return false; k.pets++; return !this.owned && k.pets >= CAT_ADOPT_PETS; }
    k.pets = 0;   // it has to be good in a row
    if (this.rnd() < 0.5) { k.state = 'sit'; k.t = 3 + this.rnd() * 4; k.nope = CAT_SCRATCH_S; toast(pre + this.pick(CAT_SCRATCH), 3.5); }
    else { k.state = 'flee'; k.t = 2 + this.rnd(); k.want = Math.atan2(k.x - player.x, -(k.z - player.z)); toast(pre + this.pick(CAT_BOLT), 3); }
    return false;
  }

  /** The cat becomes the player's own and follows them. Mid-hop onto an EPA, the hop then lands it back on the ground. */
  adopt(k: Cat) { k.owned = true; k.pets = 0; this.owned = k; k.epa = null; if (k.state !== 'hop') { k.state = 'sit'; k.t = 1; } this.g.toast('”Mjau!”\n”Då ä du min katt nu. Kom så går vi hem!”', 3.5); }

  /** Said no to adopting it: it takes as many good pets again before it asks next time. */
  decline(k: Cat) { k.pets = 0; }

  /** Gives your cat a name: trimmed, at most CAT_NAME_MAX characters (an emoji counts as one); a blank name changes nothing. Returns its name. */
  rename(name: string) { const k = this.owned, n = [...name.trim()].slice(0, CAT_NAME_MAX).join(''); if (k && n) k.name = n; return k ? k.name : ''; }

  // puts the cat on dry land about d metres from T, or right at T if every try lands in water
  private placeNear(k: Cat, T: Point, d: number) {
    for (let i = 0; i < 8; i++) { const a = this.rnd() * Math.PI * 2; k.x = T.x + Math.sin(a) * d; k.z = T.z + Math.cos(a) * d; this.collide(k, 0.25); if (!this.g.inWater(k.x, k.z)) return; }
    k.x = T.x; k.z = T.z;
  }

  /** Your cat goes home: out of the world, off any car, until it is called. */
  sendHome() { const k = this.owned; if (!k || this.home) return;
    this.drop(k); this.cats.splice(this.cats.indexOf(k), 1); this.home = true; this.g.toast('”Gå hem nu, ' + k.name + '. Vi ses sen!”', 2.5); }

  /** Your cat comes running from out of sight, to T (the player, or their car, which it then gets into). */
  call(T: Point) { const k = this.owned, g = this.g; if (!k || !this.home) return;
    this.placeNear(k, T, 20);
    k.state = 'sit'; k.t = 1; k.mesh.position.set(k.x, g.groundAt(k.x, k.z), k.z); g.scene.add(k.mesh); this.cats.push(k); this.home = false;
    g.toast('”Kiss kiss kiss! Kom hit, ' + k.name + '!”', 2.5); }

  /** Your cat isn't yours any more: it gets off any car and lives as a stray again (or stays wherever home was). */
  setFree() { const k = this.owned; if (!k) return;
    k.owned = false; k.pets = 0; this.owned = null;
    if (this.home) this.home = false;
    else if (k.ride) this.hopOff(k);
    else if (k.hop?.onto) { k.hop.onto.cat = null; k.hop.onto = null; k.hop.tx = k.x; k.hop.tz = k.z; }
    else if (k.state === 'follow') { k.state = 'sit'; k.t = 2; }
    this.g.toast('”Hej då, ' + k.name + '. Sköt om dä nu!”', 3); }

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
      const k: Cat = { name: CAT_NAME, x: o.x, z: o.z, h: Math.atan2(nx, -nz), want: 0, state: 'sit', t: 3 + rnd() * 15, nope: 0, phase: 0, mesh, epa: null, hop: null, ride: null, pets: 0, owned: false }; k.want = k.h;
      scene.add(mesh); this.cats.push(k); return;
    }
  }

  // a cat leaving the world: free its car, and take it out of the scene
  private drop(k: Cat) { if (k.ride) k.ride.cat = null; if (k.hop?.onto) k.hop.onto.cat = null; if (k.epa?.cat === k) k.epa.cat = null;
    k.ride = k.hop = k.epa = null; k.mesh.parent?.remove(k.mesh); k.mesh.visible = true; }

  // a still EPA with an empty flak, close enough to go for; trimmade EPAs (not in the game yet) won't take cats
  private freeEpa(k: Cat) { for (const c of this.g.cars) if (c.type === 'epa' && !c.cat && !c.trimmad && Math.abs(c.v) < 0.3 && Math.hypot(c.x - k.x, c.z - k.z) < CAT_EPA_M) return c; return null; }

  // where on this car the cat sits; on the roomy EPA flak, a little different each time
  private seat(c: CatCar): Seat {
    const s = CAT_SEATS[c.type] || CAT_SEATS.car, r = this.rnd;
    return c.type === 'epa' ? { ...s, x: (r() - 0.5) * 0.7, z: s.z + (r() - 0.5) * 0.7, ry: s.ry + (r() - 0.5) * 1.2 } : s;
  }

  private startHop(k: Cat, x0: number, y0: number, z0: number, onto: CatCar | null, tx = 0, tz = 0) {
    k.state = 'hop'; k.hop = { x0, y0, z0, onto, tx, tz, p: 0, seat: onto ? this.seat(onto) : CAT_SEATS.car }; if (onto) onto.cat = k;
  }

  // your cat gets into your car; a stray already on the flak makes room
  private board(k: Cat, c: CatCar) {
    const o = c.cat;
    if (o && o !== k) { if (o.ride) this.hopOff(o); else if (o.hop) { o.hop.onto = null; o.hop.tx = o.x; o.hop.tz = o.z; } c.cat = null; }
    k.epa = null; this.startHop(k, k.x, this.g.groundAt(k.x, k.z), k.z, c); k.mesh.rotation.x = 0;
  }

  private stepHop(k: Cat, dt: number) {
    const H = k.hop!, c = H.onto, S = H.seat, rnd = this.rnd; H.p = Math.min(1, H.p + dt / CAT_HOP_S);
    if (c) c.mesh.localToWorld(_cv.set(S.x, S.y, S.z)); else _cv.set(H.tx, this.g.groundAt(H.tx, H.tz), H.tz);   // follow the flak if the EPA rolls
    const p = H.p, x = H.x0 + (_cv.x - H.x0) * p, z = H.z0 + (_cv.z - H.z0) * p;
    k.mesh.position.set(x, H.y0 + (_cv.y - H.y0) * p + Math.sin(p * Math.PI) * 0.7, z); k.x = x; k.z = z;
    if (p < 1) return;
    k.hop = null;
    if (c) { c.mesh.add(k.mesh); k.mesh.position.set(S.x, S.y, S.z); k.mesh.rotation.set(S.rx, S.ry, 0); k.mesh.visible = !S.inside;
      k.ride = c; k.state = 'sit'; k.t = CAT_EPA_RIDE_S + rnd() * 20; if (k.owned) this.g.toast(S.hi.replace('{n}', () => k.name), 2.5); else if (c === this.g.pcar) this.g.toast('”Mjau.”\n”Jaha, ska du åka mä, du?”', 3); }
    else { k.state = 'walk'; k.t = 2 + rnd() * 3; k.want = rnd() * Math.PI * 2; }
  }

  private hopOff(k: Cat) {
    const c = k.ride!, g = this.g; k.mesh.getWorldPosition(_cv); c.mesh.remove(k.mesh); g.scene.add(k.mesh); k.mesh.visible = true; c.cat = null; k.ride = null;
    let side = this.rnd() < 0.5 ? 1 : -1; const sh = Math.sin(c.h), ch = Math.cos(c.h), tx = (s: number) => c.x + ch * s * 1.8 - sh * 1.4, tz = (s: number) => c.z + sh * s * 1.8 + ch * 1.4;
    if (g.inWater(tx(side), tz(side))) side = -side;   // the dry side, if there is one
    k.h = k.want = g.wrap(c.h + Math.PI * side / 2); k.mesh.rotation.set(0, -k.h, 0);
    this.startHop(k, _cv.x, _cv.y, _cv.z, null, tx(side), tz(side));
    if (!k.owned && c === g.pcar) g.toast('”Hej då, kisse!”', 2.5);
  }

  private updateCat(k: Cat, dt: number) {
    const g = this.g, { player, wrap, inWater, groundAt } = g, HALF = g.half, rnd = this.rnd;
    const car = k.owned && g.inCar ? g.pcar : null;   // the car your own cat goes with
    if (k.ride) { const c = k.ride; k.x = c.x; k.z = c.z; k.t -= dt;
      if (k.owned ? c !== car : Math.abs(c.v) < 0.3 && k.t <= 0 && rnd() < CAT_EPA_OFF * dt) this.hopOff(k);   // yours gets out when you do
      return; }
    if (k.state === 'hop') { if (k.owned && k.hop!.onto && k.hop!.onto !== car) { const H = k.hop!; H.onto!.cat = null; H.onto = null; H.tx = k.x; H.tz = k.z; }
      this.stepHop(k, dt); return; }
    let fx = 0, fz = 0;
    // a moving car close by scares it off; your cat isn't scared of your own car
    for (const c of g.cars) if (Math.abs(c.v) > 2 && !(k.owned && c === g.pcar)) { const dx = k.x - c.x, dz = k.z - c.z, d = Math.hypot(dx, dz); if (d < CAT_SCARE_CAR_M && d > 0.01) { fx += dx / d; fz += dz / d; } }
    if (!k.owned && !g.inCar && !g.inside && (g.joy.on ? player.speed > 7.5 : g.keys.run && player.speed > 6)) {   // the stick passes 6 m/s on a normal push, so only a full push counts
      const dx = k.x - player.x, dz = k.z - player.z, d = Math.hypot(dx, dz); if (d < CAT_SCARE_RUN_M && d > 0.01) { fx += dx / d; fz += dz / d; } }
    if (fx || fz) { k.state = 'flee'; k.t = 1.5 + rnd(); k.want = Math.atan2(fx, -fz); k.epa = null; }
    k.t -= dt; if (k.nope > 0) k.nope -= dt;
    let follow = 0;   // how fast the owned cat walks after the player this frame (m/s)
    if (k.owned && k.state !== 'flee' && !g.inCar && !g.inside) {
      let dx = player.x - k.x, dz = player.z - k.z, d = Math.hypot(dx, dz);
      if (d > CAT_FIND_M || inWater(k.x, k.z)) { this.placeNear(k, player, 6); dx = player.x - k.x; dz = player.z - k.z; d = Math.hypot(dx, dz); }   // too far, or stuck in the lake: it catches up out of sight
      if (d > CAT_FOLLOW_M) { k.state = 'follow'; k.t = 1; k.want = Math.atan2(dx, -dz); follow = clamp((d - CAT_FOLLOW_M) * 2, CAT_TROT, CAT_RUN); }
      else if (k.state === 'follow') { k.state = 'sit'; k.t = 4 + rnd() * 8; }
    } else if (car && k.state !== 'flee') {   // run to your car and hop in; left behind, it waits, and catches up when you walk again
      const dx = car.x - k.x, dz = car.z - k.z, d = Math.hypot(dx, dz);
      if (d < CAT_BOARD_M) { this.board(k, car); this.stepHop(k, dt); return; }
      if (d < CAT_FIND_M) { k.state = 'follow'; k.t = 1; k.want = Math.atan2(dx, -dz); follow = CAT_RUN; }
      else if (k.state === 'follow') { k.state = 'sit'; k.t = 4 + rnd() * 8; }
    } else if (k.state === 'follow') { k.state = 'sit'; k.t = 4 + rnd() * 8; }
    if (!k.owned && k.state === 'sit' && rnd() < CAT_EPA_ON * dt) { const c = this.freeEpa(k); if (c) { k.state = 'epa'; k.epa = c; k.t = 15; } }
    if (k.state === 'epa' && k.epa) { const c = k.epa, bx = c.x - Math.sin(c.h) * 3, bz = c.z + Math.cos(c.h) * 3;   // trot to just behind the tailgate
      if (Math.abs(c.v) > 0.3 || c.cat) { k.state = 'sit'; k.t = 3 + rnd() * 6; k.epa = null; }
      else if (Math.hypot(bx - k.x, bz - k.z) < 0.5) { k.epa = null; this.startHop(k, k.x, groundAt(k.x, k.z), k.z, c); k.mesh.rotation.x = 0; this.stepHop(k, dt); return; }
      else k.want = Math.atan2(bx - k.x, -(bz - k.z)); }
    if (k.t <= 0) { k.epa = null; if (k.state === 'sit' && !k.owned) {   // your own cat sits and waits rather than wander off
      k.state = 'walk'; k.t = 2 + rnd() * 4; k.want = rnd() * Math.PI * 2; } else { k.state = 'sit'; k.t = 4 + rnd() * 16; } }
    const sp = k.state === 'flee' ? CAT_RUN : k.state === 'walk' ? CAT_WALK : k.state === 'epa' ? CAT_TROT : k.state === 'follow' ? follow : 0;
    k.h = wrap(k.h + wrap(k.want - k.h) * Math.min(1, dt * (sp > 1 ? 10 : 3)));
    if (sp) { const nx = k.x + Math.sin(k.h) * sp * dt, nz = k.z - Math.cos(k.h) * sp * dt;
      if (inWater(nx, nz)) k.want = wrap(k.h + Math.PI); else { k.x = clamp(nx, -HALF + 2, HALF - 2); k.z = clamp(nz, -HALF + 2, HALF - 2); }
      if (this.collide(k, 0.25) && k.state === 'walk') k.want = wrap(k.h + (rnd() < 0.5 ? 1.6 : -1.6));
      k.phase += sp * dt * 9; }
    k.mesh.position.set(k.x, groundAt(k.x, k.z) + (sp ? Math.abs(Math.sin(k.phase)) * 0.03 : 0), k.z); k.mesh.rotation.y = -k.h;
    k.mesh.rotation.x += ((k.state === 'sit' ? 0.3 : 0) - k.mesh.rotation.x) * Math.min(1, dt * 4);   // sitting: front up, rear down
  }
}
