// What Plåt-Pelle's parts look like on a car (#3, the `garage` lab experiment): paint, rims and neon underglow.
// The underglow is a soft pool of colour added onto the ground, not a light: a new light would recompile every
// material, and the added colour lights the road the way a glow does, most of all at night.
import * as THREE from 'three';
import { type CarMods, GLOWS, PAINTS, RIMS } from '../sim/car-mods';
import type { CarType } from '../sim/vehicle-spec';
import type { RenderedCar } from './car-meshes';
import type { VehicleVisuals } from './vehicle-visuals';

const GLOW_PAD_M = 1.1; // how far past the body the glow reaches, on every side
const GLOW_Y_M = 0.05; // over the ground, under the car
const GLOW_DAY = 0.45, // the glow's strength in full sun, and at night
  GLOW_NIGHT = 1;

/** What the parts read from the rest of the game. */
export interface CarModsMeshesDeps {
  vehicleVisuals: Pick<VehicleVisuals, 'paint' | 'rims'>;
  carGeo(type: CarType, color: string): THREE.BufferGeometry; // the procedural body, cached by type and colour
}

/** Puts a car's mods on its meshes. */
export class CarModsMeshes {
  private readonly g: CarModsMeshesDeps;
  private readonly glowGeo = new THREE.PlaneGeometry(1, 1).rotateX(-Math.PI / 2);
  private readonly glowTex = glowTexture();
  private readonly glowMats = new Map<string, THREE.MeshBasicMaterial>(); // one per colour
  private readonly glows = new WeakMap<RenderedCar, THREE.Mesh>();

  constructor(g: CarModsMeshesDeps) {
    this.g = g;
  }

  /** Shows these parts on the car: by default its own; in the garage, perhaps with one being tried on. */
  apply(c: RenderedCar, mods: CarMods = c.mods ?? {}) {
    const { vehicleVisuals, carGeo } = this.g,
      paint = mods.paint && PAINTS[mods.paint],
      color = paint ? paint.hex : c.color;
    c.body.geometry = carGeo(c.type, color); // the procedural body, which shows until the model loads and far away
    vehicleVisuals.paint(c, color, !!paint && paint.metallic);
    vehicleVisuals.rims(c, mods.rims ? RIMS[mods.rims] : null);
    this.glow(c, mods.glow ? GLOWS[mods.glow].hex : null);
  }

  private glow(c: RenderedCar, hex: string | null) {
    let mesh = this.glows.get(c);
    if (!hex) {
      mesh?.removeFromParent();
      this.glows.delete(c);
      return;
    }
    if (!mesh) {
      mesh = new THREE.Mesh(this.glowGeo);
      mesh.scale.set(c.T.widthM + GLOW_PAD_M * 2, 1, c.T.lengthM + GLOW_PAD_M * 2);
      mesh.position.y = GLOW_Y_M;
      mesh.renderOrder = 1; // after the road it lies on
      c.mesh.add(mesh); // the placed car, not its sprung body: the glow stays flat on the road when the body rolls
      this.glows.set(c, mesh);
    }
    mesh.material = this.material(hex);
  }

  private material(hex: string) {
    let m = this.glowMats.get(hex);
    if (!m) {
      m = new THREE.MeshBasicMaterial({
        map: this.glowTex,
        color: new THREE.Color(hex).convertSRGBToLinear(),
        transparent: true,
        blending: THREE.AdditiveBlending,
        depthWrite: false,
        polygonOffset: true, // drawn over the road ribbon it lies a few cm above
        polygonOffsetFactor: -2,
        polygonOffsetUnits: -2,
        opacity: GLOW_DAY,
      });
      this.glowMats.set(hex, m);
    }
    return m;
  }

  /** `sun` is the sun's share of its full strength (0 at night, 1 at noon): the glow shows most in the dark. */
  update(sun: number) {
    const k = GLOW_NIGHT + (GLOW_DAY - GLOW_NIGHT) * Math.min(1, Math.max(0, sun));
    for (const m of this.glowMats.values()) m.opacity = k;
  }
}

// a white pool, strongest in the middle and fading out to its edges; the material colours it
function glowTexture() {
  const size = 64,
    canvas = document.createElement('canvas');
  canvas.width = canvas.height = size;
  const ctx = canvas.getContext('2d')!,
    grad = ctx.createRadialGradient(size / 2, size / 2, 0, size / 2, size / 2, size / 2);
  grad.addColorStop(0, 'rgba(255,255,255,0.9)');
  grad.addColorStop(0.55, 'rgba(255,255,255,0.45)');
  grad.addColorStop(1, 'rgba(255,255,255,0)');
  ctx.fillStyle = grad;
  ctx.fillRect(0, 0, size, size);
  return new THREE.CanvasTexture(canvas);
}
