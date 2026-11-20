// Pedestrians: walk the streets and footpaths, now and then stop for a while.
// Moved from src/game/main.ts (#177); main.ts passes in what the pedestrians read from the rest of the game.
import type * as THREE from 'three';
import type { BuildingIndex } from '../world/buildings';
import { type Label, ROAD_WIDTH_M as ROAD_W } from '../world/data';
import { nodeKey, ROAD_CELL_M as RC, type RoadLine, type RoadNetwork } from '../world/roads';

// Each 50 m cell gets a density (0..1): how built-up the cell and its neighbours are, plus a boost near named places.
// NPC_ZONES hand-tunes spots on top of that (m multiplies the density within r metres).
const NPC_ZONES = [{ x: -8.9, z: 30.1, r: 80, m: 1.8 }]; // Torget
const NPC_MAX = 42,
  NPC_MAX_COARSE = 26; // count around the player in the busiest places; on a touch screen
const NPC_NEAR = 200,
  NPC_FAR = 250; // spawn / despawn radius around the player (m)
const SHIRTS = ['#b5463a', '#3f6b8a', '#5c7a4a', '#7a5a8a', '#d8d4c8', '#2b3a55', '#c9862f', '#8c1c1c', '#4d4a48'],
  PANTS = ['#3a3a3a', '#2b3a55', '#4a4038', '#5a6470', '#23272b'],
  HAIR = ['#5a4632', '#2a2320', '#c9a560', '#8a8580', '#7a3f22'];

// Drive into someone and they come after you: run you down on foot and shove you.
const MAD_HIT_MS = 4; // the player's car hitting a pedestrian faster than this (m/s, ~15 km/h) makes them angry
export const MAD_S = 20; // how long they stay angry after the last hit (s)
const MAD_RUN_MS = 5.5; // their chase speed (m/s): faster than your walk (4.6), slower than your sprint (8)
export const MAD_GIVE_UP_M = 60; // they give up when you get this far away
const SHOVE_REACH_M = 1.1,
  SHOVE_PUSH_M = 1.6,
  SHOVE_COOL_S = 1.5; // on foot within reach: pushes you this far, then waits this long before the next shove
export const SHOVE_HP = 5; // health a shove takes
const BACK_MS = 2.5,
  BACK_S = 10; // calmed down: walk back to their path at this speed (m/s), for at most this long before sliding back as before
const MAD_LINES = [
    '”Aj! Va fan gör du?!”',
    '”Hörru! Kör du på folk, din dåre?!”',
    '”Kom hit, så ska du få se!”',
    '”Ja ska ta dej, din fähund!”',
  ],
  SHOVE_LINES = ['”Ta dä, din bilbuse!”', '”Där fick du!”', '”Lär dej köra, för fan!”'];

type Point = { x: number; z: number };
/** A person's mesh, as personParts in main.ts builds it. */
export type PersonMesh = THREE.Object3D & { legs: THREE.Object3D[] };
/** Where a pedestrian is on the walk graph: road ri, from vertex a towards a + dir, t metres along; the same shape as a car's. */
export interface Npc extends Point {
  ri: number;
  a: number;
  dir: number;
  t: number;
  side: number;
  speed: number;
  idle: number;
  walk: number;
  h: number;
  phase: number;
  first: boolean;
  mad: number; // s left chasing the player
  cool: number; // s until they can shove again
  back: number; // s left walking back to their path after a chase
  mesh: PersonMesh;
}

/** What the pedestrians read from the rest of the game. The getters are read when used, so main.ts can declare those later. */
export interface CrowdDeps {
  scene: THREE.Scene;
  roads: Pick<RoadNetwork, 'lines' | 'grid'>;
  buildings: Pick<BuildingIndex, 'footprints' | 'collide'>;
  labels: readonly Label[];
  groundAt(x: number, z: number): number;
  coarse: boolean; // touch screen: fewer pedestrians
  wrap(a: number): number;
  rnd(): number; // the game's seeded stream, so the rolls stay in the order they were
  pick<T>(a: readonly T[]): T;
  personParts(shirt: string, pants: string, hair: string): PersonMesh;
  /** moves a walker on to the next segment at a junction of `graph` */
  advance(n: Npc, graph: Map<string, number[]>): void;
  cars: readonly Point[];
  readonly player: Point; // an angry pedestrian shoves it
  readonly inCar: boolean;
  readonly pcar: (Point & { v: number }) | null; // the car the player drives
  toast(msg: string): void;
  hurtPlayer(hp: number): void;
}

/** The pedestrians around the player: a crowd as busy as the area, walking the streets and paths. */
export class Crowd {
  /** the live pedestrians, in spawn order */
  readonly npcs: Npc[] = [];
  private readonly g: CrowdDeps;
  private readonly max: number; // count around the player in the busiest places
  private readonly dens = new Map<string, number>(); // 50 m cell -> density (0..1)
  // every road and path is walkable: junction graph plus a grid of segments to spawn on
  private readonly wnodes = new Map<string, number[]>();
  private readonly walkGrid = new Map<string, number[]>();
  private readonly R: RoadLine[];
  private readonly collide: BuildingIndex['collide'];
  private npcT = 0; // s until the next spawn check
  private npcX = 1e9; // where the player was at the last spawn check (m)
  private npcZ = 1e9;

