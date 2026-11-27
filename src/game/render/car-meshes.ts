// What a car looks like: its procedural body, the police light bar, a model when it has one, all placed on the ground.
// Moved from src/game/main.ts (#177); main.ts passes in the models and what the meshes read from the rest of the game.
import * as THREE from 'three';
import { makeRnd } from '../../world/random';
import { col } from '../../world/three-legacy';
import type { Car } from '../cars';
import type { LampState } from '../lighting';
import type { CarType } from '../sim/vehicle-spec';
import type { BodyMotion } from './body-motion';
import { INK_FLAG } from './ink-flag';
import { pickVariant, type VehicleId } from './vehicle-registry';
import type { VehicleVisuals } from './vehicle-visuals';

// lit lamps on the procedural body (#304), shared by every car: braking, backing up, a wreck's hazards, and head and tail
// lights in the dark. Untone-mapped, as the models' lit lamps are, so a brake light stays red rather than bleaching pink.
const litLamp = (srgb: number) => new THREE.MeshBasicMaterial({ color: col(srgb), toneMapped: false }),
  BRAKE_LAMP = litLamp(0xff2418),
  TAIL_LAMP = litLamp(0x9c0d10),
  REVERSE_LAMP = litLamp(0xfff8f0),
  HAZARD_LAMP = litLamp(0xff9a1f),
  HEAD_LAMP = litLamp(0xffe7c2);
/** What a procedural car's rear lamps show over their baked colour: by day nothing unless braking, backing or wrecked. */
function rearLook(s: LampState) {
  return s.hazard ? HAZARD_LAMP : s.brake ? BRAKE_LAMP : s.reverse ? REVERSE_LAMP : s.head >= 0.5 ? TAIL_LAMP : null;
}
/** Its headlamps: lit only in the dark (lampState's full beam); by day the baked cream reads as dipped lights. */
function headLook(s: LampState) {
  return s.head >= 0.5 ? HEAD_LAMP : s.hazard ? HAZARD_LAMP : null;
}

const _f = new THREE.Vector3(),
  _r = new THREE.Vector3(),
  _m = new THREE.Matrix4();

/** A car with its meshes: `mesh` is placed on the ground, and `body`, the procedural one, rolls on its springs inside it. */
export interface RenderedCar extends Car {
  mesh: THREE.Group;
  body: THREE.Mesh;
}

// the paint a car's meshes wear: a respray changes the car's, and placeCar catches up. Render's own bookkeeping, kept here
// rather than on the sim's car.
type Look = { paint: string };

/** What the car meshes read from the rest of the game. */
export interface CarMeshesDeps {
  scene: THREE.Scene;
  groundAt: (x: number, z: number) => number;
  normalAt: (x: number, z: number) => THREE.Vector3;
  carGeo: (type: CarType, color: string) => THREE.BufferGeometry; // the procedural body, cached by type and colour
  lampGeo: (type: CarType, end: 1 | -1) => THREE.BufferGeometry | null; // its rear (1) or head (-1) lamps, to light over it; null when it has none
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
  // each procedural car's lit rear and head lamps, each made the first time it lights: a parked car never gets one, and a
  // hidden one costs no draw call, so only cars braking, backing, wrecked or driving in the dark pay one
  private readonly rearLamps = new Map<Car, THREE.Mesh>();
  private readonly headLamps = new Map<Car, THREE.Mesh>();

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
    if (look && look.paint !== c.color) this.repaint(c, look);
    vehicleVisuals.sync(c);
  }
  // a respray: the procedural body's geometry carries its paint (cached by type and colour, so the old one isn't disposed), the model its materials
  private repaint(c: RenderedCar, look: Look) {
    const { carGeo, vehicleVisuals } = this.g;
    look.paint = c.color;
    c.body.geometry = carGeo(c.type, c.color);
    vehicleVisuals.paint(c, c.color);
  }
  /**
   * Lights the procedural cars' rear lamps from what `lampsOf` says (lighting.ts), once a frame. A car showing its model
   * lights the model's lamps instead (VehicleVisuals).
   */
  updateLamps(cars: readonly RenderedCar[], lampsOf: (c: Car) => LampState) {
    for (const c of cars) {
      const s = c.body.visible ? lampsOf(c) : null;
      this.light(c, this.rearLamps, 1, s && rearLook(s));
      this.light(c, this.headLamps, -1, s && headLook(s));
    }
  }
  private light(c: RenderedCar, lamps: Map<Car, THREE.Mesh>, end: 1 | -1, look: THREE.Material | null) {
    let lamp = lamps.get(c);
    if (!look) {
      if (lamp) lamp.visible = false;
      return;
    }
    if (!lamp) {
      const geo = this.g.lampGeo(c.type, end);
      if (!geo) return;
      lamp = new THREE.Mesh(geo, look);
      c.body.add(lamp); // on the sprung body, so it rolls and pitches with it
      lamps.set(c, lamp);
    }
    lamp.material = look;
    lamp.visible = true;
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
    this.looks.set(c, { paint: color });
    scene.add(mesh);
    this.placeCar(c);
    bodyMotion.add(c, T.suspension, fallback);
    if (assetId) {
      vehicleVisuals.attach(c, assetId, fallback, color);
    }
    return c;
  }
  /** Disposes a car's meshes; the Fleet takes the car itself out of the list. */
  detach(c: RenderedCar) {
    const { scene, vehicleVisuals, bodyMotion } = this.g;
    vehicleVisuals.dispose(c);
    this.looks.delete(c);
    this.rearLamps.delete(c); // its meshes go with the car's; the geometry and materials are shared
    this.headLamps.delete(c);
    bodyMotion.remove(c);
    scene.remove(c.mesh);
  }
}
