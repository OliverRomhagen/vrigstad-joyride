import '../three-legacy';
import * as THREE from 'three';
import { ROAD_WIDTH_M, Surface, surfaceOf } from '../data';
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
 * softer road's side, so a gravel track leaving a street doesn't step (#399). Colours are per vertex and the ribbons are
 * sampled every STEP_M, so the fade shows over the first sample step: up to STEP_M on a long straight.
 */
export const SURFACE_BLEND_M = 4;
/** how soft each surface is, for which side of a surface change fades: the softer one; equal ones don't fade */
const SOFTNESS: Readonly<Record<Surface, number>> = {
  [Surface.UNKNOWN]: 0,
  [Surface.ASPHALT]: 0,
  [Surface.CONCRETE]: 0,
  [Surface.PAVING]: 1,
  [Surface.GRAVEL]: 2,
  [Surface.UNPAVED]: 3,
  [Surface.GRASS]: 3,
};

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
  private readonly linear = new Map<number, THREE.Color>();
  private readonly surfaceColours: Readonly<Record<Surface, number>>;

  constructor(
    roads: Pick<RoadNetwork, 'lines'>,
    heightfield: Pick<Heightfield, 'heightAt'>,
    { asphalt, surfaceColours, centreLineColour, heightOf, skip }: RoadRibbonOptions,
  ) {
    this.surfaceColours = surfaceColours;
    const positions: number[][] = Array.from({ length: CENTRE_LINE + 1 }, () => []);
    const colours: number[][] = Array.from({ length: CENTRE_LINE }, () => []);
    // each ribbon vertex's distance along its road (m), for the fades; filled by ribbon() when asked
    let arcs: number[] | null = null;
    const ribbon = (ri: number, out: number[], points: Point[], width: number, lift: number) => {
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
          arcs?.push(before, along, along, before, along, before); // pl, l, r, pl, r, pr
        }
        pl = l;
        pr = r;
        before = along;
      }
      return along;
    };
    const surfaces = roads.lines.map(r => surfaceOf(r));
    const atNode = new Map<string, number[]>();
    roads.lines.forEach((r, ri) => {
      if (skip?.(ri)) return;
      for (const p of r.p) {
        const k = nodeKey(p);
        const list = atNode.get(k);
        if (!list) atNode.set(k, [ri]);
        else if (!list.includes(ri)) list.push(ri);
      }
    });
    // the hardest surface of another road at point p, if it's harder than road ri's: what ri fades in from there
    const fadeFrom = (ri: number, p: Point) => {
      let from: Surface | null = null;
      for (const o of atNode.get(nodeKey(p)) ?? [])
        if (SOFTNESS[surfaces[o]] < SOFTNESS[from ?? surfaces[ri]]) from = surfaces[o];
      return from === null ? null : this.surfaceColour(from);
    };
    const _c = new THREE.Color();
    roads.lines.forEach((r, ri) => {
      if (skip?.(ri)) return;
      const out = positions[r.c],
        own = this.surfaceColour(surfaces[ri]),
        start = fadeFrom(ri, r.p[0]),
        end = fadeFrom(ri, r.p[r.p.length - 1]);
      arcs = start || end ? [] : null;
      const length = ribbon(ri, out, r.p, ROAD_WIDTH_M[r.c], roadLiftM(r.c));
      const n = (out.length - colours[r.c].length) / 3;
      for (let k = 0; k < n; k++) {
        _c.copy(own);
        if (arcs && start) _c.lerpColors(start, _c, Math.min(1, arcs[k] / SURFACE_BLEND_M));
        if (arcs && end) _c.lerpColors(end, _c, Math.min(1, (length - arcs[k]) / SURFACE_BLEND_M));
        colours[r.c].push(_c.r, _c.g, _c.b);
      }
      arcs = null;
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

  /** A surface's linear colour, as the ribbons' `color` attribute holds it, for patches drawn with their materials. */
  surfaceColour(surface: Surface): THREE.Color {
    let c = this.linear.get(surface);
    if (!c) {
      c = new THREE.Color(this.surfaceColours[surface]).convertSRGBToLinear();
      this.linear.set(surface, c);
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

/** UVs from world x and z, TILE_M to a tile, for flat [x, y, z, ...] positions. */
export function worldUv(positions: ArrayLike<number>, offsetX = 0, offsetZ = 0) {
  const uv = new Float32Array((positions.length / 3) * 2);
  for (let i = 0, j = 0; i < positions.length; i += 3, j += 2) {
    uv[j] = (positions[i] + offsetX) / TILE_M;
    uv[j + 1] = (positions[i + 2] + offsetZ) / TILE_M;
  }
  return uv;
}
