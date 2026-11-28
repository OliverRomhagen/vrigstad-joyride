import '../three-legacy';
import * as THREE from 'three';
import { ROAD_WIDTH_M, type RoadClass, Surface, surfaceOf } from '../data';
import type { Heightfield } from '../heightfield';
import { resample, ribbonEdges, STEP_M } from '../polyline';
import { nodeKey, type Point, type RoadNetwork, roadLiftM } from '../roads';

export interface RoadRibbonOptions {
  /** a light tile that the road colours tint, repeating every TILE_M in world x and z; it stays the caller's */
  asphalt: THREE.Texture;
  /** sRGB colour of each road surface (surfaceOf, #399), indexed by Surface; it tints the asphalt texture */
  surfaceColours: Readonly<Record<Surface, number>>;
  /** sRGB colour of the centre line */
  centreLineColour: number;
  /** the deck height of a ribbon vertex on a bridge road, undefined elsewhere (BridgeIndex.ribbonHeight) */
  heightOf?: (ri: number, x: number, z: number, lift: number) => number | undefined;
  /** roads that draw their own surface and get no ribbon: the footbridges, whose decks are the walking surface */
  skip?: (ri: number) => boolean;
}

/**
 * where a road meets one of a harder surface at its end, its colour fades in from that road's over this far (m), on the
 * softer road's side, so a gravel track leaving a street doesn't step (#399). The fade starts at the harder road's edge,
 * where the softer ribbon comes out from under it, and the ribbon gets a vertex at each end of it, so it runs this
 * length at every junction whatever the sampling.
 */
export const SURFACE_BLEND_M = 4;
/**
 * how soft each surface is: the softer of two roads that meet sits lower, so the harder one draws on top, and the softer
 * one fades in from the harder's colour; equal ones don't fade
 */
const SOFTNESS: Readonly<Record<Surface, number>> = {
  [Surface.UNKNOWN]: 0,
  [Surface.ASPHALT]: 0,
  [Surface.CONCRETE]: 0,
  [Surface.PAVING]: 1,
  [Surface.GRAVEL]: 2,
  [Surface.UNPAVED]: 3,
  [Surface.GRASS]: 3,
};
/**
 * each step of SOFTNESS lowers a ribbon this far below its class's lift (m): roads of one class share a mesh and a
 * polygon offset, so without it two surfaces meeting at a node fight where their ends overlap. 3 steps stay under the
 * 3 cm between classes, so a bigger class still draws on top
 */
const SURFACE_LIFT_STEP_M = 0.006;

/** Height of a road's ribbon above the terrain (m): its class's lift, less a little for a softer surface. */
export const ribbonLiftM = (c: RoadClass, surface: Surface) => roadLiftM(c) - SOFTNESS[surface] * SURFACE_LIFT_STEP_M;

/** bridge roads are cut every metre, so the ribbon follows the deck's crest (m) */
const BRIDGE_STEP_M = 1;

/** the last ribbon is the centre line, painted on primary and secondary roads */
const CENTRE_LINE = ROAD_WIDTH_M.length;
const CENTRE_LINE_WIDTH_M = 0.2;
const CENTRE_LINE_LIFT_M = 0.3;
/**
 * the asphalt texture repeats every this many metres in world x and z (m): mapped in world space, not along each ribbon,
 * so two overlapping ribbons of one surface draw the same speckle and a junction shows no seam (#399)
 */
export const TILE_M = 4;

/**
 * The road ribbons drawn over the ground texture: one mesh per road class, plus the centre lines. The class sets width,
 * lift and draw order; the colour is the road's surface, per vertex (#399). Adds nothing to a scene. `dispose()` frees
 * the geometry and materials it made; the asphalt texture stays the caller's.
 */
export class RoadRibbons {
  /** in draw order; classes with no roads have no mesh */
  readonly meshes: THREE.Mesh[] = [];
  /**
   * each road class's material, by RoadClass, so road-level patches beside the ribbons can look the same: white, tinted
   * by a `color` attribute, which the patches need too (surfaceColour gives it)
   */
  readonly materials: (THREE.Material | undefined)[] = [];
  private readonly linearBySurface = new Map<Surface, THREE.Color>();
  private readonly surfaceColours: Readonly<Record<Surface, number>>;

