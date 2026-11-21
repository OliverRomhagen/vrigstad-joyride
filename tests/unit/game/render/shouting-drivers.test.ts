import * as THREE from 'three';
import { describe, expect, it } from 'vitest';
import { ShoutingDrivers } from '../../../../src/game/render/shouting-drivers';

describe('ShoutingDrivers', () => {
  it('dresses each driver with a skin tone from the palette, passed to personParts', () => {
    const calls: unknown[][] = [];
    const drivers = new ShoutingDrivers({
      scene: { add() {}, remove() {} } as unknown as THREE.Scene,
      groundAt: () => 0,
      personParts: (...args: unknown[]) => {
        calls.push(args);
        return new THREE.Object3D();
      },
      pick: <T>(a: readonly T[]) => a[calls.length % a.length],
    });
    for (let i = 0; i < 5; i++) drivers.driverOut({ x: 0, z: 0, h: 0 });
    expect(calls).toHaveLength(5);
    const skins = new Set<unknown>();
    for (const [shirt, pants, hair, skin] of calls) {
      expect(typeof shirt).toBe('string');
      expect(pants).toBe('#3a3a3a');
      expect(hair).toBeNull();
      expect(skin).toMatch(/^#[0-9a-f]{6}$/);
      skins.add(skin);
    }
    expect(skins.size).toBeGreaterThan(1);
  });
});
