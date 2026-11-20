// The world's meshes in the game's scene: the terrain, the road ribbons, the painted houses with their windows and trim,
// the streetscape's pavements and parking, and the trees. The world's data and queries come from src/world/.
// Moved from src/game/main.ts (#177); main.ts calls these in the same order as before, since the house colours roll rnd().
import * as THREE from 'three';
import type { BuildingShape } from '../../world/buildings';
import type { WorldData } from '../../world/data';
import type { Heightfield } from '../../world/heightfield';
import { PaintedBuildingShells } from '../../world/mesh/building-shells';
import { ParkingMesh } from '../../world/mesh/parking-mesh';
import { RoadRibbons } from '../../world/mesh/road-ribbons';
import { SidewalkMesh } from '../../world/mesh/sidewalk-mesh';
import { TerrainMesh } from '../../world/mesh/terrain';
import { pointInPolygon as inPoly } from '../../world/polygon';
import type { RoadNetwork } from '../../world/roads';
import type { StreetscapeLayout } from '../../world/streetscape';
import { HOUSE_MAX_M2, HOUSE_MIN_M2 } from './ground-texture';
import { mergeGeo } from './models';
import { col } from './stage';

// ---------- terrain ----------
const SKIRT_DEPTH_M = 1.5; // the skirt round the edge, and the far ground plane, sit this far below height 0
/** The terrain wearing the ground texture, its skirt, and a far ground plane out to the fog. */
export function addTerrain(scene: THREE.Scene, heightfield: Heightfield, texture: THREE.Texture) {
  const terrain = new TerrainMesh(heightfield, {
    skirtDepthM: SKIRT_DEPTH_M,
    material: new THREE.MeshLambertMaterial({ map: texture }),
    skirtMaterial: new THREE.MeshLambertMaterial({ color: col(0x6f8a58), side: THREE.DoubleSide }),
  });
  const far = new THREE.Mesh(
    new THREE.PlaneGeometry(14000, 14000),
    new THREE.MeshLambertMaterial({ color: col(0x6f9a5e) }),
  );
  far.rotation.x = -Math.PI / 2;
  far.position.y = -SKIRT_DEPTH_M;
  scene.add(terrain.surface, far, terrain.skirt);
}

// ---------- roads: crisp ribbons on the terrain ----------
const ROAD_COLOURS = [0x4c4f52, 0x55585b, 0x606365, 0x74746d, 0xa08c6c, 0xbcae92] as const,
  CENTRE_LINE_COLOUR = 0xe9e7da; // sRGB, by road class
/** The road ribbons, on a speckled asphalt tile; the streetscape's curbs reuse their materials. */
export function addRoadRibbons(
  scene: THREE.Scene,
  roads: RoadNetwork,
  heightfield: Heightfield,
  maxAnisotropy: number,
) {
  const asphalt = (() => {
    // a light, speckled tile that the road colours tint, so asphalt and gravel aren't flat
    const cv = document.createElement('canvas');
    cv.width = cv.height = 256;
    const x = cv.getContext('2d') as CanvasRenderingContext2D;
    let seed = 11;
    // its own generator, so the look doesn't shift the seeded rnd() sequence
    const next = () => {
      seed = (seed * 48271) % 2147483647;
      return seed / 2147483647;
    };
    x.fillStyle = '#f7f7f7';
    x.fillRect(0, 0, 256, 256);
    x.globalAlpha = 0.7;
    for (const c of ['#ffffff', '#cdcdcd', '#dedede']) {
      x.fillStyle = c;
      for (let i = 0; i < 1600; i++) x.fillRect(next() * 256, next() * 256, 1, 1);
    }
    const t = new THREE.CanvasTexture(cv);
    t.wrapS = t.wrapT = THREE.RepeatWrapping;
    t.colorSpace = THREE.SRGBColorSpace;
    t.anisotropy = maxAnisotropy;
    return t;
  })();
  const roadRibbons = new RoadRibbons(roads, heightfield, {
    asphalt,
    roadColours: ROAD_COLOURS,
    centreLineColour: CENTRE_LINE_COLOUR,
  });
  scene.add(...roadRibbons.meshes);
  return roadRibbons;
}

