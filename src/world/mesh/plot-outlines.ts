import '../three-legacy';
import * as THREE from 'three';
import type { Plot } from '../plots';
import { SOURCE_TINTS } from './sidewalk-mesh';

/** the plots' outlines, sRGB, a blue that stands out from grass and walls; driveways take the source tints, mapped green and inferred red */
const PLOT_COLOUR = 0x2f6bff;
/** the lines float this far above the ground (m), so the terrain doesn't swallow them */
const LIFT_M = 0.25;
/** a line is cut into pieces at most this long (m), each end on the ground, so it follows the terrain */
const PIECE_M = 2;

/**
 * The ?debug=plots view: every plot's outline and its driveway's edges, as lines draped over the ground. Adds nothing
 * to a scene; dispose() frees its geometry and material.
 */
export class PlotOutlines {
  readonly mesh: THREE.LineSegments;

  constructor(plots: readonly Plot[], groundAt: (x: number, z: number) => number) {
    const positions: number[] = [];
    const colours: number[] = [];
    const add = (ring: readonly number[], srgb: number) => {
      const c = new THREE.Color(srgb).convertSRGBToLinear();
      for (let i = 0; i < ring.length; i += 2) {
        const [ax, az] = [ring[i], ring[i + 1]];
        const [bx, bz] = [ring[(i + 2) % ring.length], ring[(i + 3) % ring.length]];
        const n = Math.max(1, Math.ceil(Math.hypot(bx - ax, bz - az) / PIECE_M));
        for (let k = 0; k < n; k++)
          for (const t of [k / n, (k + 1) / n]) {
            const x = ax + (bx - ax) * t;
            const z = az + (bz - az) * t;
            positions.push(x, groundAt(x, z) + LIFT_M, z);
            colours.push(c.r, c.g, c.b);
          }
      }
    };
    for (const p of plots) {
      add(p.outline, PLOT_COLOUR);
      const d = p.driveway;
      if (!d) continue;
      // each piece of the centre line as a rectangle its width wide
      for (let i = 2; i < d.p.length; i += 2) {
        const [ax, az, bx, bz] = [d.p[i - 2], d.p[i - 1], d.p[i], d.p[i + 1]];
        const length = Math.hypot(bx - ax, bz - az) || 1;
        const nx = (-(bz - az) / length) * (d.widthM / 2);
        const nz = ((bx - ax) / length) * (d.widthM / 2);
        const tint = SOURCE_TINTS[d.source === 'mapped' ? 0 : 2];
        add([ax + nx, az + nz, bx + nx, bz + nz, bx - nx, bz - nz, ax - nx, az - nz], tint);
      }
    }
    const geometry = new THREE.BufferGeometry();
    geometry.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3));
    geometry.setAttribute('color', new THREE.Float32BufferAttribute(colours, 3));
    this.mesh = new THREE.LineSegments(geometry, new THREE.LineBasicMaterial({ vertexColors: true }));
    this.mesh.userData.keepMaterial = true; // a debug view: the cel-shaded style (#206) leaves its colours alone
  }

  dispose() {
    this.mesh.geometry.dispose();
    (this.mesh.material as THREE.Material).dispose();
  }
}