  constructor(
    roads: Pick<RoadNetwork, 'lines'>,
    heightfield: Pick<Heightfield, 'heightAt'>,
    { asphalt, surfaceColours, centreLineColour, heightOf, skip }: RoadRibbonOptions,
  ) {
    this.surfaceColours = surfaceColours;
    const positions: number[][] = Array.from({ length: CENTRE_LINE + 1 }, () => []);
    const colours: number[][] = Array.from({ length: CENTRE_LINE }, () => []);
    /** `alongByVertex`, when given, gets each pushed vertex's distance along the road (m); returns the road's length */
    const ribbon = (
      ri: number,
      out: number[],
      points: Point[],
      width: number,
      lift: number,
      alongByVertex?: number[],
    ) => {
      const onBridge = heightOf?.(ri, points[0][0], points[0][1], lift) !== undefined;
      const q = resample(points, onBridge ? BRIDGE_STEP_M : STEP_M);
      const y = (x: number, z: number) =>
        (onBridge ? heightOf?.(ri, x, z, lift) : undefined) ?? heightfield.heightAt(x, z) + lift;
      let pl: number[] = [];
      let pr: number[] = [];
      let along = 0;
      let before = 0;
      for (let i = 0; i < q.length; i++) {
        if (i > 0) along += Math.hypot(q[i][0] - q[i - 1][0], q[i][1] - q[i - 1][1]);
        const { lx, lz, rx, rz } = ribbonEdges(q, i, width);
        const l = [lx, y(lx, lz), lz];
        const r = [rx, y(rx, rz), rz];
        if (i > 0) {
          out.push(
            pl[0],
            pl[1],
            pl[2],
            l[0],
            l[1],
            l[2],
            r[0],
            r[1],
            r[2],
            pl[0],
            pl[1],
            pl[2],
            r[0],
            r[1],
            r[2],
            pr[0],
            pr[1],
            pr[2],
          );
          alongByVertex?.push(before, along, along, before, along, before); // pl, l, r, pl, r, pr
        }
        pl = l;
        pr = r;
        before = along;
      }
      return along;
    };
    const { lines } = roads;
    const surfaceByRoad = lines.map(r => surfaceOf(r));
    const roadsByNode = new Map<string, number[]>();
    lines.forEach((r, ri) => {
      if (skip?.(ri)) return;
      for (const p of r.p) {
        const k = nodeKey(p);
        const list = roadsByNode.get(k);
        if (!list) roadsByNode.set(k, [ri]);
        else if (!list.includes(ri)) list.push(ri);
      }
    });
    // what road ri fades in from at its end p: the hardest other surface there, if harder than ri's, and how far from p
    // the widest road of that surface reaches (m), where ri comes out from under it
    const fadeFrom = (ri: number, p: Point) => {
      const mine = SOFTNESS[surfaceByRoad[ri]];
      let from: Surface | null = null;
      let edgeM = 0;
      for (const o of roadsByNode.get(nodeKey(p)) ?? []) {
        const soft = SOFTNESS[surfaceByRoad[o]];
        if (soft >= mine || (from !== null && soft > SOFTNESS[from])) continue;
        if (from === null || soft < SOFTNESS[from]) {
          from = surfaceByRoad[o];
          edgeM = 0;
        }
        edgeM = Math.max(edgeM, ROAD_WIDTH_M[lines[o].c] / 2);
      }
      return from === null ? null : { colour: this.linear(from), edgeM };
    };
    const mixed = new THREE.Color();
    lines.forEach((r, ri) => {
      if (skip?.(ri)) return;
      const out = positions[r.c],
        surface = surfaceByRoad[ri],
        own = this.linear(surface),
        lift = ribbonLiftM(r.c, surface);
      const start = fadeFrom(ri, r.p[0]),
        end = fadeFrom(ri, r.p[r.p.length - 1]);
      if (!start && !end) {
        const from = out.length;
        ribbon(ri, out, r.p, ROAD_WIDTH_M[r.c], lift);
        for (let k = from; k < out.length; k += 3) colours[r.c].push(own.r, own.g, own.b);
      } else {
        const length = pathLength(r.p);
        const cuts = [
          ...(start ? [start.edgeM, start.edgeM + SURFACE_BLEND_M] : []),
          ...(end ? [length - end.edgeM - SURFACE_BLEND_M, length - end.edgeM] : []),
        ];
        const alongByVertex: number[] = [];
        ribbon(ri, out, cutAt(r.p, cuts), ROAD_WIDTH_M[r.c], lift, alongByVertex);
        for (const along of alongByVertex) {
          mixed.copy(own);
          if (start) mixed.lerpColors(start.colour, mixed, clamp01((along - start.edgeM) / SURFACE_BLEND_M));
          if (end) mixed.lerpColors(end.colour, mixed, clamp01((length - end.edgeM - along) / SURFACE_BLEND_M));
          colours[r.c].push(mixed.r, mixed.g, mixed.b);
        }
      }
      if (r.c < 2) ribbon(ri, positions[CENTRE_LINE], r.p, CENTRE_LINE_WIDTH_M, CENTRE_LINE_LIFT_M);
    });

    positions.forEach((p, i) => {
      if (!p.length) return;
      const g = new THREE.BufferGeometry();
      g.setAttribute('position', new THREE.Float32BufferAttribute(p, 3));
      if (i < CENTRE_LINE) {
        g.setAttribute('color', new THREE.Float32BufferAttribute(colours[i], 3));
        g.setAttribute('uv', new THREE.Float32BufferAttribute(worldUv(p), 2));
      }
      g.computeVertexNormals();
      // minor roads are drawn first and pushed furthest back, so a junction shows the bigger road on top
      const order = i === CENTRE_LINE ? 8 : 6 - i;
      const material = new THREE.MeshLambertMaterial({
        color: i < CENTRE_LINE ? 0xffffff : new THREE.Color(centreLineColour).convertSRGBToLinear(),
        vertexColors: i < CENTRE_LINE,
        map: i < CENTRE_LINE ? asphalt : null,
        side: THREE.DoubleSide,
        polygonOffset: true,
        polygonOffsetFactor: -2,
        polygonOffsetUnits: -4 * order,
      });
      if (i < CENTRE_LINE) this.materials[i] = material;
      const mesh = new THREE.Mesh(g, material);
      mesh.receiveShadow = true;
      mesh.renderOrder = order;
      this.meshes.push(mesh);
    });
  }