  constructor(g: CrowdDeps) {
    this.g = g;
    this.max = g.coarse ? NPC_MAX_COARSE : NPC_MAX;
    this.R = g.roads.lines;
    this.collide = g.buildings.collide.bind(g.buildings);
    const { dens, wnodes, walkGrid } = this,
      cnt = new Map<string, number>();
    for (const b of g.buildings.footprints) {
      const k = Math.floor((b.x0 + b.x1) / 2 / RC) + ',' + Math.floor((b.z0 + b.z1) / 2 / RC);
      cnt.set(k, (cnt.get(k) || 0) + 1);
    }
    for (const k of g.roads.grid.keys()) {
      const [x, z] = k.split(',').map(Number),
        cx = (x + 0.5) * RC,
        cz = (z + 0.5) * RC;
      let n = 0;
      for (let i = -1; i <= 1; i++) for (let j = -1; j <= 1; j++) n += cnt.get(x + i + ',' + (z + j)) || 0;
      let d = 0.04 + Math.min(1, n / 16) * 0.66;
      for (const l of g.labels) if (l.k === 'p') d += 0.45 * Math.max(0, 1 - Math.hypot(l.x - cx, l.z - cz) / 110);
      for (const o of NPC_ZONES) if (Math.hypot(o.x - cx, o.z - cz) < o.r) d *= o.m;
      dens.set(k, Math.min(1, d));
    }
    this.R.forEach((r, ri) => {
      r.p.forEach((p, vi) => {
        const k = nodeKey(p);
        let l = wnodes.get(k);
        if (!l) {
          l = [];
          wnodes.set(k, l);
        }
        l.push(ri, vi);
        if (!vi) return;
        const q = r.p[vi - 1],
          c = Math.floor((p[0] + q[0]) / 2 / RC) + ',' + Math.floor((p[1] + q[1]) / 2 / RC);
        let s = walkGrid.get(c);
        if (!s) {
          s = [];
          walkGrid.set(c, s);
        }
        s.push(ri, vi - 1);
      });
    });
  }

  private densAt(x: number, z: number) {
    return this.dens.get(Math.floor(x / RC) + ',' + Math.floor(z / RC)) || 0;
  }

  private segLen(r: RoadLine, a: number, b: number) {
    return Math.max(0.01, Math.hypot(r.p[b][0] - r.p[a][0], r.p[b][1] - r.p[a][1]));
  }

  private spawn(T: Point, minD: number) {
    const { rnd, pick, personParts, scene } = this.g,
      { R } = this;
    for (let t = 0; t < 12; t++) {
      const ang = rnd() * Math.PI * 2,
        dist = minD + rnd() * (NPC_NEAR - minD),
        x = T.x + Math.sin(ang) * dist,
        z = T.z + Math.cos(ang) * dist;
      const l = this.walkGrid.get(Math.floor(x / RC) + ',' + Math.floor(z / RC));
      if (!l || rnd() > this.densAt(x, z)) continue;
      const i = Math.floor((rnd() * l.length) / 2) * 2,
        ri = l[i],
        fwd = rnd() < 0.5,
        a = fwd ? l[i + 1] : l[i + 1] + 1;
      const n: Npc = {
        ri,
        a,
        dir: fwd ? 1 : -1,
        t: rnd() * this.segLen(R[ri], l[i + 1], l[i + 1] + 1),
        side: rnd() < 0.5 ? 1 : -1,
        speed: 1.05 + rnd() * 0.45,
        idle: rnd() < 0.3 ? 2 + rnd() * 10 : 0,
        walk: 10 + rnd() * 30,
        x: 0,
        z: 0,
        h: 0,
        phase: 0,
        first: true,
        mad: 0,
        cool: 0,
        back: 0,
        mesh: personParts(pick(SHIRTS), pick(PANTS), pick(HAIR)),
      };
      n.mesh.scale.setScalar(0.92 + rnd() * 0.14);
      scene.add(n.mesh);
      this.npcs.push(n);
      return;
    }
  }

