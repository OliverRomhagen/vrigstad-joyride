import * as THREE from 'three';
import { describe, expect, it } from 'vitest';
import { sideSpanByRays } from '../../../../src/game/render/paint-decals';

// a box from y0 to y1, its face toward the car's right at x
function box(x: number, y0: number, y1: number) {
  const m = new THREE.Mesh(new THREE.BoxGeometry(0.2, y1 - y0, 2));
  m.position.set(x - 0.1, (y0 + y1) / 2, 0);
  return m;
}

// a car side: a painted door from 0 to 1 m, with whatever stands in front of it
function side(inFront: THREE.Mesh[], frameToWorld = new THREE.Matrix4()) {
  const car = new THREE.Group(),
    door = box(0.8, 0, 1);
  car.add(door, ...inFront);
  car.applyMatrix4(frameToWorld);
  car.updateMatrixWorld(true);
  return sideSpanByRays([door, ...inFront], new Set([door]), frameToWorld);
}

describe('sideSpanByRays (where a side shows paint, for the rally number)', () => {
  it('leaves out the paint a sill hides', () => {
    const span = side([box(0.85, 0, 0.3)])(0, 1)!;
    expect(span.low).toBeGreaterThan(0.3);
    expect(span.low).toBeLessThan(0.33);
    expect(span.high).toBeGreaterThan(0.97);
  });

  it('runs across a thin strip of trim, and takes the longer part past a wide one', () => {
    expect(side([box(0.85, 0.5, 0.53)])(0, 1)!.low).toBeLessThan(0.03); // trim: one stretch, top to bottom
    const split = side([box(0.85, 0.3, 0.45)])(0, 1)!; // wide: 0.45 to 1 beats 0 to 0.3
    expect(split.low).toBeGreaterThan(0.45);
  });

  it('measures in the car’s frame wherever the car stands', () => {
    const moved = new THREE.Matrix4().makeRotationY(Math.PI).setPosition(30, 2, -12),
      span = side([box(0.85, 0, 0.3)], moved)(0, 1)!;
    expect(span.low).toBeGreaterThan(0.3);
    expect(span.low).toBeLessThan(0.33);
  });

  it('finds nothing where no paint shows', () => {
    expect(side([box(0.85, 0, 1)])(0, 1)).toBeNull();
  });
});
