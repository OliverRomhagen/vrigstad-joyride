// The world's meshes in the game's scene: the terrain, the road ribbons, the painted houses with their windows and trim,
// the streetscape's pavements and parking, and the trees. The world's data and queries come from src/world/.
// Moved from src/game/main.ts (#177); main.ts calls these in the same order as before, since the house colours roll rnd().
import * as THREE from 'three';
import type { BridgeIndex } from '../../world/bridges';
import { type BuildingShape, HOUSE_MAX_M2, HOUSE_MIN_M2, type PointXZ } from '../../world/buildings';
import { Surface, type WorldData } from '../../world/data';
import type { Heightfield } from '../../world/heightfield';
import { BridgeMesh } from '../../world/mesh/bridge-mesh';
import { type EmitVertex, PaintedBuildingShells } from '../../world/mesh/building-shells';
import { ParkingMesh } from '../../world/mesh/parking-mesh';
import { RoadRibbons } from '../../world/mesh/road-ribbons';
import { ShoreProps } from '../../world/mesh/shore-props';
import { SidewalkMesh } from '../../world/mesh/sidewalk-mesh';
import { TerrainMesh } from '../../world/mesh/terrain';
import { WaterMaterial } from '../../world/mesh/water-material';
import { WaterSurface } from '../../world/mesh/water-surface';
import { pointInPolygon as inPoly } from '../../world/polygon';
import type { RoadNetwork } from '../../world/roads';
import type { ShoreLayout } from '../../world/shore';
import type { StreetscapeLayout } from '../../world/streetscape';
import { col } from '../../world/three-legacy';
import { GAME_WATER } from '../../world/water-palette';
import type { WaterBodies } from '../../world/water-shapes';
import { HOUSE_SHELLS_MATERIAL } from './house-materials';
import { INK_COLOR, INK_FLAG, INK_NO_FEET_FLAG } from './ink-flag';
import { mergeGeo } from './models';
import { WINDOW_GLASS, WINDOW_TILE_M, WindowFrames, windowRun } from './window-frames';

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
  scene.add(terrain.surface, ...terrain.refined, far, terrain.skirt);
  return terrain;
}

// ---------- water: lake and river surfaces, and the shore's reeds and stones ----------
const REED_COLOURS = ['#7f9150', '#93964f', '#a69a62', '#6f8748'],
  STONE_COLOURS = ['#8c877c', '#77736b', '#9d988b', '#837a6c'];
/** The water's surfaces and the shore's props; `tick` moves the ripples on once a frame. */
export function addWater(
  scene: THREE.Scene,
  bodies: WaterBodies,
  shore: ShoreLayout,
  heightfield: Heightfield,
  look: { sunDir: THREE.Vector3; horizon: THREE.Color; coarse: boolean },
) {
  const detail = look.coarse ? 'lite' : 'full';
  const lake = new WaterMaterial({
    colours: GAME_WATER,
    sunDir: look.sunDir,
    horizon: look.horizon,
    flowing: false,
    detail,
  });
  const river = new WaterMaterial({
    colours: GAME_WATER,
    sunDir: look.sunDir,
    horizon: look.horizon,
    flowing: true,
    detail,
  });
  // a river's end tucks under the lake it meets: the same level, so it wins the depth test by a nudge
  Object.assign(river.material, { polygonOffset: true, polygonOffsetFactor: -1, polygonOffsetUnits: -1 });
  const surface = new WaterSurface(bodies, { lakeMaterial: lake.material, riverMaterial: river.material });
  const props = new ShoreProps(shore, {
    heightAt: (x, z) => heightfield.heightAt(x, z),
    reedColours: REED_COLOURS.map(c => col(c)),
    stoneColours: STONE_COLOURS.map(c => col(c)),
  });
  scene.add(...surface.meshes, ...props.meshes);
  return {
    surface,
    props,
    materials: [lake, river],
    tick(dt: number, sunLight: number) {
      lake.tick(dt, sunLight);
      river.tick(dt, sunLight);
    },
  };
}