  private updateNpc(n: Npc, dt: number) {
    const { rnd, pick, advance, cars, player, inCar, pcar, groundAt, wrap, toast, hurtPlayer } = this.g,
      { R } = this;
    const d0 = this.densAt(n.x, n.z),
      mad = n.mad > 0;
    if (mad) {
      // chasing: their place on the path waits for them
      n.mad -= dt;
      n.cool -= dt;
      n.phase += MAD_RUN_MS * dt * 2.1;
    } else if (n.idle > 0) {
      n.idle -= dt;
      n.phase *= 0.8;
    } else {
      n.t += n.speed * dt;
      n.phase += n.speed * dt * 2.1;
      n.walk -= dt;
      if (n.walk <= 0) {
        n.idle = 3 + rnd() * 12;
        n.walk = 12 + rnd() * 40 * (1.2 - d0);
      }
    } // busy places: shorter walks between stops
    let r = R[n.ri],
      L = this.segLen(r, n.a, n.a + n.dir);
    for (let g = 0; n.t >= L && g < 8; g++) {
      n.t -= L;
      advance(n, this.wnodes);
      r = R[n.ri];
      L = this.segLen(r, n.a, n.a + n.dir);
    }
    const A = r.p[n.a],
      B = r.p[n.a + n.dir],
      dx = (B[0] - A[0]) / L,
      dz = (B[1] - A[1]) / L,
      off = r.c <= 3 ? (ROAD_W[r.c] / 2 + 0.8) * n.side : 0;
    const px = A[0] + dx * n.t - dz * off,
      pz = A[1] + dz * n.t + dx * off; // their spot on the path
    if (mad) {
      const ex = player.x - n.x,
        ez = player.z - n.z,
        d = Math.hypot(ex, ez);
      if (d > MAD_GIVE_UP_M) n.mad = 0;
      else if (d > SHOVE_REACH_M) {
        const s = Math.min(d - SHOVE_REACH_M, MAD_RUN_MS * dt) / d;
        n.x += ex * s;
        n.z += ez * s;
      } else if (!inCar && n.cool <= 0 && d > 0.01) {
        n.cool = SHOVE_COOL_S;
        player.x += (ex / d) * SHOVE_PUSH_M;
        player.z += (ez / d) * SHOVE_PUSH_M;
        hurtPlayer(SHOVE_HP);
        toast(pick(SHOVE_LINES));
      }
      if (n.mad <= 0) n.back = BACK_S;
    } else if (n.back > 0) {
      n.back -= dt;
      const ex = px - n.x,
        ez = pz - n.z,
        d = Math.hypot(ex, ez),
        s = Math.min(d, BACK_MS * dt);
      if (d < 0.3) n.back = 0;
      else {
        n.x += (ex / d) * s;
        n.z += (ez / d) * s;
        n.phase += BACK_MS * dt * 2.1;
      }
    } else {
      const k = n.first ? 1 : Math.min(1, dt * 4);
      n.x += (px - n.x) * k;
      n.z += (pz - n.z) * k;
    }
    for (const c of cars) {
      const ex = n.x - c.x,
        ez = n.z - c.z,
        d = Math.hypot(ex, ez);
      if (d < 2.3 && d > 0.01) {
        n.x += (ex / d) * (2.3 - d);
        n.z += (ez / d) * (2.3 - d);
        if (c === pcar && Math.abs(pcar.v) > MAD_HIT_MS) {
          if (n.mad <= 0) toast(pick(MAD_LINES));
          n.mad = MAD_S;
          n.back = 0;
        }
      }
    }
    if (!inCar) {
      const ex = n.x - player.x,
        ez = n.z - player.z,
        d = Math.hypot(ex, ez);
      if (d < 0.75 && d > 0.01) {
        n.x += (ex / d) * (0.75 - d);
        n.z += (ez / d) * (0.75 - d);
      }
    }
    this.collide(n, 0.35);
    // walking: face the way along the path; standing around: glance at the player when they come close; angry: glare at the player; going back: face the path
    const ph = Math.hypot(player.x - n.x, player.z - n.z),
      atPlayer = Math.atan2(player.x - n.x, -(player.z - n.z)),
      want =
        n.mad > 0
          ? atPlayer
          : n.back > 0
            ? Math.atan2(px - n.x, -(pz - n.z))
            : n.idle > 0
              ? ph < 8
                ? atPlayer
                : n.h
              : Math.atan2(dx, -dz);
    n.h = n.first ? want : wrap(n.h + wrap(want - n.h) * Math.min(1, dt * 5));
    n.first = false;
    const sw = Math.sin(n.phase) * 0.6;
    n.mesh.legs[0].rotation.x = sw;
    n.mesh.legs[1].rotation.x = -sw;
    n.mesh.position.set(n.x, groundAt(n.x, n.z), n.z);
    n.mesh.rotation.y = -n.h;
  }

  /** Keeps a crowd around the player that matches how busy the area is, refilling everything after a teleport, and moves everyone; T is where the player (or their car) is. */
  update(T: Point, dt: number) {
    const { npcs } = this,
      { scene } = this.g;
    this.npcT -= dt;
    if (this.npcT <= 0) {
      this.npcT = 0.4;
      const jump = Math.hypot(T.x - this.npcX, T.z - this.npcZ) > 120;
      this.npcX = T.x;
      this.npcZ = T.z;
      for (let i = npcs.length - 1; i >= 0; i--)
        if (Math.hypot(npcs[i].x - T.x, npcs[i].z - T.z) > NPC_FAR) {
          scene.remove(npcs[i].mesh);
          npcs.splice(i, 1);
        }
      let s = 0;
      for (let i = -4; i <= 4; i++) for (let j = -4; j <= 4; j++) s += this.densAt(T.x + i * RC, T.z + j * RC);
      const want = Math.round(this.max * Math.min(1, (s / 81) * 2.2));
      for (let i = 0; i < (jump ? 60 : 3) && npcs.length < want; i++) this.spawn(T, jump ? 0 : 90);
    }
    for (const n of npcs) this.updateNpc(n, dt);
  }
}
