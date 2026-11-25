// What a car looks like: its procedural body, the police light bar, a model when it has one, all placed on the ground.
// Moved from src/game/main.ts (#177); main.ts passes in the models and what the meshes read from the rest of the game.
import * as THREE from 'three';
import { makeRnd } from '../../world/random';
import type { Car } from '../cars';
import type { Decal } from '../sim/paint-jobs';
import type { CarType } from '../sim/vehicle-spec';
import type { BodyMotion } from './body-motion';
import { INK_FLAG } from './ink-flag';
import { carShellGeo } from './models';
import { decalMeshes, disposeDecal } from './paint-decals';
import { pickVariant, type VehicleId } from './vehicle-registry';
import type { VehicleVisuals } from './vehicle-visuals';

const _f = new THREE.Vector3(),
  _r = new THREE.Vector3(),
  _m = new THREE.Matrix4();
const IDENTITY = new THREE.Matrix4(); // the procedural shell is already in the body's frame

/** A car with its meshes: `mesh` is placed on the ground, and `body`, the procedural one, rolls on its springs inside it. */
export interface RenderedCar extends Car {
  mesh: THREE.Group;
  body: THREE.Mesh;
}

// the paint and decal a car's meshes wear, and the decal's meshes on its procedural body: a respray or a decal changes the car's,
// and placeCar catches up. Render's own bookkeeping, kept here rather than on the sim's car.
type Look = { paint: string; decal: Decal | null; meshes: THREE.Mesh[] };

/** What the car meshes read from the rest of the game. */
export interface CarMeshesDeps {
  scene: THREE.Scene;
  groundAt: (x: number, z: number) => number;
  normalAt: (x: number, z: number) => THREE.Vector3;
  carGeo: (type: CarType, color: string) => THREE.BufferGeometry; // the procedural body, cached by type and colour
  carMat: THREE.Material;
  blob: (parent: THREE.Object3D, w: number, l: number) => THREE.Mesh; // the soft shadow under it
  barGeo: THREE.BufferGeometry; // the police light bar; loop.ts blinks barMat
  barMat: THREE.Material;
  vehicleVisuals: VehicleVisuals;
  bodyMotion: BodyMotion;
}

/** Makes, places and disposes the meshes of every car. It never adds a car to the list or removes one: the Fleet does (#297). */
export class CarMeshes {
  private readonly g: CarMeshesDeps;
  private readonly looks = new Map<Car, Look>();
  private readonly modelRnd = makeRnd(240); // own stream: which model a car wears doesn't shift the world's rolls

  constructor(g: CarMeshesDeps) {
    this.g = g;
  }

  placeCar(c: RenderedCar) {
    const { groundAt, normalAt, vehicleVisuals } = this.g;
    const n = normalAt(c.x, c.z);
    _f.set(Math.sin(c.h), 0, -Math.cos(c.h));
    _f.addScaledVector(n, -_f.dot(n)).normalize();
    _r.crossVectors(_f, n);
    _m.makeBasis(_r, n, _f.negate());
    c.mesh.quaternion.setFromRotationMatrix(_m);
    c.mesh.position.set(c.x, groundAt(c.x, c.z) - (c.wet ? 0.55 : 0), c.z);
    const look = this.looks.get(c);
    if (look && (look.paint !== c.color || look.decal !== c.decal)) this.repaint(c, look);
    vehicleVisuals.sync(c);
  }
  // a respray: the procedural body's geometry carries its paint (cached by type and colour, so the old one isn't disposed), the model its materials
  // the decal is projected onto the procedural body's painted shell, and hung on it, so it rolls with it; the model gets its own
  // only the stripes take their colour from the paint, so a respray leaves any other decal as it is
  private repaint(c: RenderedCar, look: Look) {
    const { carGeo, vehicleVisuals } = this.g,
      recolour = look.paint !== c.color,
      redecal = look.decal !== c.decal || (recolour && c.decal === 'stripes');
    if (recolour) {
      c.body.geometry = carGeo(c.type, c.color);
      vehicleVisuals.paint(c, c.color);
    }
    if (redecal) {
      disposeDecal(look.meshes);
      const shell = c.decal && carShellGeo(c.type);
      look.meshes = shell ? decalMeshes(c.decal!, c.color, [{ geometry: shell, toFrame: IDENTITY }]) : [];
      for (const m of look.meshes) c.body.add(m);
      vehicleVisuals.decorate(c, c.decal, c.color);
    }
    look.paint = c.color;
    look.decal = c.decal;
  }
  /** Which model a new car of this type wears, if one: rolled from the meshes' own stream. */
  pickModel(type: CarType): VehicleId | undefined {
    return pickVariant(type, this.modelRnd());
  }
  /** Gives a new car its meshes, before the Fleet holds it: the procedural body, the police light bar, and its model if `assetId` names one. */
  attach(car: Car, assetId: VehicleId | undefined): RenderedCar {
    const { scene, carGeo, carMat, blob, barGeo, barMat, vehicleVisuals, bodyMotion } = this.g;
    const { type, T, color } = car,
      fallback = new THREE.Mesh(carGeo(type, color), carMat),
      mesh = new THREE.Group();
    fallback.castShadow = true;
    mesh.add(fallback);
    blob(mesh, 2.8, 5.8); // the fallback sits apart from the blob, so it can roll on its springs
    if (type === 'polis') {
      const bar = new THREE.Mesh(barGeo, barMat);
      bar.position.set(0, 1.62, 0.2);
      fallback.add(bar);
    }
    mesh.userData[INK_FLAG] = true; // the toon style inks the cars' creases, like the art direction lab
    const c = Object.assign(car, { mesh, body: fallback });
    scene.add(mesh);
    this.looks.set(c, { paint: color, decal: null, meshes: [] });
    bodyMotion.add(c, T.suspension, fallback);
    if (assetId) vehicleVisuals.attach(c, assetId, fallback, color); // before placeCar, so a car that comes with a decal hands it to its model too
    this.placeCar(c);
    return c;
  }
  /** Disposes a car's meshes; the Fleet takes the car itself out of the list. */
  detach(c: RenderedCar) {
    const { scene, vehicleVisuals, bodyMotion } = this.g;
    vehicleVisuals.dispose(c);
    disposeDecal(this.looks.get(c)?.meshes ?? []);
    this.looks.delete(c);
    bodyMotion.remove(c);
    scene.remove(c.mesh);
  }
}