// ---------- roads: crisp ribbons on the terrain ----------
// sRGB, by surface (surfaceOf, #399): every car road one asphalt, whatever its class, so a junction shows no step
const ROAD_COLOURS: Record<Surface, number> = {
    [Surface.UNKNOWN]: 0x606365,
    [Surface.ASPHALT]: 0x606365, // today's street grey: the streetscape's road and the parking lots wear it too
    [Surface.PAVING]: 0x7a746b, // setts and paving stones: a lighter, warmer grey
    [Surface.CONCRETE]: 0x8c8c88,
    [Surface.GRAVEL]: 0xa08c6c,
    [Surface.UNPAVED]: 0xbcae92,
    [Surface.GRASS]: 0x8f9e6a,
  },
  CENTRE_LINE_COLOUR = 0xe9e7da;
/** The road ribbons, on a speckled asphalt tile; the streetscape's curbs reuse their materials. */
export function addRoadRibbons(
  scene: THREE.Scene,
  roads: RoadNetwork,
  heightfield: Heightfield,
  maxAnisotropy: number,
  bridges: BridgeIndex,
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
    surfaceColours: ROAD_COLOURS,
    centreLineColour: CENTRE_LINE_COLOUR,
    heightOf: bridges.ribbonHeight.bind(bridges),
    skip: ri => (bridges.bridgeOf(ri)?.archetype ?? 'road-slab') !== 'road-slab',
  });
  scene.add(...roadRibbons.meshes);
  return roadRibbons;
}

// ---------- bridges: decks, edge beams, walkways and railings over the ribbons (#238) ----------
/** The bridges' structure, timed for the test hook; the ribbons draw their driving surface. */
export function addBridges(scene: THREE.Scene, bridges: BridgeIndex, heightfield: Heightfield) {
  const t0 = performance.now();
  const material = new THREE.MeshLambertMaterial({ vertexColors: true });
  const draw = new BridgeMesh(bridges, {
    materials: { body: material, railing: material },
    top: false,
    groundAt: (x, z) => heightfield.heightAt(x, z),
  });
  scene.add(...draw.meshes);
  return { meshes: draw.meshes, triangles: draw.triangles, ms: performance.now() - t0 };
}

// ---------- buildings (painted in Swedish house colours) ----------
// house details: windows (a texture on a skin just outside the walls), and in the shell's own mesh, so they have edges for the
// toon style's lines (#413): a dark plinth and white corner boards standing out from the walls, eaves that run on past the
// walls of gabled roofs, ending in a white fascia board, a white board under flat roofs, and a chimney on gabled roofs
const WIN_W = WINDOW_TILE_M,
  STOREY = 2.8; // window spacing and storey height (m)
const BOARD_M = 0.2, // the width of a timber house's panel boards in the toon style (m)
  BOARD_SEAM_ALPHA = 0.28,
  TIMBER_MAX_M2 = 450; // the same size that gives a house the big buildings' plaster colours
/** how far the plinth stands out from a house's wall (m); the safehouse doors stand clear of it (render/places.ts) */
export const PLINTH_OUT_M = 0.08;
/** how high the plinth's top stands over the highest ground under a house (m) */
export const PLINTH_TOP_M = 0.45;
const CORNER_OUT_M = 0.07,
  TOON_CORNER_OUT_M = 0.16, // the toon style's posts, as thick as they're wide, as in the art direction mocks
  EAVE_M = 0.35, // how far a gabled roof runs on past the walls
  FASCIA_M = 0.15, // the depth of the board at its edge
  FLAT_BOARD_OUT_M = 0.06;
