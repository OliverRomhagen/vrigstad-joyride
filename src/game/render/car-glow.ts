// A soft glow round the cars' lit lamps in the dark (#304 §4.4): one THREE.Points for every car, additive and untone-
// mapped, so headlights and tail lights read from afar at dusk and in the night skip. By day it draws nothing.
import * as THREE from 'three';
import type { Car } from '../cars';
import type { LampState } from '../lighting';
import type { RenderedCar } from './car-meshes';

/** at most this many glowing lamps at once: four a car, so 64 cars */
const GLOW_MAX = 256;
/** cars further than this from the camera's focus (m) don't glow */
const GLOW_RANGE_M = 250;
/** a glow's size (m), shrinking with distance */
const GLOW_SIZE_M = 1.4;
/** lamps sit this high over the car's ground (m), and this far in from its sides */
const LAMP_Y_M = 0.72,
  LAMP_IN_M = 0.3;
// linear colours, scaled by how dark it is: headlights warm halogen, tails half a brake light
const HEAD = new THREE.Color(0xffe7c2).convertSRGBToLinear(),
  BRAKE = new THREE.Color(0xff2418).convertSRGBToLinear(),
  TAIL = BRAKE.clone().multiplyScalar(0.45),
  REVERSE = new THREE.Color(0xfff8f0).convertSRGBToLinear(),
  HAZARD = new THREE.Color(0xff9a1f).convertSRGBToLinear();

export interface CarGlowDeps {
  scene: THREE.Scene;
  /** for the glow's soft dot, drawn once on a canvas */
  doc: Pick<Document, 'createElement'>;
}

export class CarGlow {
  /** how many lamps glowed in the last update: the test hook's `lights.glow` */
  count = 0;
  private readonly points: THREE.Points;
  private readonly position = new Float32Array(GLOW_MAX * 3);
  private readonly colour = new Float32Array(GLOW_MAX * 3);
  private readonly texture: THREE.CanvasTexture;

  constructor({ scene, doc }: CarGlowDeps) {
    const cv = doc.createElement('canvas');
    cv.width = cv.height = 64;
    const x = cv.getContext('2d');
    if (x) {
      const g = x.createRadialGradient(32, 32, 0, 32, 32, 32);
      g.addColorStop(0, 'rgba(255,255,255,1)');
      g.addColorStop(0.25, 'rgba(255,255,255,.55)');
      g.addColorStop(1, 'rgba(255,255,255,0)');
      x.fillStyle = g;
      x.fillRect(0, 0, 64, 64);
    }
    this.texture = new THREE.CanvasTexture(cv);
    const geometry = new THREE.BufferGeometry();
    geometry.setAttribute('position', new THREE.BufferAttribute(this.position, 3).setUsage(THREE.DynamicDrawUsage));
    geometry.setAttribute('color', new THREE.BufferAttribute(this.colour, 3).setUsage(THREE.DynamicDrawUsage));
    geometry.setDrawRange(0, 0);
    this.points = new THREE.Points(
      geometry,
      new THREE.PointsMaterial({
        size: GLOW_SIZE_M,
        map: this.texture,
        vertexColors: true,
        transparent: true,
        depthWrite: false,
        blending: THREE.AdditiveBlending,
        toneMapped: false,
      }),
    );
    this.points.frustumCulled = false; // its points move every frame; the bounding sphere would always be stale
    this.points.visible = false;
    this.points.renderOrder = 10; // over the cars and the road
    scene.add(this.points);
  }

  /** Once a frame: a glow at each lit lamp of every car near `focus`, scaled by `dark` (lightLevel's). */
  update(cars: readonly RenderedCar[], dark: number, lampsOf: (c: Car) => LampState, focus: { x: number; z: number }) {
    let n = 0;
    if (dark > 0)
      for (const c of cars) {
        if (n > GLOW_MAX - 4) break;
        if (Math.abs(c.x - focus.x) > GLOW_RANGE_M || Math.abs(c.z - focus.z) > GLOW_RANGE_M) continue;
        const s = lampsOf(c);
        this.fx = Math.sin(c.h);
        this.fz = -Math.cos(c.h);
        this.x = c.x;
        this.z = c.z;
        this.y = c.mesh.position.y + LAMP_Y_M;
        this.side = Math.max(0.2, c.T.widthM / 2 - LAMP_IN_M);
        const ahead = c.T.lengthM / 2;
        if (s.hazard) {
          n = this.pair(n, ahead, HAZARD, dark);
          n = this.pair(n, -ahead, HAZARD, dark);
          continue;
        }
        if (s.head > 0) n = this.pair(n, ahead, HEAD, dark * s.head);
        if (s.brake) n = this.pair(n, -ahead, BRAKE, dark);
        else if (s.reverse) n = this.pair(n, -ahead, REVERSE, dark);
        else if (s.rear > 0) n = this.pair(n, -ahead, TAIL, dark);
      }
    this.count = n;
    const g = this.points.geometry;
    g.setDrawRange(0, n);
    if (n) {
      g.getAttribute('position').needsUpdate = true;
      g.getAttribute('color').needsUpdate = true;
    }
    this.points.visible = n > 0;
  }

  // the car being lit: where it is, which way it points and how far its lamps sit out from its middle; scratch, not allocated
  private x = 0;
  private z = 0;
  private y = 0;
  private fx = 0;
  private fz = 0;
  private side = 0;
  /** Writes the left and right lamp at `along` m ahead of the car's middle, from point n on; returns the next free point. */
  private pair(n: number, along: number, col: THREE.Color, k: number) {
    for (let sgn = -1; sgn <= 1; sgn += 2) {
      const i = n * 3;
      this.position[i] = this.x + this.fx * along - this.fz * this.side * sgn;
      this.position[i + 1] = this.y;
      this.position[i + 2] = this.z + this.fz * along + this.fx * this.side * sgn;
      this.colour[i] = col.r * k;
      this.colour[i + 1] = col.g * k;
      this.colour[i + 2] = col.b * k;
      n++;
    }
    return n;
  }

  dispose() {
    this.points.removeFromParent();
    this.points.geometry.dispose();
    (this.points.material as THREE.Material).dispose();
    this.texture.dispose();
  }
}
