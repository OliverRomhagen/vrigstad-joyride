import '../three-legacy';
import * as THREE from 'three';
import { ROAD_WIDTH_M } from '../data';
import type { Heightfield } from '../heightfield';
import { type Point, type RoadNetwork, roadLiftM } from '../roads';

export interface RoadRibbonOptions {
  /** anisotropic filtering for the asphalt texture; the renderer's maximum */
  anisotropy: number;
}

/** sRGB colour of each road class's ribbon, then of the centre line */
const RIBBON_COLOURS = [0x4c4f52, 0x55585b, 0x606365, 0x74746d, 0xa08c6c, 0xbcae92, 0xe9e7da];
/** the last ribbon is the centre line, painted on primary and secondary roads */
const CENTRE_LINE = 6;
const CENTRE_LINE_WIDTH_M = 0.2;
const CENTRE_LINE_LIFT_M = 0.3;
/** ribbons are cut every this many metres so they follow the terrain (m) */
const STEP_M = 6;
/** the asphalt texture repeats every this many metres, across and along (m) */
const TILE_M = 4;

/**
 * The road ribbons drawn over the ground texture: one mesh per road class, plus the centre lines. Adds nothing to a
 * scene. `dispose()` frees everything it made.
 */
export class RoadRibbons {
  /** in draw order; classes with no roads have no mesh */
  readonly meshes: THREE.Mesh[] = [];
  private readonly speckle: THREE.CanvasTexture;

  constructor(roads: Pick<RoadNetwork, 'lines'>, heightfield: Pick<Heightfield, 'heightAt'>, { anisotropy }: RoadRibbonOptions) {
    const positions: number[][] = RIBBON_COLOURS.map(() => []);
    const uvs: number[][] = RIBBON_COLOURS.map(() => []);
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

    this.speckle = asphaltSpeckle();
    this.speckle.anisotropy = anisotropy;
    positions.forEach((p, i) => {
      if (!p.length) return;
      const g = new THREE.BufferGeometry();
      g.setAttribute('position', new THREE.Float32BufferAttribute(p, 3));
      g.setAttribute('uv', new THREE.Float32BufferAttribute(uvs[i], 2));
      g.computeVertexNormals();
      // minor roads are drawn first and pushed furthest back, so a junction shows the bigger road on top
      const order = i === CENTRE_LINE ? 8 : 6 - i;
      const material = new THREE.MeshLambertMaterial({
        color: new THREE.Color(RIBBON_COLOURS[i]).convertSRGBToLinear(),
        map: i < CENTRE_LINE ? this.speckle : null,
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
    this.speckle.dispose();
  }
}

/** A light, speckled tile that the ribbon colours tint, so asphalt and gravel aren't flat. */
function asphaltSpeckle() {
  const cv = document.createElement('canvas');
  cv.width = cv.height = 256;
  const x = cv.getContext('2d') as CanvasRenderingContext2D;
  // its own generator, so the look doesn't shift the seeded rnd() sequence
  let seed = 11;
  const next = () => (seed = (seed * 48271) % 2147483647) / 2147483647;
  x.fillStyle = '#f7f7f7';
  x.fillRect(0, 0, 256, 256);
  x.globalAlpha = 0.7;
  for (const c of ['#ffffff', '#cdcdcd', '#dedede']) {
    x.fillStyle = c;
    for (let i = 0; i < 1600; i++) x.fillRect(next() * 256, next() * 256, 1, 1);
  }
  const texture = new THREE.CanvasTexture(cv);
  texture.wrapS = texture.wrapT = THREE.RepeatWrapping;
  texture.colorSpace = THREE.SRGBColorSpace;
  return texture;
}
