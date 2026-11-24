// The lab garage's showroom (#3, ?lab=garage): while the garage is open, the camera sees only its own layer, which holds a dark
// round room with a turntable, the car on the lift and the lights. Everything else (the workshop, the lot, the sky) stays on
// layer 0, out of the picture, so the car stands alone. Dragging turns the car's model and the plate, not the car itself.
import * as THREE from 'three';
import { SHOWROOM_LAYER } from './camera-rig';

const ROOM_R_M = 11, // takes in the camera, which stands about 7 m off the car
  ROOM_H_M = 7,
  PLATE_R_M = 3.1, // a Volvo 240 is 4.8 m long
  PLATE_TOP_M = 0.012, // just over the floor, so the wheels stand on it
  MARKS = 16; // studs round the plate's rim, which show it turn

/** What the showroom draws into. */
export interface ShowroomDeps {
  scene: THREE.Scene;
  groundAt(x: number, z: number): number;
}

/** The showroom round the car on the lift; `update` shows it, puts it under the car, and turns the plate with it. */
export class Showroom {
  private readonly g: ShowroomDeps;
  private readonly room = new THREE.Group();
  private readonly plate = new THREE.Group();
  private car: THREE.Object3D | null = null; // the car mesh on the showroom's layer

  constructor(g: ShowroomDeps) {
    this.g = g;
    const wall = new THREE.MeshBasicMaterial({ color: '#23221e', side: THREE.BackSide, fog: false }),
      floor = new THREE.MeshStandardMaterial({ color: '#262521', roughness: 0.95, fog: false }),
      tube = new THREE.MeshBasicMaterial({ color: '#fffbe8', fog: false });
    const add = (o: THREE.Mesh, parent: THREE.Object3D = this.room) => {
      parent.add(o);
      return o;
    };
    add(new THREE.Mesh(new THREE.CylinderGeometry(ROOM_R_M, ROOM_R_M, ROOM_H_M, 48, 1, true), wall)).position.y =
      ROOM_H_M / 2;
    const band = add(
      new THREE.Mesh(
        new THREE.CylinderGeometry(ROOM_R_M - 0.05, ROOM_R_M - 0.05, 1.3, 48, 1, true),
        new THREE.MeshBasicMaterial({ color: '#191815', side: THREE.BackSide, fog: false }),
      ),
    );
    band.position.y = 0.65;
    const ceiling = add(
      new THREE.Mesh(
        new THREE.CircleGeometry(ROOM_R_M, 48),
        new THREE.MeshBasicMaterial({ color: '#1b1a17', fog: false }),
      ),
    );
    ceiling.rotation.x = Math.PI / 2;
    ceiling.position.y = ROOM_H_M;
    const ground = add(new THREE.Mesh(new THREE.CircleGeometry(ROOM_R_M, 48), floor));
    ground.rotation.x = -Math.PI / 2;
    ground.position.y = 0.004;
    for (const x of [-2.4, 0, 2.4])
      add(new THREE.Mesh(new THREE.BoxGeometry(0.14, 0.05, 3.4), tube)).position.set(x, ROOM_H_M - 0.6, 0);

    // the turntable: a dark plate with Skroten's orange ring and studs round the rim
    const top = add(
      new THREE.Mesh(
        new THREE.CylinderGeometry(PLATE_R_M, PLATE_R_M + 0.06, PLATE_TOP_M, 72),
        new THREE.MeshStandardMaterial({ color: '#1f1e1b', roughness: 0.55, metalness: 0.35, fog: false }),
      ),
      this.plate,
    );
    top.position.y = PLATE_TOP_M / 2;
    const ring = add(
      new THREE.Mesh(
        new THREE.RingGeometry(PLATE_R_M - 0.42, PLATE_R_M - 0.26, 72),
        new THREE.MeshBasicMaterial({ color: '#e8792b', fog: false }),
      ),
      this.plate,
    );
    ring.rotation.x = -Math.PI / 2;
    ring.position.y = PLATE_TOP_M + 0.002;
    const edge = add(
      new THREE.Mesh(
        new THREE.TorusGeometry(PLATE_R_M + 0.04, 0.03, 8, 96),
        new THREE.MeshStandardMaterial({ color: '#f2c230', roughness: 0.4, metalness: 0.4, fog: false }),
      ),
      this.plate,
    );
    edge.rotation.x = Math.PI / 2;
    edge.position.y = PLATE_TOP_M;
    const studGeo = new THREE.BoxGeometry(0.16, 0.01, 0.05),
      studMat = new THREE.MeshBasicMaterial({ color: '#f2c230', fog: false });
    for (let i = 0; i < MARKS; i++) {
      const a = (i / MARKS) * Math.PI * 2,
        stud = add(new THREE.Mesh(studGeo, studMat), this.plate);
      stud.position.set(Math.cos(a) * (PLATE_R_M - 0.13), PLATE_TOP_M + 0.004, Math.sin(a) * (PLATE_R_M - 0.13));
      stud.rotation.y = -a;
    }
    this.room.add(this.plate);
    this.room.traverse(o => o.layers.set(SHOWROOM_LAYER));
    this.room.visible = false;
    g.scene.add(this.room);
  }

  /**
   * Every frame. `car` is the car mesh on the lift while the garage is open, else null; `yaw` the way its model faces (rad, as
   * Car.h: 0 is north), so the plate turns with it.
   */
  update(car: THREE.Object3D | null, yaw: number) {
    const { scene, groundAt } = this.g;
    if (car !== this.car) {
      if (this.car) this.car.traverse(o => o.layers.disable(SHOWROOM_LAYER));
      if (car) scene.traverse(o => (o as THREE.Light).isLight && o.layers.enable(SHOWROOM_LAYER)); // the lights light every layer they're on
      this.car = car;
    }
    this.room.visible = !!car;
    if (!car) return;
    car.traverse(o => o.layers.enable(SHOWROOM_LAYER)); // every frame: a decal tried on hangs a new mesh on the car
    const { x, z } = car.position;
    this.room.position.set(x, groundAt(x, z), z);
    this.plate.rotation.y = -yaw;
  }
}