// ---------- buildings (painted in Swedish house colours) ----------
// house details: windows (a texture on a skin just outside the walls), white corner boards and eave boards, a dark plinth, and a chimney on gabled roofs
const WIN_W = 2.6,
  STOREY = 2.8; // window spacing and storey height (m)
/** The game's seeded rnd(), which rolls the house colours so they come out the same every time, and the renderer's anisotropy for the window texture. */
export interface BuildingMeshOptions {
  rnd(): number;
  pick<T>(a: readonly T[]): T;
  maxAnisotropy: number;
}
/** The house shells in their colours, and one mesh of windows and trim. Rolls rnd() once or twice per house, in data order. */
export function addBuildings(
  scene: THREE.Scene,
  D: WorldData,
  heightfield: Heightfield,
  { rnd, pick, maxAnisotropy }: BuildingMeshOptions,
) {
  const hAt = (x: number, z: number) => heightfield.heightAt(x, z);
  const winTex = (() => {
    const cv = document.createElement('canvas');
    cv.width = cv.height = 128;
    const x = cv.getContext('2d')!,
      u = (v: number) => (v / WIN_W) * 128,
      y = (v: number) => 128 - (v / STOREY) * 128;
    x.fillStyle = '#f1efe8';
    x.fillRect(u(0.8), y(2.15), u(1), y(0.9) - y(2.15)); // frame: 1.0 x 1.25 m, sill 0.9 m up
    x.fillStyle = '#26323a';
    x.fillRect(u(0.88), y(2.07), u(0.84), y(0.98) - y(2.07));
    x.fillStyle = '#f1efe8';
    x.fillRect(u(1.265), y(2.07), u(0.07), y(0.98) - y(2.07));
    x.fillRect(u(0.88), y(1.75), u(0.84), y(1.68) - y(1.75)); // cross bars
    const t = new THREE.CanvasTexture(cv);
    t.wrapS = t.wrapT = THREE.RepeatWrapping;
    t.colorSpace = THREE.SRGBColorSpace;
    t.anisotropy = maxAnisotropy;
    t.generateMipmaps = false;
    t.minFilter = THREE.LinearFilter;
    return t; // mips average the mostly transparent tile below alphaTest, so windows would vanish at a distance
  })();
  (() => {
    const c = new THREE.Color(),
      c2 = new THREE.Color(),
      c3 = new THREE.Color(),
      paint = { wall: c, wallFoot: c3, roof: c2 };
    const wp: number[] = [],
      wu: number[] = [],
      tp: number[] = [],
      tc: number[] = [],
      WHITE = col('#f1efe8'),
      PLINTH = col('#5b5d5b');
    const house = ['#9c3a2c', '#9c3a2c', '#a8452f', '#e8e2d2', '#e8e2d2', '#d9b65a', '#cfc8b8', '#8d9a8f'],
      big = ['#c9c5bb', '#b8b3a6', '#d6d0c0', '#a7aeb0'];
    type Quad = [x1: number, z1: number, x2: number, z2: number, b1: number, t1: number, b2: number, t2: number];
    // a vertical quad from (x1, z1) to (x2, z2), bottom and top heights at each end
    const quad = (out: number[], ...[x1, z1, x2, z2, b1, t1, b2, t2]: Quad) =>
      out.push(x1, b1, z1, x2, b2, z2, x2, t2, z2, x1, b1, z1, x2, t2, z2, x1, t1, z1);
    const trim = (k: THREE.Color, ...q: Quad) => {
      quad(tp, ...q);
      for (let i = 0; i < 6; i++) tc.push(k.r, k.g, k.b);
    };
    const box = (
      emit: (x: number, y: number, z: number, k: THREE.Color) => void,
      x: number,
      z: number,
      y0: number,
      y1: number,
      s: number,
      k: THREE.Color,
    ) => {
      const h = s / 2,
        P = [
          [x - h, z - h],
          [x + h, z - h],
          [x + h, z + h],
          [x - h, z + h],
        ],
        pos: number[] = [];
      for (let i = 0; i < 4; i++) {
        const a = P[i],
          d = P[(i + 1) % 4];
        quad(pos, a[0], a[1], d[0], d[1], y0, y1, y0, y1);
      }
      pos.push(
        x - h,
        y1,
        z - h,
        x + h,
        y1,
        z + h,
        x + h,
        y1,
        z - h,
        x - h,
        y1,
        z - h,
        x - h,
        y1,
        z + h,
        x + h,
        y1,
        z + h,
      );
      for (let i = 0; i < pos.length; i += 3) emit(pos[i], pos[i + 1], pos[i + 2], k);
    };
    // the colours roll rnd() once or twice per house, in data order, before any tree spot
    const colours = ({ building: b, area }: BuildingShape) => {
      c.set(b.k === 2 ? '#9c3a2c' : b.k ? '#efece3' : area > 450 ? pick(big) : pick(house)).convertSRGBToLinear();
      c2.set(b.k === 2 ? '#a8573f' : b.k ? '#3f4447' : rnd() < 0.35 ? '#4d4a48' : '#a8573f').convertSRGBToLinear();
      c3.copy(c).multiplyScalar(0.62); // walls darken towards the ground
      return paint;
    };
    const details = (
      { building: b, ring, yAt, base, top, hi, area, winding: wind }: BuildingShape,
      emit: (x: number, y: number, z: number, k: THREE.Color) => void,
    ) => {
      if (b.k === 1 || area < HOUSE_MIN_M2 || area > HOUSE_MAX_M2) return; // not the church and its tower, not sheds or barns
      const m = ring.length,
        yb = hi + 0.2,
        yt = top - 0.25,
        rows = Math.max(1, Math.round((yt - yb) / STOREY));
      for (let i = 0; i < m; i++) {
        const a = ring[i],
          d = ring[(i + 1) % m],
          ex = d.x - a.x,
          ez = d.z - a.z,
          len = Math.hypot(ex, ez);
        if (len < 0.4) continue;
        const ux = ex / len,
          uz = ez / len,
          ox = wind * uz,
          oz = -wind * ux,
          o = (k: number, s: number): [number, number, number, number] => [
            a.x + ox * k - ux * s,
            a.z + oz * k - uz * s,
            d.x + ox * k + ux * s,
            d.z + oz * k + uz * s,
          ];
        const nwin = Math.round(len / WIN_W); // whole windows only: the tile stretches a little to fit the wall
        if (len >= 1.6 && nwin > 0) {
          quad(wp, ...o(0.04, 0), yb, yt, yb, yt);
          wu.push(0, 0, nwin, 0, nwin, rows, 0, 0, nwin, rows, 0, rows);
        }
        trim(PLINTH, ...o(0.05, 0.05), base, hi + 0.45, base, hi + 0.45);
        trim(WHITE, ...o(0.06, 0.06), yAt(a) - 0.22, yAt(a) + 0.02, yAt(d) - 0.22, yAt(d) + 0.02);
        for (const [v, p, s] of [
          [a, ring[(i + m - 1) % m], 1],
          [d, ring[(i + 2) % m], -1],
        ] as const) {
          // corner boards where the outline turns
          const fx = s > 0 ? v.x - p.x : p.x - v.x,
            fz = s > 0 ? v.z - p.z : p.z - v.z,
            fl = Math.hypot(fx, fz) || 1;
          if (Math.abs((fx * uz - fz * ux) / fl) < 0.3) continue;
          const k = Math.min(0.18, len / 2),
            cx = v.x + ox * 0.07,
            cz = v.z + oz * 0.07;
          trim(WHITE, cx, cz, cx + ux * k * s, cz + uz * k * s, base, yAt(v) - 0.2, base, yAt(v) - 0.2);
        }
      }
      if (b.g) {
        const [ax, az, bx, bz] = b.g,
          cx = ax + (bx - ax) * 0.3,
          cz = az + (bz - az) * 0.3,
          ry = yAt({ x: cx, z: cz }); // chimney, in the shell's own mesh
        if (inPoly(b.p, cx, cz))
          box(emit, cx, cz, ry - 0.6, ry + 0.9, 0.6, (hAt(cx, cz) * 7) % 1 < 0.5 ? col('#8a3b2d') : col('#d8d2c4'));
      }
    };
    scene.add(
      new PaintedBuildingShells(D, heightfield, {
        material: new THREE.MeshLambertMaterial({ vertexColors: true, side: THREE.DoubleSide }),
        colours,
        extra: details,
      }).mesh,
    );
    // window skin first, trim after: one mesh, two materials
    const sg = new THREE.BufferGeometry(),
      nw = wp.length / 3,
      nt = tp.length / 3,
      sc = new Float32Array((nw + nt) * 3).fill(1);
    sc.set(tc, nw * 3);
    sg.setAttribute('position', new THREE.Float32BufferAttribute(wp.concat(tp), 3));
    sg.setAttribute('uv', new THREE.Float32BufferAttribute(wu.concat(new Array(nt * 2).fill(0)), 2));
    sg.setAttribute('color', new THREE.BufferAttribute(sc, 3));
    sg.computeVertexNormals();
    sg.addGroup(0, nw, 0);
    sg.addGroup(nw, nt, 1);
    const skin = new THREE.Mesh(sg, [
      new THREE.MeshLambertMaterial({
        map: winTex,
        alphaTest: 0.5,
        side: THREE.DoubleSide,
        polygonOffset: true,
        polygonOffsetFactor: -1,
        polygonOffsetUnits: -2,
      }),
      new THREE.MeshLambertMaterial({
        vertexColors: true,
        side: THREE.DoubleSide,
        polygonOffset: true,
        polygonOffsetFactor: -1,
        polygonOffsetUnits: -2,
      }),
    ]);
    skin.receiveShadow = true;
    scene.add(skin);
  })();
}

