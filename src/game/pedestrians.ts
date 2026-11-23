// Pedestrians: walk the streets and footpaths, now and then stop for a while.
// Moved from src/game/main.ts (#177); main.ts passes in what the pedestrians read from the rest of the game.
import type * as THREE from 'three';
import type { BuildingIndex } from '../world/buildings';
import type { Label } from '../world/data';
import { wrap } from '../world/math';
import { nodeKey, ROAD_CELL_M as RC, type RoadLine, type RoadNetwork } from '../world/roads';
import { bodyRadius, type CarBody, nearestOnSpine, PERSON_RADIUS_M } from './sim/car-body';

// Each 50 m cell gets a density (0..1): how built-up the cell and its neighbours are, plus a boost near named places.
// NPC_ZONES hand-tunes spots on top of that (m multiplies the density within r metres).
const _onCar = { x: 0, z: 0 }; // nearestOnSpine writes here: no allocation per walker per car
const NPC_ZONES = [{ x: -8.9, z: 30.1, r: 80, m: 1.8 }]; // Torget
const NPC_MAX = 42,
  NPC_MAX_COARSE = 26; // count around the player in the busiest places; on a touch screen
const NPC_NEAR = 200,
  NPC_FAR = 250; // spawn / despawn radius around the player (m)
const LOST_RUN = 2; // back on their feet off their path, they run back to it at this many times their walking speed
export const LOST_MAX_S = 8; // and if they're not there after this long (s), a house is in the way: they're put on it
const SHIRTS = ['#b5463a', '#3f6b8a', '#5c7a4a', '#7a5a8a', '#d8d4c8', '#2b3a55', '#c9862f', '#8c1c1c', '#4d4a48'],
  PANTS = ['#3a3a3a', '#2b3a55', '#4a4038', '#5a6470', '#23272b'],
  HAIR = ['#5a4632', '#2a2320', '#c9a560', '#8a8580', '#7a3f22'];

type Point = { x: number; z: number };
/** A person's mesh, as personParts in src/game/render/models.ts builds it. */
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
  gawk: number; // s left staring at the player
  look: Look;
  scale: number; // their size: 1 is the standard person
  mesh: PersonMesh;
  down?: boolean; // knocked over: the ragdolls (src/game/ragdolls.ts) move them until they clear this
  lost?: number; // back on their feet off their path: they run back to it rather than snap, for at most this many more seconds
}
/** What a pedestrian wears, as personParts in src/game/render/models.ts takes it. */
export interface Look {
  shirt: string;
  pants: string;
  hair: string;
}

/** What the pedestrians read from the rest of the game. The getters are read when used, so main.ts can declare those later. */
export interface CrowdDeps {
  scene: THREE.Scene;
  roads: Pick<RoadNetwork, 'lines' | 'grid'>;
  buildings: Pick<BuildingIndex, 'footprints' | 'collide'>;
  labels: readonly Label[];
  groundAt(x: number, z: number): number;
  /** how far from road ri's centre line people walk on `side` (-1 left, +1 right of the road's own direction) (m) */
  walkOffset(ri: number, side: -1 | 1): number;
  coarse: boolean; // touch screen: fewer pedestrians
  rnd(): number; // the game's seeded stream, so the rolls stay in the order they were
  pick<T>(a: readonly T[]): T;
  personParts(shirt: string, pants: string, hair: string): PersonMesh;
  /** moves a walker on to the next segment at a junction of `graph` */
  advance(n: Npc, graph: Map<string, number[]>): void;
  cars: readonly CarBody[];
  /** a car drives into n: true takes n out of the crowd's hands (n.down) instead of pushing them aside. Unset, everyone is pushed. */
  readonly hit?: ((n: Npc, car: Point) => boolean) | null;
  readonly player: Point;
  readonly inCar: boolean;
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
    const { rnd, pick, scene } = this.g,
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
        gawk: 0,
        scale: 1,
        ...this.dress(pick(SHIRTS), pick(PANTS), pick(HAIR)),
      };
      n.scale = 0.92 + rnd() * 0.14;
      n.mesh.scale.setScalar(n.scale);
      scene.add(n.mesh);
      this.npcs.push(n);
      return;
    }
  }

  private dress(shirt: string, pants: string, hair: string) {
    return { look: { shirt, pants, hair }, mesh: this.g.personParts(shirt, pants, hair) };
  }

  private updateNpc(n: Npc, dt: number) {
    if (n.down) return;
    const { rnd, advance, cars, hit, player, inCar, groundAt, walkOffset } = this.g,
      { R } = this;
    const d0 = this.densAt(n.x, n.z);
    if (n.gawk > 0) n.gawk -= dt;
    if (n.idle > 0) {
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
      off = r.c <= 3 ? walkOffset(n.ri, (n.side * n.dir) as -1 | 1) * n.side : 0; // side of travel times direction: the road's own side
    const k = n.first ? 1 : Math.min(1, dt * 4),
      px = A[0] + dx * n.t - dz * off,
      pz = A[1] + dz * n.t + dx * off;
    let rx = 0,
      rz = 0;
    if (n.lost) {
      const ex = px - n.x,
        ez = pz - n.z,
        d = Math.hypot(ex, ez),
        s = n.speed * LOST_RUN * dt;
      n.lost -= dt;
      if (d <= s || n.lost <= 0) {
        n.lost = 0;
        n.x = px;
        n.z = pz;
      } else {
        rx = ex / d;
        rz = ez / d;
        n.x += rx * s;
        n.z += rz * s;
        n.phase += s * 2.1;
      }
    } else {
      n.x += (px - n.x) * k;
      n.z += (pz - n.z) * k;
    }
    for (const c of cars) {
      if (Math.abs(n.x - c.x) > c.T.lengthM || Math.abs(n.z - c.z) > c.T.lengthM) continue;
      nearestOnSpine(c, n.x, n.z, _onCar);
      const ex = n.x - _onCar.x,
        ez = n.z - _onCar.z,
        d = Math.hypot(ex, ez),
        apart = bodyRadius(c) + PERSON_RADIUS_M;
      if (d < apart && d > 0.01) {
        if (hit?.(n, c)) {
          n.down = true;
          return;
        }
        n.x += (ex / d) * (apart - d);
        n.z += (ez / d) * (apart - d);
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
    // walking: face the way along the path; standing around: glance at the player when they come close, or stare while gawking
    const ph = Math.hypot(player.x - n.x, player.z - n.z),
      want =
        rx || rz
          ? Math.atan2(rx, -rz)
          : n.idle > 0
            ? ph < 8 || n.gawk > 0
              ? Math.atan2(player.x - n.x, -(player.z - n.z))
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

  /** Everyone within r metres of o stops and stares at the player for s seconds; anyone knocked over is busy getting up. True when anyone saw. */
  stare(o: Point, r: number, s: number) {
    let seen = false;
    for (const n of this.npcs)
      if (!n.down && Math.hypot(n.x - o.x, n.z - o.z) < r) {
        n.gawk = s;
        n.idle = Math.max(n.idle, s);
        seen = true;
      }
    return seen;
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