  /** A surface's linear colour, as the ribbons' `color` attribute holds it, copied into `out`, for patches drawn with their materials. */
  surfaceColour(surface: Surface, out: THREE.Color): THREE.Color {
    return out.copy(this.linear(surface));
  }

  /** the cached colour itself: callers inside the class only read it */
  private linear(surface: Surface): THREE.Color {
    let c = this.linearBySurface.get(surface);
    if (!c) {
      c = new THREE.Color(this.surfaceColours[surface]).convertSRGBToLinear();
      this.linearBySurface.set(surface, c);
    }
    return c;
  }

  dispose() {
    for (const mesh of this.meshes) {
      mesh.geometry.dispose();
      (mesh.material as THREE.Material).dispose();
    }
  }
}

const clamp01 = (t: number) => Math.min(1, Math.max(0, t));

const pathLength = (points: readonly Point[]) => {
  let length = 0;
  for (let i = 1; i < points.length; i++)
    length += Math.hypot(points[i][0] - points[i - 1][0], points[i][1] - points[i - 1][1]);
  return length;
};

/** The polyline with a vertex added at each of the distances along it (m) that falls strictly inside it. */
export function cutAt(points: readonly Point[], alongs: readonly number[]): Point[] {
  const cuts = alongs.filter(a => a > 1e-6).sort((x, y) => x - y);
  const out: Point[] = [points[0]];
  let start = 0;
  let c = 0;
  for (let i = 1; i < points.length; i++) {
    const a = points[i - 1];
    const b = points[i];
    const span = Math.hypot(b[0] - a[0], b[1] - a[1]);
    for (; c < cuts.length && cuts[c] < start + span - 1e-6; c++) {
      if (cuts[c] <= start + 1e-6) continue;
      const t = (cuts[c] - start) / span;
      out.push([a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t]);
    }
    out.push(b);
    start += span;
  }
  return out;
}

/** UVs from world x and z, TILE_M to a tile, for flat [x, y, z, ...] positions. */
export function worldUv(positions: ArrayLike<number>, offsetX = 0, offsetZ = 0) {
  const uv = new Float32Array((positions.length / 3) * 2);
  for (let i = 0, j = 0; i < positions.length; i += 3, j += 2) {
    uv[j] = (positions[i] + offsetX) / TILE_M;
    uv[j + 1] = (positions[i + 2] + offsetZ) / TILE_M;
  }
  return uv;
}
