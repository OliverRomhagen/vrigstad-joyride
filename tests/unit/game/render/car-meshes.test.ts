import * as THREE from 'three';
import { describe, expect, it } from 'vitest';
import type { Car } from '../../../../src/game/cars';
import { type LampState, lampsOff } from '../../../../src/game/lighting';
import { CarMeshes, type RenderedCar } from '../../../../src/game/render/car-meshes';

/** CarMeshes with stubs for everything but the lamps: a car is only placed, never drawn. */
function meshes(lampGeo: (type: string, end: 1 | -1) => THREE.BufferGeometry | null) {
  return new CarMeshes({
    scene: new THREE.Scene(),
    groundAt: () => 0,
    normalAt: () => new THREE.Vector3(0, 1, 0),
    carGeo: () => new THREE.BufferGeometry(),
    lampGeo,
    carMat: new THREE.MeshBasicMaterial(),
    blob: () => new THREE.Mesh(),
    barGeo: new THREE.BufferGeometry(),
    barMat: new THREE.MeshBasicMaterial(),
    vehicleVisuals: { sync() {}, attach() {}, dispose() {} } as never,
    bodyMotion: { add() {}, remove() {} } as never,
  });
}
const car = (type = 'volvo') =>
  ({ type, T: { suspension: {} }, color: '#fff', x: 0, z: 0, h: 0, wet: false }) as unknown as Car;
const lit = (o: Partial<LampState>) => () => ({ ...lampsOff(), ...o });
const rearGeo = new THREE.BufferGeometry(),
  headGeo = new THREE.BufferGeometry(),
  byEnd = (_t: string, end: 1 | -1) => (end === 1 ? rearGeo : headGeo);
/** the car's rear lamp mesh, if it has one */
const lampOf = (c: RenderedCar) =>
  c.body.children.find(o => o instanceof THREE.Mesh && o.geometry === rearGeo) as THREE.Mesh | undefined;
const headOf = (c: RenderedCar) =>
  c.body.children.find(o => o instanceof THREE.Mesh && o.geometry === headGeo) as THREE.Mesh | undefined;

describe('CarMeshes.updateLamps (#304)', () => {
  it('adds no lamp mesh to a car whose lamps are dark', () => {
    const m = meshes(byEnd),
      c = m.attach(car(), undefined);
    m.updateLamps([c], lit({ head: 0.35, rear: 0.3 }));
    expect(lampOf(c)).toBeUndefined(); // the baked lamps do for dipped and position lights by day
  });

  it('lights the rear lamps red when braking, white when backing, and hides them again', () => {
    const m = meshes(byEnd),
      c = m.attach(car(), undefined);
    m.updateLamps([c], lit({ brake: 1 }));
    const lamp = lampOf(c)!;
    expect(lamp.visible).toBe(true);
    expect(headOf(c)).toBeUndefined(); // by day only the rear lamps change
    const brake = lamp.material as THREE.MeshBasicMaterial;
    expect(brake.color.r).toBeGreaterThan(brake.color.g * 5);
    expect(brake.toneMapped).toBe(false);
    m.updateLamps([c], lit({ reverse: 1 }));
    const reverse = lamp.material as THREE.MeshBasicMaterial;
    expect(reverse).not.toBe(brake);
    expect(reverse.color.b).toBeGreaterThan(0.8);
    m.updateLamps([c], lit({}));
    expect(lamp.visible).toBe(false);
    m.updateLamps([c], lit({ brake: 1 }));
    expect(c.body.children.filter(o => o instanceof THREE.Mesh)).toHaveLength(1); // reused, not added again
  });

  it('lights head and tail lamps in the dark, and puts them out at dawn', () => {
    const m = meshes(byEnd),
      c = m.attach(car(), undefined);
    m.updateLamps([c], lit({ head: 1, rear: 0.6 }));
    expect(headOf(c)?.visible).toBe(true);
    const tail = lampOf(c)!.material as THREE.MeshBasicMaterial;
    m.updateLamps([c], lit({ head: 1, rear: 0.6, brake: 1 }));
    expect((lampOf(c)!.material as THREE.MeshBasicMaterial).color.r).toBeGreaterThan(tail.color.r); // a brake light outshines the tail
    m.updateLamps([c], lit({ head: 0.35, rear: 0.3 }));
    expect(headOf(c)?.visible).toBe(false);
    expect(lampOf(c)?.visible).toBe(false);
  });

  it('shares its materials between cars, and blinks a wreck amber over a brake signal', () => {
    const m = meshes(byEnd),
      a = m.attach(car(), undefined),
      b = m.attach(car('saab'), undefined);
    m.updateLamps([a, b], lit({ brake: 1 }));
    expect(lampOf(a)!.material).toBe(lampOf(b)!.material);
    m.updateLamps([a], lit({ brake: 1, hazard: 1 }));
    const amber = lampOf(a)!.material as THREE.MeshBasicMaterial;
    expect(amber).not.toBe(lampOf(b)!.material);
    expect(amber.color.g).toBeGreaterThan(amber.color.b);
  });

  it('leaves a car showing its model, and a type without rear lamps, alone', () => {
    const m = meshes((t, end) => (t === 'traktor' ? null : byEnd(t, end))),
      modelled = m.attach(car(), undefined),
      tractor = m.attach(car('traktor'), undefined);
    modelled.body.visible = false; // its detailed model shows instead
    m.updateLamps([modelled, tractor], lit({ brake: 1 }));
    expect(lampOf(modelled)).toBeUndefined();
    expect(lampOf(tractor)).toBeUndefined();
  });
});
