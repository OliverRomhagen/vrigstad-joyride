import '../three-legacy';
import * as THREE from 'three';
import { ROAD_WIDTH_M, type RoadClass } from '../data';
import type { Heightfield } from '../heightfield';
import { type Point, type RoadNetwork, roadLiftM } from '../roads';

export interface RoadRibbonOptions {
  /** a light tile that the road colours tint, repeating every TILE_M across and along; it stays the caller's */
  asphalt: THREE.Texture;
  /** sRGB colour of each road class's ribbon, indexed by RoadClass; it tints the asphalt texture */
  roadColours: Readonly<Record<RoadClass, number>>;
  /** sRGB colour of the centre line */
  centreLineColour: number;
}

/** the last ribbon is the centre line, painted on primary and secondary roads */
const CENTRE_LINE = ROAD_WIDTH_M.length;
const CENTRE_LINE_WIDTH_M = 0.2;
const CENTRE_LINE_LIFT_M = 0.3;
/** ribbons are cut every this many metres so they follow the terrain (m) */
const STEP_M = 6;
/** the asphalt texture repeats every this many metres, across and along (m) */
const TILE_M = 4;

/**
 * The road ribbons drawn over the ground texture: one mesh per road class, plus the centre lines. Adds nothing to a
 * scene. `dispose()` frees the geometry and materials it made; the asphalt texture stays the caller's.
 */
export class RoadRibbons {
  /** in draw order; classes with no roads have no mesh */
  readonly meshes: THREE.Mesh[] = [];

  constructor(
    roads: Pick<RoadNetwork, 'lines'>,
    heightfield: Pick<Heightfield, 'heightAt'>,
    { asphalt, roadColours, centreLineColour }: RoadRibbonOptions,
  ) {
    const positions: number[][] = Array.from({ length: CENTRE_LINE + 1 }, () => []);
    const uvs: number[][] = Array.from({ length: CENTRE_LINE + 1 }, () => []);
    const ribbon = (out: number[], uvOut: number[], points: Point[], width: number, lift: number) => {
      const q: Point[] = [points[0]];
      for (let i = 1; i < points.length; i++) {
        const a = points[i - 1];
        const b = points[i];
        const steps = Math.max(1, Math.ceil(Math.hypot(b[0] - a[0], b[1] - a[1]) / STEP_M));
        for (let s = 1; s <= steps; s++) q.push([a[0] + ((b[0] - a[0]) * s) / steps, a[1] + ((b[1] - a[1]) * s) / steps]);
      }
      let pl: number[] = [];
      let pr: number[] = [];
      let v = 0;
      let pv = 0;
      const u = width / TILE_M;
      for (let i = 0; i < q.length; i++) {
        const a = q[Math.max(0, i - 1)];
        const b = q[Math.min(q.length - 1, i + 1)];
        let dx = b[0] - a[0];
        let dz = b[1] - a[1];
        const length = Math.hypot(dx, dz) || 1;
        dx /= length;
        dz /= length;
        const nx = (-dz * width) / 2;
        const nz = (dx * width) / 2;
        const l = [q[i][0] - nx, 0, q[i][1] - nz];
        const r = [q[i][0] + nx, 0, q[i][1] + nz];
        l[1] = heightfield.heightAt(l[0], l[2]) + lift;
        r[1] = heightfield.heightAt(r[0], r[2]) + lift;
        if (i > 0) {
          v += Math.hypot(q[i][0] - q[i - 1][0], q[i][1] - q[i - 1][1]) / TILE_M;
          out.push(pl[0], pl[1], pl[2], l[0], l[1], l[2], r[0], r[1], r[2], pl[0], pl[1], pl[2], r[0], r[1], r[2], pr[0], pr[1], pr[2]);
          uvOut.push(0, pv, 0, v, u, v, 0, pv, u, v, u, pv);
        }
        pl = l;
        pr = r;
        pv = v;
      }
    };
    for (const r of roads.lines) {
      ribbon(positions[r.c], uvs[r.c], r.p, ROAD_WIDTH_M[r.c], roadLiftM(r.c));
      if (r.c < 2) ribbon(positions[CENTRE_LINE], uvs[CENTRE_LINE], r.p, CENTRE_LINE_WIDTH_M, CENTRE_LINE_LIFT_M);
    }

    positions.forEach((p, i) => {
      if (!p.length) return;
      const g = new THREE.BufferGeometry();
      g.setAttribute('position', new THREE.Float32BufferAttribute(p, 3));
      g.setAttribute('uv', new THREE.Float32BufferAttribute(uvs[i], 2));
      g.computeVertexNormals();
      // minor roads are drawn first and pushed furthest back, so a junction shows the bigger road on top
      const order = i === CENTRE_LINE ? 8 : 6 - i;
      const material = new THREE.MeshLambertMaterial({
        color: new THREE.Color(i < CENTRE_LINE ? roadColours[i as RoadClass] : centreLineColour).convertSRGBToLinear(),
        map: i < CENTRE_LINE ? asphalt : null,
        side: THREE.DoubleSide,
        polygonOffset: true,
        polygonOffsetFactor: -2,
        polygonOffsetUnits: -4 * order,
      });
      const mesh = new THREE.Mesh(g, material);
      mesh.receiveShadow = true;
      mesh.renderOrder = order;
      this.meshes.push(mesh);
    });
  }

  dispose() {
    for (const mesh of this.meshes) {
      mesh.geometry.dispose();
      (mesh.material as THREE.Material).dispose();
    }
  }
}