// ---------- streetscape: curbs, pavements, verges, crossings and parking (#187) ----------
/** The streetscape's meshes; `debug` tints them by evidence (?debug=streetscape). Returns them and their triangle count. */
export function addStreetscapeMeshes(
  scene: THREE.Scene,
  layout: StreetscapeLayout,
  D: WorldData,
  heightfield: Heightfield,
  roadMaterials: RoadRibbons['materials'],
  debug: boolean,
) {
  const surface = new THREE.MeshLambertMaterial({ vertexColors: true }),
    paint = new THREE.MeshLambertMaterial({
      color: col(0xe9e7da),
      polygonOffset: true,
      polygonOffsetFactor: -2,
      polygonOffsetUnits: -40,
    });
  const sidewalks = new SidewalkMesh(layout, { surface, markings: paint, debugSources: debug, roadMaterials });
  const parking = new ParkingMesh(layout, D, heightfield, { surface, markings: paint, debugSources: debug });
  const meshes = [...sidewalks.meshes, ...parking.meshes];
  scene.add(...meshes);
  const tris = meshes.reduce((n, m) => n + m.geometry.getAttribute('position').count / 3, 0);
  return { meshes, tris };
}

// ---------- trees: spruces and birches, each with its own shade, size and lean ----------
const STREET_TREE_SCALE = 0.75;
/**
 * The forests' trees (x, z, scale per tree) and the street trees, as instanced meshes. Returns every tree's spot, so
 * main.ts can bake their shadows into the ground texture.
 */
