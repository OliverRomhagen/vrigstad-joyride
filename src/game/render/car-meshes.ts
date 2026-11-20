// What a car looks like: its procedural body, the police light bar, a model when it has one, all placed on the ground.
// Moved from src/game/main.ts (#177); main.ts passes in the models and what the meshes read from the rest of the game.
import * as THREE from 'three';
import { makeRnd } from '../../world/random';
import type { Car, CarMode } from '../cars';
import { type CarType, specFor } from '../sim/vehicle-spec';
import type { BodyMotion } from './body-motion';
import { pickVariant, type VehicleId, vehicleDefinition } from './vehicle-registry';
import type { VehicleVisuals } from './vehicle-visuals';

const _f = new THREE.Vector3(),
  _r = new THREE.Vector3(),
  _m = new THREE.Matrix4();

/** A car with its meshes: `mesh` is placed on the ground, and `body`, the procedural one, rolls on its springs inside it. */
export interface RenderedCar extends Car {
  mesh: THREE.Group;
  body: THREE.Mesh;
}

/** What the car meshes read from the rest of the game. `cars` is a getter, so main.ts can declare the fleet later. */
export interface CarMeshesDeps {
  scene: THREE.Scene;
  groundAt: (x: number, z: number) => number;
  normalAt: (x: number, z: number) => THREE.Vector3;
  pick: <T>(a: readonly T[]) => T; // the game's seeded stream: a car's colour is a world roll
  carGeo: (type: CarType, color: string) => THREE.BufferGeometry; // the procedural body, cached by type and colour
  carMat: THREE.Material;
  blob: (parent: THREE.Object3D, w: number, l: number) => THREE.Mesh; // the soft shadow under it
  barGeo: THREE.BufferGeometry; // the police light bar; main.ts blinks barMat
  barMat: THREE.Material;
  vehicleVisuals: VehicleVisuals;
  bodyMotion: BodyMotion;
  readonly cars: RenderedCar[];
}

/** Makes, places and removes the meshes of every car. */
export class CarMeshes {
  private readonly g: CarMeshesDeps;
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
    vehicleVisuals.sync(c);
  }
  addCar(
    type: CarType,
    x: number,
    z: number,
    h: number,
    mode: CarMode,
    assetId: VehicleId | undefined = pickVariant(type, this.modelRnd()),
  ) {
    const { scene, pick, carGeo, carMat, blob, barGeo, barMat, vehicleVisuals, bodyMotion, cars } = this.g;
    const T = specFor(type, vehicleDefinition(assetId ?? null)),
      color = pick(T.cols),
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
    const c: RenderedCar = {
      type,
      T,
      mesh,
      x,
      z,
      h,
      vh: h,
      v: 0,
      st: 0,
      thr: 0,
      slip: 0,
      drift: 0,
      charge: 0,
      yr: 0,
      spin: 0,
      loose: 0,
      flickDir: 0,
      flickT: 9,
      flickHeld: 0,
      boost: 0,
      mode,
      wet: false,
      owned: false,
      blocked: 0,
      ghost: 0,
      stuck: 0,
      rev: 0,
      revSteer: 1,
      dmg: 0,
      hitAt: -9,
      body: fallback,
    };
    scene.add(mesh);
    cars.push(c);
    this.placeCar(c);
    bodyMotion.add(c, T.suspension, fallback);
    if (assetId) {
      vehicleVisuals.attach(c, assetId, fallback, color);
    }
    return c;
  }
  removeCar(c: RenderedCar) {
    const { scene, vehicleVisuals, bodyMotion, cars } = this.g;
    vehicleVisuals.dispose(c);
    bodyMotion.remove(c);
    scene.remove(c.mesh);
    const i = cars.indexOf(c);
    if (i >= 0) cars.splice(i, 1);
  }
}
