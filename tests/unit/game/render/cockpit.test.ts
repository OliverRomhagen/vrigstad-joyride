import fs from 'node:fs';
import * as THREE from 'three';
import { MeshoptDecoder } from 'three/addons/libs/meshopt_decoder.module.js';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';
import { beforeAll, describe, expect, it } from 'vitest';
import type { RenderedCar } from '../../../../src/game/render/car-meshes';
import { Cockpit, needleAngle } from '../../../../src/game/render/cockpit';
import { DECAL_NODE } from '../../../../src/game/render/paint-decals';
import { BODY_NODE } from '../../../../src/game/render/vehicle-registry';

let template: THREE.Group;
beforeAll(async () => {
  await MeshoptDecoder.ready;
  const b = fs.readFileSync('src/public/media/vehicles/volvo240.glb');
  const gltf = await new GLTFLoader()
    .setMeshoptDecoder(MeshoptDecoder)
    .parseAsync(b.buffer.slice(b.byteOffset, b.byteOffset + b.length), '');
  template = gltf.scene;
});

// The Volvo 240 as VehicleVisuals hangs it on a car: its body moved into a sprung group, the car turned `h` and placed at (x, z).
function volvo(h = 0, x = 0, z = 0) {
  const root = template.clone(true);
  root.updateMatrixWorld(true);
  const body = root.getObjectByName(BODY_NODE)!;
  const sprung = new THREE.Group();
  root.attach(body);
  sprung.add(body);
  root.add(sprung);
  const fallback = new THREE.Mesh(new THREE.BoxGeometry(1.7, 1, 4.8), new THREE.MeshLambertMaterial());
  fallback.visible = false;
  const mesh = new THREE.Group();
  mesh.add(fallback, root);
  mesh.position.set(x, 0, z);
  mesh.rotation.y = -h;
  const car = { mesh, body: fallback, st: 0, type: 'volvo', x, z, h } as unknown as RenderedCar;
  return { car, sprung, body };
}

function cockpit(car: RenderedCar, inCar = true) {
  const camera = new THREE.PerspectiveCamera(58, 16 / 9, 0.8, 4200);
  const game = { inCar, pcar: car };
  const view = { lookOff: 0, camPitch: 0.34 };
  const renderer = { localClippingEnabled: false };
  const profiles = {
    volvo: {
      glass: [
        [-0.9, 0.97],
        [2.1, 0.97],
        [1.95, 1.48],
        [-0.35, 1.48],
      ],
      gw: 1.56,
    },
  };
  // a canvas whose 2D context draws nothing: the dials' drawing is looked at in the game, not here
  const ctx = new Proxy({}, { get: () => () => {} });
  const doc = { createElement: () => ({ width: 0, height: 0, getContext: () => ctx }) } as never;
  const repainted: RenderedCar[] = [];
  const k = new Cockpit({ camera, game, view, renderer, profiles, doc, hour: 13.5, repaint: c => repainted.push(c) });
  return { k, camera, game, view, renderer, repainted };
}

// the camera's position in the frame of `o`
const inFrameOf = (o: THREE.Object3D, p: THREE.Vector3) => {
  o.updateWorldMatrix(true, false);
  return p.clone().applyMatrix4(o.matrixWorld.clone().invert());
};