/** The game's seeded rnd(), which rolls the house colours so they come out the same every time, and the renderer's anisotropy for the window texture. */
export interface BuildingMeshOptions {
  rnd(): number;
  pick<T>(a: readonly T[]): T;
  maxAnisotropy: number;
  /** A point inside each building to leave out, because the game draws it itself: Skroten's workshop and carport (render/skroten.ts). */
  skip?: readonly { x: number; z: number }[];
  /** Walls in one colour, without darkening towards the ground: the toon style's bands read better on them (#413). */
  flatWalls?: boolean;
  /** The seams between the panel boards on timber houses, for the toon style (#413). */
  boardSeams?: boolean;
  /**
   * Painted windows with the 3D windows' glass and no cross bars, so the two match where the frames start, and square
   * corner posts, as thick as they're wide, as in the art direction mocks (#413).
   */
  toonWindows?: boolean;
  /** Draw 3D frames over the painted windows within this many metres of the camera (render/window-frames.ts); 0 for none. */
  windowFramesM?: number;
}
/**
 * The house shells in their colours with their trim, and one mesh of windows. Rolls rnd() once or twice per house, in data
 * order. Returns the 3D window frames, for the frame loop to `update` with the camera's position, or null without them.
 */
export function addBuildings(
  scene: THREE.Scene,
  D: WorldData,
  heightfield: Heightfield,
  {
    rnd,
    pick,
    maxAnisotropy,
    skip = [],
    flatWalls = false,
    boardSeams = false,
    toonWindows = false,
    windowFramesM = 0,
  }: BuildingMeshOptions,
) {
  const isSkipped = (p: readonly number[]) => skip.some(s => inPoly(p as number[], s.x, s.z));
  const hAt = (x: number, z: number) => heightfield.heightAt(x, z);
  const winTex = (() => {
    const cv = document.createElement('canvas');
    cv.width = cv.height = 128;
    const x = cv.getContext('2d')!,
      u = (v: number) => (v / WIN_W) * 128,
      y = (v: number) => 128 - (v / STOREY) * 128;
    x.translate(u(WIN_W / 2 - 1.3), 0); // the window below is drawn for a 2.6 m tile: centred in the wider one
    x.fillStyle = '#f1efe8';
    x.fillRect(u(0.8), y(2.15), u(1), y(0.9) - y(2.15)); // frame: 1.0 x 1.25 m, sill 0.9 m up
    x.fillStyle = toonWindows ? WINDOW_GLASS : '#26323a';
    x.fillRect(u(0.88), y(2.07), u(0.84), y(0.98) - y(2.07));
    if (!toonWindows) {
      x.fillStyle = '#f1efe8';
      x.fillRect(u(1.265), y(2.07), u(0.07), y(0.98) - y(2.07));
      x.fillRect(u(0.88), y(1.75), u(0.84), y(1.68) - y(1.75)); // cross bars
    }
    const t = new THREE.CanvasTexture(cv);
    t.wrapS = t.wrapT = THREE.RepeatWrapping;
    t.colorSpace = THREE.SRGBColorSpace;
    t.anisotropy = maxAnisotropy;
    t.generateMipmaps = false;
    t.minFilter = THREE.LinearFilter;
    return t; // mips average the mostly transparent tile below alphaTest, so windows would vanish at a distance
  })();
  // the frames hold only their own copy of the windows, so the arrays built here can go once this returns
  return (() => {
    const c = new THREE.Color(),
      c2 = new THREE.Color(),
      c3 = new THREE.Color(),
      paint = { wall: c, wallFoot: c3, roof: c2 };
    const wp: number[] = [],
      wu: number[] = [],
      frames: number[] = [], // each window's centre, facing and size, for WindowFrames
      bp: number[] = [], // the board seams' skin, its positions and uvs
      bu: number[] = [],
      WHITE = col('#f1efe8'),
      PLINTH = col('#5b5d5b');
    const house = ['#9c3a2c', '#9c3a2c', '#a8452f', '#e8e2d2', '#e8e2d2', '#d9b65a', '#cfc8b8', '#8d9a8f'],
      big = ['#c9c5bb', '#b8b3a6', '#d6d0c0', '#a7aeb0'];
    type Quad = [x1: number, z1: number, x2: number, z2: number, b1: number, t1: number, b2: number, t2: number];
    // a vertical quad from (x1, z1) to (x2, z2), bottom and top heights at each end
    const quad = (out: number[], ...[x1, z1, x2, z2, b1, t1, b2, t2]: Quad) =>
      out.push(x1, b1, z1, x2, b2, z2, x2, t2, z2, x1, b1, z1, x2, t2, z2, x1, t1, z1);
    type Corner = [x: number, y: number, z: number];
    // a flat four-cornered face, in order round its edge, into the shell's mesh; wound to face `out`, whichever way the
    // outline runs, so its normal points out of the trim (the sun's shadow normalBias goes along it)
    const face = (emit: EmitVertex, k: THREE.Color, out: Corner, ...q: [Corner, Corner, Corner, Corner]) => {
      const [p, r, t] = q,
        ax = r[0] - p[0],
        ay = r[1] - p[1],
        az = r[2] - p[2],
        bx = t[0] - p[0],
        by = t[1] - p[1],
        bz = t[2] - p[2],
        facing = (ay * bz - az * by) * out[0] + (az * bx - ax * bz) * out[1] + (ax * by - ay * bx) * out[2];
      for (const i of facing >= 0 ? [0, 1, 2, 0, 2, 3] : [0, 2, 1, 0, 3, 2]) emit(q[i][0], q[i][1], q[i][2], k);
    };
    const UP: Corner = [0, 1, 0],
      DOWN: Corner = [0, -1, 0];
    const box = (emit: EmitVertex, x: number, z: number, y0: number, y1: number, s: number, k: THREE.Color) => {
      const h = s / 2,
        // counter-clockwise on the map, so the walls face out
        P = [
          [x - h, z - h],
          [x - h, z + h],
          [x + h, z + h],
          [x + h, z - h],
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
      c.set(
        b.k === 2 ? '#9c3a2c' : b.k ? '#efece3' : area > TIMBER_MAX_M2 ? pick(big) : pick(house),
      ).convertSRGBToLinear();
      c2.set(b.k === 2 ? '#a8573f' : b.k ? '#3f4447' : rnd() < 0.35 ? '#4d4a48' : '#a8573f').convertSRGBToLinear();
      if (isSkipped(b.p)) return null; // after the rolls above, so the houses after it keep their colours
      c3.copy(c).multiplyScalar(flatWalls ? 1 : 0.62); // walls darken towards the ground, unless flat for the toon style's bands
      return paint;
    };
    // not the church and its tower, not sheds or barns, not one drawn elsewhere
    const trimmed = ({ building: b, area }: BuildingShape) =>
      b.k !== 1 && area >= HOUSE_MIN_M2 && area <= HOUSE_MAX_M2 && !isSkipped(b.p);
    // a trimmed gabled house's walls stop at its soffit, which closes them under the eave, so the roof's edge along the
    // walls is shared only with the eave, in its own plane, and the toon style draws no line 0.35 m in from the fascia's
    const wallDrop = (shape: BuildingShape) => (shape.building.g && trimmed(shape) ? FASCIA_M : 0);
    // the timber houses, which get board seams in the toon style; the ones too small for trim too
    const boarded = ({ building: b, area }: BuildingShape) =>
      boardSeams && !b.k && area <= TIMBER_MAX_M2 && !isSkipped(b.p);
    // where each wall's boards start (in boards), counted on from a corner, so a straight wall stays one run of boards
    // where the outline splits it at the ridge (roofParts) or starts partway along it
    const boardStarts = (ring: readonly PointXZ[]) => {
      const m = ring.length,
        starts = new Array<number>(m).fill(0),
        walls = ring.map((a, i) => {
          const d = ring[(i + 1) % m],
            len = Math.hypot(d.x - a.x, d.z - a.z);
          return len < 1e-3 ? null : { ux: (d.x - a.x) / len, uz: (d.z - a.z) / len, len };
        });
      type Wall = NonNullable<(typeof walls)[number]>;
      const straightOn = (p: Wall, q: Wall) => p.ux * q.ux + p.uz * q.uz > 0.999;
      const before = (i: number) => {
        for (let k = 1; k < m; k++) {
          const w = walls[(i - k + m) % m];
          if (w) return w;
        }
        return null;
      };
      const first = Math.max(
        0,
        walls.findIndex((w, i) => {
          const p = before(i);
          return w && p && !straightOn(w, p);
        }),
      );
      let run = 0,
        prev: Wall | null = null;
      for (let k = 0; k < m; k++) {
        const i = (first + k) % m,
          w = walls[i];
        if (!w) continue;
        starts[i] = prev && straightOn(w, prev) ? run : 0;
        run = starts[i] + w.len / BOARD_M;
        prev = w;
      }
      return starts;
    };
    // the seams on the wall from a to d (outward normal o, length len), just outside it, from y0 up to ta at a and td at d,
    // between the wall and the windows' skin; u counts boards along the wall, from u0
    const seamWall = (
      a: PointXZ,
      d: PointXZ,
      ox: number,
      oz: number,
      len: number,
      u0: number,
      y0: number,
      ta: number,
      td: number,
    ) => {
      const u1 = u0 + len / BOARD_M;
      quad(bp, a.x + ox * 0.02, a.z + oz * 0.02, d.x + ox * 0.02, d.z + oz * 0.02, y0, ta, y0, td);
      bu.push(u0, 0, u1, 0, u1, 1, u0, 0, u1, 1, u0, 1);
    };
    // a house too small for trim has no plinth or eaves: its boards run from its foot to its roof
    const untrimmedSeams = ({ ring, yAt, base, winding: wind }: BuildingShape) => {
      const starts = boardStarts(ring);
      for (let i = 0; i < ring.length; i++) {
        const a = ring[i],
          d = ring[(i + 1) % ring.length],
          len = Math.hypot(d.x - a.x, d.z - a.z);
        if (len < 1e-3) continue;
        seamWall(a, d, (wind * (d.z - a.z)) / len, (-wind * (d.x - a.x)) / len, len, starts[i], base, yAt(a), yAt(d));
      }
    };
    const details = (shape: BuildingShape, emit: EmitVertex) => {
      if (!trimmed(shape)) {
        if (boarded(shape)) untrimmedSeams(shape);
        return;
      }
      const { building: b, area, ring, yAt, roofY, base, top, hi, winding: wind } = shape;
      const m = ring.length,
        yb = hi + 0.2,
        yt = top - 0.25,
        rows = Math.max(1, Math.round((yt - yb) / STOREY));
      // a wall's outward normal, from p to q
      const normal = (p: { x: number; z: number }, q: { x: number; z: number }): [number, number] => {
        const l = Math.hypot(q.x - p.x, q.z - p.z) || 1;
        return [(wind * (q.z - p.z)) / l, (-wind * (q.x - p.x)) / l];
      };
      const seamStarts = boarded(shape) ? boardStarts(ring) : null;
      for (let i = 0; i < m; i++) {
        const a = ring[i],
          d = ring[(i + 1) % m],
          ex = d.x - a.x,
          ez = d.z - a.z,
          len = Math.hypot(ex, ez);
        if (len < 1e-3) continue;
        const short = len < 0.4; // no windows or corner boards, but the plinth and the eave still run on along it
        const ux = ex / len,
          uz = ez / len,
          ox = wind * uz,
          oz = -wind * ux,
          prev = normal(ring[(i + m - 1) % m], a),
          next = normal(d, ring[(i + 2) % m]),
          // how far a line `k` m out from this wall runs on past a corner, to where the neighbour's line `k` m out crosses
          // it: a mitre, so corners of any angle close (none where the outline only splits at the ridge)
          mitre = (n: [number, number], along: number, k: number) =>
            (-k / Math.max(0.3, 1 + ox * n[0] + oz * n[1])) * (n[0] * ux + n[1] * uz) * along,
          // the ends of that line, mitred at both corners unless `mitred` is false
          o = (k: number, mitred = true): [number, number, number, number] => {
            const sa = mitred ? mitre(prev, 1, k) : 0,
              sd = mitred ? mitre(next, -1, k) : 0;
            return [a.x + ox * k - ux * sa, a.z + oz * k - uz * sa, d.x + ox * k + ux * sd, d.z + oz * k + uz * sd];
          },
          // whether that line still runs from a's end to d's: on a wall shorter than what its mitres at inside corners
          // take off it, its ends swap places
          forwards = (k: number) => len + mitre(prev, 1, k) + mitre(next, -1, k) > 0;
        const run = windowRun(len, area > TIMBER_MAX_M2); // whole windows only, off the corners: the tile stretches a little to fit
        if (run) {
          const nwin = run.count;
          // from d to a where the outline runs the other way, so its front faces out, as the shell's walls do: the shadow's
          // normalBias moves the lookup along the normal, into the wall's own shadow when it points in. The tile is
          // symmetric, so it needs no mirroring
          const [w1x, w1z, w2x, w2z] = o(0.04, false),
            s1x = w1x + ux * run.start,
            s1z = w1z + uz * run.start,
            s2x = w2x - ux * run.start,
            s2z = w2z - uz * run.start;
          if (wind > 0) quad(wp, s2x, s2z, s1x, s1z, yb, yt, yb, yt);
          else quad(wp, s1x, s1z, s2x, s2z, yb, yt, yb, yt);
          wu.push(0, 0, nwin, 0, nwin, rows, 0, 0, nwin, rows, 0, rows);
          if (windowFramesM) {
            // where the tile puts each window: centred along its stretched tile, its frame 0.9-2.15 m up a 2.8 m storey
            const tw = run.tile,
              th = (yt - yb) / rows,
              facing = Math.atan2(ox, oz);
            for (let k = 0; k < nwin; k++)
              for (let r = 0; r < rows; r++) {
                const along = run.start + (k + 0.5) * tw;
                frames.push(
                  a.x + ux * along + ox * 0.04,
                  yb + (r + 1.525 / STOREY) * th,
                  a.z + uz * along + oz * 0.04,
                  facing,
                  (tw * 1.0) / WIN_W,
                  (th * 1.25) / STOREY,
                );
              }
          }
        }
        const ya = yAt(a),
          yd = yAt(d),
          py = hi + PLINTH_TOP_M,
          [p1x, p1z, p2x, p2z] = o(PLINTH_OUT_M),
          OUT: Corner = [ox, 0, oz];
        if (seamStarts) {
          // from the plinth up to the soffit or the flat roof's board, or the roof itself where a gabled wall has no eave
          const under = !b.g ? 0.22 : forwards(EAVE_M) ? FASCIA_M : 0;
          seamWall(a, d, ox, oz, len, seamStarts[i], py, ya - under, yd - under);
        }
        face(emit, PLINTH, OUT, [p1x, base, p1z], [p2x, base, p2z], [p2x, py, p2z], [p1x, py, p1z]);
        face(emit, PLINTH, UP, [a.x, py, a.z], [d.x, py, d.z], [p2x, py, p2z], [p1x, py, p1z]);
        // no eave on a wall too short for its mitres, whose eave line would run backwards and come out crossed
        if (b.g && forwards(EAVE_M)) {
          // the roof runs on EAVE_M past the wall in its own plane, mitred at the corners; each corner's height comes from
          // the corner point alone, so the two walls that meet there agree on it, and never rises above the wall's own top,
          // which a gable askew to the ridge would otherwise do
          const [ax2, az2, dx2, dz2] = o(EAVE_M),
            ya2 = Math.min(ya, roofY({ x: ax2, z: az2 })),
            yd2 = Math.min(yd, roofY({ x: dx2, z: dz2 }));
          face(emit, c2, UP, [a.x, ya, a.z], [d.x, yd, d.z], [dx2, yd2, dz2], [ax2, ya2, az2]);
          face(
            emit,
            WHITE,
            OUT,
            [ax2, ya2, az2],
            [dx2, yd2, dz2],
            [dx2, yd2 - FASCIA_M, dz2],
            [ax2, ya2 - FASCIA_M, az2],
          );
          face(
            emit,
            WHITE,
            DOWN,
            [a.x, ya - FASCIA_M, a.z],
            [d.x, yd - FASCIA_M, d.z],
            [dx2, yd2 - FASCIA_M, dz2],
            [ax2, ya2 - FASCIA_M, az2],
          );
        } else if (b.g) {
          // the wall stops FASCIA_M short of the roof (wallDrop) for the soffit to close; with no soffit, close it here
          face(emit, c, OUT, [a.x, ya - FASCIA_M, a.z], [d.x, yd - FASCIA_M, d.z], [d.x, yd, d.z], [a.x, ya, a.z]);
        } else {
          const [f1x, f1z, f2x, f2z] = o(FLAT_BOARD_OUT_M),
            lo = -0.22;
          face(
            emit,
            WHITE,
            OUT,
            [f1x, ya + lo, f1z],
            [f2x, yd + lo, f2z],
            [f2x, yd + 0.02, f2z],
            [f1x, ya + 0.02, f1z],
          );
          face(emit, WHITE, DOWN, [a.x, ya + lo, a.z], [d.x, yd + lo, d.z], [f2x, yd + lo, f2z], [f1x, ya + lo, f1z]);
          // and its top, back to the wall, so there's no slot to see into between it and the roof
          face(
            emit,
            WHITE,
            UP,
            [a.x, ya + 0.02, a.z],
            [d.x, yd + 0.02, d.z],
            [f2x, yd + 0.02, f2z],
            [f1x, ya + 0.02, f1z],
          );
        }
        if (short) continue;
        const cornerOut = toonWindows ? TOON_CORNER_OUT_M : CORNER_OUT_M,
          board = o(cornerOut);
        for (const [v, p, s] of [
          [a, ring[(i + m - 1) % m], 1],
          [d, ring[(i + 2) % m], -1],
        ] as const) {
          // corner boards where the outline turns: a face out from the wall, and a side
          const fx = s > 0 ? v.x - p.x : p.x - v.x,
            fz = s > 0 ? v.z - p.z : p.z - v.z,
            fl = Math.hypot(fx, fz) || 1;
          if (Math.abs((fx * uz - fz * ux) / fl) < 0.3) continue;
          // the front starts at the mitre with the next wall's board, so the two close the corner; square posts in the toon style
          const k = Math.min(toonWindows ? TOON_CORNER_OUT_M : 0.18, len / 2),
            cx = board[s > 0 ? 0 : 2],
            cz = board[s > 0 ? 1 : 3],
            ex2 = v.x + ux * k * s,
            ez2 = v.z + uz * k * s,
            y1 = yAt(v) - (b.g ? FASCIA_M : 0.2);
          face(
            emit,
            WHITE,
            OUT,
            [cx, py, cz],
            [ex2 + ox * cornerOut, py, ez2 + oz * cornerOut],
            [ex2 + ox * cornerOut, y1, ez2 + oz * cornerOut],
            [cx, y1, cz],
          );
          face(
            emit,
            WHITE,
            [ux * s, 0, uz * s],
            [ex2, py, ez2],
            [ex2 + ox * cornerOut, py, ez2 + oz * cornerOut],
            [ex2 + ox * cornerOut, y1, ez2 + oz * cornerOut],
            [ex2, y1, ez2],
          );
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
    const shells = new PaintedBuildingShells(D, heightfield, {
      material: new THREE.MeshLambertMaterial({
        name: HOUSE_SHELLS_MATERIAL, // gives it the toon style's house ramp
        vertexColors: true,
        side: THREE.DoubleSide,
      }),
      colours,
      extra: details,
      wallDrop,
    }).mesh;
    shells.userData[INK_FLAG] = true; // the toon style inks the houses' corners and roof edges too
    shells.userData[INK_NO_FEET_FLAG] = true; // but not their feet: the walls' in the ground, the corner boards' on the plinth
    scene.add(shells);
    // the window skin: the trim is in the shells now (#413)
    const sg = new THREE.BufferGeometry();
    sg.setAttribute('position', new THREE.Float32BufferAttribute(wp, 3));
    sg.setAttribute('uv', new THREE.Float32BufferAttribute(wu, 2));
    sg.computeVertexNormals();
    const skin = new THREE.Mesh(
      sg,
      new THREE.MeshLambertMaterial({
        map: winTex,
        alphaTest: 0.5,
        side: THREE.DoubleSide,
        polygonOffset: true,
        polygonOffsetFactor: -1,
        polygonOffsetUnits: -2,
      }),
    );
    skin.receiveShadow = true;
    scene.add(skin);
    const near = frames.length ? new WindowFrames(scene, new Float32Array(frames), { radiusM: windowFramesM }) : null;
    if (bp.length) {
      // the seams: a dark line at one edge of each board, half transparent so it darkens any wall colour, unlit so the
      // toon style leaves it alone; its mips fade it out with distance instead of shimmering
      const cv = document.createElement('canvas');
      cv.width = 32;
      cv.height = 4;
      const x = cv.getContext('2d')!;
      x.globalAlpha = BOARD_SEAM_ALPHA;
      x.fillStyle = `#${INK_COLOR.toString(16).padStart(6, '0')}`; // the ink lines' colour
      x.fillRect(0, 0, 2, 4);
      const t = new THREE.CanvasTexture(cv);
      t.colorSpace = THREE.SRGBColorSpace;
      t.wrapS = t.wrapT = THREE.RepeatWrapping;
      t.anisotropy = maxAnisotropy;
      const bg = new THREE.BufferGeometry();
      bg.setAttribute('position', new THREE.Float32BufferAttribute(bp, 3));
      bg.setAttribute('uv', new THREE.Float32BufferAttribute(bu, 2));
      // one mesh for the village, sorted by its origin at Torget: drawn first among the transparent things instead, so
      // smoke, drift sprites and the place markers in front of a house stay in front of its seams
      const seams = new THREE.Mesh(
        bg,
        new THREE.MeshBasicMaterial({
          map: t,
          transparent: true,
          depthWrite: false,
          side: THREE.DoubleSide,
          polygonOffset: true,
          polygonOffsetFactor: -1,
          polygonOffsetUnits: -1,
        }),
      );
      seams.renderOrder = -1;
      scene.add(seams);
    }
    return near;
  })();
}

// ---------- streetscape: curbs, pavements, verges, crossings and parking (#187) ----------
/** The streetscape's meshes; `debug` tints them by evidence (?debug=streetscape). Returns them and their triangle count. */
export function addStreetscapeMeshes(
  scene: THREE.Scene,
  layout: StreetscapeLayout,
  D: WorldData,
  heightfield: Heightfield,
  ribbons: Pick<RoadRibbons, 'materials' | 'surfaceColour'>,
  debug: boolean,
) {
  const surface = new THREE.MeshLambertMaterial({ vertexColors: true }),
    paint = new THREE.MeshLambertMaterial({
      color: col(0xe9e7da),
      polygonOffset: true,
      polygonOffsetFactor: -2,
      polygonOffsetUnits: -40,
    });
  const sidewalks = new SidewalkMesh(layout, {
    surface,
    markings: paint,
    debugSources: debug,
    roadMaterials: ribbons.materials,
    roadColour: (s, out) => ribbons.surfaceColour(s, out),
  });
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