export function addTrees(
  scene: THREE.Scene,
  forestSpots: readonly number[],
  streetTrees: StreetscapeLayout['trees'],
  heightfield: Heightfield,
  HALF: number,
) {
  const hAt = (x: number, z: number) => heightfield.heightAt(x, z);
  // street trees (mapped and inferred) join the forest's instanced meshes as birches, the deciduous kind
  const FOREST_N = forestSpots.length / 3,
    spots = forestSpots.slice();
  for (const t of streetTrees) spots.push(t.x, t.z, STREET_TREE_SCALE);
  // variety comes from a hash of the position, so the trees don't consume rnd() and shift the rest of the world
  const hash = (x: number, z: number, k: number) => {
    const v = Math.sin(x * 12.9898 + z * 78.233 + k * 37.719) * 43758.5453;
    return v - Math.floor(v);
  };
  const cone = (r: number, h: number, y: number) => new THREE.ConeGeometry(r, h, 7, 1, true).translate(0, y + h / 2, 0);
  const KINDS = [
    {
      crown: mergeGeo([[cone(3.2, 6.5, 1.4)], [cone(2.5, 5.6, 4.6)], [cone(1.7, 4.6, 7.9)]]),
      trunk: new THREE.CylinderGeometry(0.22, 0.3, 2.2, 7, 1, true).translate(0, 1.1, 0),
      bark: '#5a4632',
      leaf: ['#2f5a36', '#4d7d48'],
    }, // spruce
    {
      crown: mergeGeo([
        [new THREE.SphereGeometry(2.7, 7, 5).scale(1, 1.25, 1).translate(0, 6.6, 0)],
        [new THREE.SphereGeometry(1.9, 6, 4).translate(0.9, 8.6, 0.4)],
        [new THREE.SphereGeometry(1.6, 6, 4).translate(-1, 7.8, -0.6)],
      ]),
      trunk: new THREE.CylinderGeometry(0.14, 0.2, 6, 6, 1, true).translate(0, 3, 0),
      bark: '#e9e6dc',
      leaf: ['#5f8f3e', '#93b55a'],
    }, // birch
  ];
  const BIRCH_SHARE = 0.3,
    m4 = new THREE.Matrix4(),
    q = new THREE.Quaternion(),
    e = new THREE.Euler(),
    v = new THREE.Vector3(),
    s = new THREE.Vector3(),
    c = new THREE.Color();
  const N = spots.length / 3,
    kind = (i: number) => (i >= FOREST_N || hash(spots[i * 3], spots[i * 3 + 1], 1) < BIRCH_SHARE ? 1 : 0);
  // one InstancedMesh per kind and cell, so the main and shadow passes cull whole cells (three bounds an InstancedMesh by its instances)
  const TREE_CELL_M = 400,
    cellOf = (v: number) => Math.floor((v + HALF) / TREE_CELL_M);
  KINDS.forEach((kd, ki) => {
    const cells = new Map<string, number[]>();
    for (let i = 0; i < N; i++)
      if (kind(i) === ki) {
        const k = cellOf(spots[i * 3]) + ',' + cellOf(spots[i * 3 + 1]);
        let l = cells.get(k);
        if (!l) {
          l = [];
          cells.set(k, l);
        }
        l.push(i);
      }
    const crownMat = new THREE.MeshLambertMaterial({ color: 0xffffff }),
      trunkMat = new THREE.MeshLambertMaterial({ color: col(kd.bark), side: THREE.DoubleSide });
    const lo = col(kd.leaf[0]),
      hiC = col(kd.leaf[1]);
    for (const idx of cells.values()) {
      const crown = new THREE.InstancedMesh(kd.crown, crownMat, idx.length),
        trunk = new THREE.InstancedMesh(kd.trunk, trunkMat, idx.length);
      idx.forEach((i, j) => {
        const x = spots[i * 3],
          z = spots[i * 3 + 1],
          sc = spots[i * 3 + 2];
        e.set((hash(x, z, 2) - 0.5) * 0.1, hash(x, z, 3) * 6.283, (hash(x, z, 4) - 0.5) * 0.1);
        q.setFromEuler(e);
        m4.compose(v.set(x, hAt(x, z) - 0.3, z), q, s.set(sc, sc * (0.85 + hash(x, z, 5) * 0.3), sc));
        crown.setMatrixAt(j, m4);
        trunk.setMatrixAt(j, m4);
        crown.setColorAt(j, c.copy(lo).lerp(hiC, hash(x, z, 6)));
      });
      for (const m of [crown, trunk]) {
        m.castShadow = true;
        scene.add(m);
      }
    }
  });
  return spots;
}