describe('Cockpit (the driver’s view, lab: cockpit)', () => {
  it('puts the camera in the driver’s seat, left of the middle, between the belt line and the roof', () => {
    const { car, sprung } = volvo();
    const { k, camera } = cockpit(car);
    k.toggle();
    k.update();
    expect(k.inside).toBe(true);
    const eye = inFrameOf(sprung, camera.position);
    expect(eye.x).toBeCloseTo(-0.37, 2); // the round-3 Volvo cabin reaches the 37 cm left-hand-drive offset cap
    expect(eye.y).toBeGreaterThan(0.94 + 0.2); // the Volvo's glass runs from 0.94 m to 1.43 m
    expect(eye.y).toBeLessThan(1.43 - 0.1);
    expect(eye.z).toBeGreaterThan(-0.85); // behind the windscreen's foot, ahead of the rear window
    expect(eye.z).toBeLessThan(1.36);
    expect(camera.getWorldDirection(new THREE.Vector3()).z).toBeCloseTo(-1, 1); // looking ahead: -z, as the model faces
  });

  it('finds the same seat in a turned car', () => {
    // a cabin measured through the turned world came out too big, and put the eye in front of the windscreen
    const straight = volvo();
    const turned = volvo(0.6, 30, -12);
    const a = cockpit(straight.car);
    const b = cockpit(turned.car);
    for (const { k } of [a, b]) {
      k.toggle();
      k.update();
    }
    const eyeA = inFrameOf(straight.sprung, a.camera.position);
    const eyeB = inFrameOf(turned.sprung, b.camera.position);
    expect(eyeB.distanceTo(eyeA)).toBeLessThan(1e-6);
  });

  it('hides the glass and clips the body at the belt line while inside, and puts both back when you leave', () => {
    const { car, body } = volvo();
    const glass = body.getObjectByName('glass_envelope')!;
    const paint = (body as THREE.Mesh).material as THREE.Material;
    const { k, camera, renderer } = cockpit(car);
    expect(renderer.localClippingEnabled).toBe(true);
    k.toggle();
    k.update();
    expect(glass.visible).toBe(false);
    const own = (body as THREE.Mesh).material as THREE.Material;
    expect(own).not.toBe(paint); // a clone: other cars that share the paint keep their roofs
    expect(paint.clippingPlanes).toBeNull();
    // cut away where every plane says so: the cabin over the belt line, not the bonnet, which rises over it at the windscreen
    const cut = (x: number, y: number, z: number) =>
      own.clipIntersection && own.clippingPlanes!.every(p => p.distanceToPoint(new THREE.Vector3(x, y, z)) < 0);
    expect(cut(0, 1.3, 0)).toBe(true); // the roof over the seats (the Volvo's glass: y 0.94 to 1.43, z -0.85 to 1.36)
    expect(cut(0, 1.0, -1.0)).toBe(false); // the bonnet just ahead of the windscreen, 6 cm over the belt line
    expect(cut(0, 1.0, 1.6)).toBe(false); // the boot lid behind the rear window
    expect(cut(0, 0.8, 0)).toBe(false); // the doors under the belt line
    expect(camera.near).toBeLessThan(0.1);
    k.toggle();
    k.update();
    expect(k.inside).toBe(false);
    expect(glass.visible).toBe(true);
    expect((body as THREE.Mesh).material).toBe(paint);
    expect(camera.near).toBe(0.8);
  });

  it('clips a decal with the body it is painted on, and puts its material back when you leave', () => {
    const { car, body } = volvo();
    const own = new THREE.MeshBasicMaterial(),
      decal = Object.assign(new THREE.Mesh(new THREE.PlaneGeometry(), own), { name: DECAL_NODE });
    body.add(decal);
    const { k } = cockpit(car);
    k.toggle();
    k.update();
    expect(decal.material).not.toBe(own);
    expect((decal.material as THREE.Material).clippingPlanes).toHaveLength(3);
    k.toggle();
    k.update();
    expect(decal.material).toBe(own);
  });

  it('keeps a material the simple car was given while inside, as a respray swaps it for the new paint', () => {
    const { car } = volvo();
    car.mesh.children[1]!.visible = false; // the model hidden: you sit in the simple car
    car.body.visible = true;
    const { k } = cockpit(car);
    k.toggle();
    k.update();
    expect((car.body.material as THREE.Material).clippingPlanes).toHaveLength(3); // a clipped clone is on it
    const fresh = new THREE.MeshPhongMaterial();
    car.body.material = fresh; // as CarMeshes.repaint does
    k.toggle();
    k.update();
    expect(car.body.material).toBe(fresh);
  });

  it('paints the model again when you leave after a respray inside, and only then', () => {
    // a respray inside recolours the clipped clones, which leaving throws away for the body's materials in the old paint
    const { car, body } = volvo();
    const { k, repainted } = cockpit(car);
    k.toggle();
    k.update();
    k.toggle();
    k.update();
    expect(repainted).toEqual([]);
    k.toggle();
    k.update();
    ((body as THREE.Mesh).material as THREE.MeshStandardMaterial).color.set('#1a3a8a'); // as VehicleVisuals.paint does
    k.toggle();
    k.update();
    expect(repainted).toEqual([car]);
  });

  it('turns the steering wheel clockwise as you steer right', () => {
    const { car, sprung } = volvo();
    const { k } = cockpit(car);
    k.toggle();
    (car as { st: number }).st = 1; // full right
    k.update();
    let ring: THREE.Object3D | undefined;
    sprung.traverse(o => {
      if (o instanceof THREE.Mesh && o.geometry instanceof THREE.TorusGeometry) ring = o;
    });
    expect(ring?.parent?.rotation.z).toBeLessThan(-1); // seen from the seat, behind it: clockwise
  });

  it('leaves the camera alone on foot, and while the view is behind the car', () => {
    const { car } = volvo();
    const onFoot = cockpit(car, false);
    onFoot.k.toggle();
    onFoot.k.update();
    expect(onFoot.k.inside).toBe(false);
    onFoot.game.inCar = true;
    onFoot.k.update();
    expect(onFoot.k.inside).toBe(false); // V on foot must not arm the next car's view
    const behind = cockpit(car);
    behind.camera.position.set(1, 2, 3);
    behind.k.update();
    expect(behind.k.inside).toBe(false);
    expect(behind.camera.position.toArray()).toEqual([1, 2, 3]);
  });

  it('sits in the simple car, from its side profile, while the model doesn’t show', () => {
    const { car } = volvo();
    car.mesh.children[1].visible = false; // the model's root: not loaded or too far, so the simple car shows
    car.body.visible = true;
    const { k, camera } = cockpit(car);
    k.toggle();
    k.update();
    const eye = inFrameOf(car.body, camera.position);
    expect(eye.x).toBeCloseTo(-0.35, 2); // under the simple glass's 1.56 m, the side keeps to 45 % of the half width
    expect(eye.y).toBeCloseTo(1.28, 2); // 0.2 m under its 1.48 m roof
    expect(eye.z).toBeCloseTo(0.1, 2); // 1 m behind its windscreen's foot at -0.9 m
  });

  it('reads the dials from rest at lower left to full at lower right, and holds them there past the ends', () => {
    expect(needleAngle(0, 200)).toBeCloseTo((-135 * Math.PI) / 180);
    expect(needleAngle(100, 200)).toBeCloseTo(0); // half way: straight up
    expect(needleAngle(250, 200)).toBeCloseTo((135 * Math.PI) / 180);
    expect(needleAngle(-5, 200)).toBeCloseTo((-135 * Math.PI) / 180); // below 0 holds at rest
  });

  it('stays behind a car it has no cabin for, rather than in the last car’s seat', () => {
    const volvoCar = volvo().car;
    const tractor = volvo().car;
    tractor.mesh.children[1].visible = false; // no model, and its type has no profile: nothing to sit in
    tractor.body.visible = true;
    (tractor as { type: string }).type = 'traktor';
    const { k, camera, game } = cockpit(volvoCar);
    k.toggle();
    k.update();
    game.pcar = tractor;
    camera.position.set(1, 2, 3); // where the rig put it, behind the tractor
    k.update();
    expect(k.inside).toBe(false);
    expect(camera.position.toArray()).toEqual([1, 2, 3]);
  });
});
