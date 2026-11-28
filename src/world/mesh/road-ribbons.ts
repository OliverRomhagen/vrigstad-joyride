import '../three-legacy';
import * as THREE from 'three';
import { ROAD_WIDTH_M, type RoadClass, Surface, surfaceOf } from '../data';
import type { Heightfield } from '../heightfield';
import { resample, ribbonEdges, STEP_M } from '../polyline';
import { type Point, type RoadNetwork, roadLiftM } from '../roads';

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

/** how soft each surface is: the softer of two roads that meet sits lower, so the harder one draws on top */
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
    const ribbon = (ri: number, out: number[], points: Point[], width: number, lift: number) => {
      const onBridge = heightOf?.(ri, points[0][0], points[0][1], lift) !== undefined;
      const q = resample(points, onBridge ? BRIDGE_STEP_M : STEP_M);
      const y = (x: number, z: number) =>
        (onBridge ? heightOf?.(ri, x, z, lift) : undefined) ?? heightfield.heightAt(x, z) + lift;
      let pl: number[] = [];
      let pr: number[] = [];
      for (let i = 0; i < q.length; i++) {
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
        }
        pl = l;
        pr = r;
      }
    };
    roads.lines.forEach((r, ri) => {
      if (skip?.(ri)) return;
      const out = positions[r.c],
        from = out.length,
        surface = surfaceOf(r),
        c = this.linear(surface);
      ribbon(ri, out, r.p, ROAD_WIDTH_M[r.c], ribbonLiftM(r.c, surface));
      for (let k = from; k < out.length; k += 3) colours[r.c].push(c.r, c.g, c.b);
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

/** UVs from world x and z, TILE_M to a tile, for flat [x, y, z, ...] positions. */
export function worldUv(positions: ArrayLike<number>, offsetX = 0, offsetZ = 0) {
  const uv = new Float32Array((positions.length / 3) * 2);
  for (let i = 0, j = 0; i < positions.length; i += 3, j += 2) {
    uv[j] = (positions[i] + offsetX) / TILE_M;
    uv[j + 1] = (positions[i + 2] + offsetZ) / TILE_M;
  }
  return uv;
}
