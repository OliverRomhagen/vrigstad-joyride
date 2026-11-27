import * as THREE from 'three';
import { describe, expect, it } from 'vitest';
import { type LampState, lampsOff } from '../../../../src/game/lighting';
import { CarGlow } from '../../../../src/game/render/car-glow';
import type { RenderedCar } from '../../../../src/game/render/car-meshes';

const doc = { createElement: () => ({ width: 0, height: 0, getContext: () => null }) } as never;
const car = (x: number, z: number, h = 0) =>
  ({ x, z, h, T: { lengthM: 4.8, widthM: 1.8 }, mesh: { position: { y: 0 } } }) as unknown as RenderedCar;
const lit = (o: Partial<LampState>) => () => ({ ...lampsOff(), ...o });
const glowOf = (scene: THREE.Scene) => scene.children.find(o => o instanceof THREE.Points) as THREE.Points;

describe('CarGlow (#304)', () => {
  it('draws nothing by day', () => {
    const scene = new THREE.Scene(),
      glow = new CarGlow({ scene, doc });
    glow.update([car(0, 0)], 0, lit({ head: 0.35, rear: 0.3 }), { x: 0, z: 0 });
    expect(glow.count).toBe(0);
    expect(glowOf(scene).visible).toBe(false);
  });

  it('puts two head and two tail glows on a driven car in the dark, at its ends', () => {
    const scene = new THREE.Scene(),
      glow = new CarGlow({ scene, doc });
    glow.update([car(10, 20)], 1, lit({ head: 1, rear: 0.6 }), { x: 0, z: 0 });
    expect(glow.count).toBe(4);
    const pos = glowOf(scene).geometry.getAttribute('position'),
      col = glowOf(scene).geometry.getAttribute('color');
    // heading 0 is north, towards -z: the head glows are 2.4 m north of the middle, the tails 2.4 m south
    expect([pos.getZ(0), pos.getZ(1), pos.getZ(2), pos.getZ(3)]).toEqual([17.6, 17.6, 22.4, 22.4].map(Math.fround));
    expect(Math.abs(pos.getX(0) - pos.getX(1))).toBeCloseTo(1.8 - 0.6, 5); // a lamp each side, in from the body's sides
    expect(col.getX(2)).toBeGreaterThan(col.getY(2) * 5); // the tails are red
    expect(glowOf(scene).geometry.drawRange.count).toBe(4);
  });

  it('dims with the dark, brightens a braking tail, and skips cars out of range', () => {
    const scene = new THREE.Scene(),
      glow = new CarGlow({ scene, doc }),
      col = () => glowOf(scene).geometry.getAttribute('color');
    glow.update([car(0, 0)], 0.5, lit({ head: 1, rear: 0.6 }), { x: 0, z: 0 });
    const half = col().getX(2);
    glow.update([car(0, 0)], 1, lit({ head: 1, rear: 0.6 }), { x: 0, z: 0 });
    expect(col().getX(2)).toBeCloseTo(half * 2, 5);
    const tail = col().getX(2);
    glow.update([car(0, 0)], 1, lit({ head: 1, rear: 0.6, brake: 1 }), { x: 0, z: 0 });
    expect(col().getX(2)).toBeGreaterThan(tail);
    glow.update([car(400, 0)], 1, lit({ head: 1 }), { x: 0, z: 0 });
    expect(glow.count).toBe(0);
  });

  it('frees what it made on dispose', () => {
    const scene = new THREE.Scene(),
      glow = new CarGlow({ scene, doc }),
      points = glowOf(scene);
    let freed = 0;
    for (const o of [
      points.geometry,
      points.material as THREE.Material,
      (points.material as THREE.PointsMaterial).map!,
    ])
      o.addEventListener('dispose', () => freed++);
    glow.dispose();
    expect(freed).toBe(3);
    expect(scene.children).not.toContain(points);
  });
});
