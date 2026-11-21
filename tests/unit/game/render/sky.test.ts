import * as THREE from 'three';
import { describe, expect, it } from 'vitest';
import { Sky } from '../../../../src/game/render/sky';
import { CLOUD_PRESETS, DEFAULT_CLOUDS, LOW_OCTAVES, seedOffset } from '../../../../src/world/clouds';

const make = (clouds = DEFAULT_CLOUDS, sunDir = new THREE.Vector3(-0.55, 0.75, 0.37).normalize()) =>
  new Sky({ top: 0x5f97c9, horizon: 0xd6e4e6, sunColour: 0xfff1d0, sunDir, clouds });

describe('Sky', () => {
  it('keeps the uniforms the day cycle (#204) drives, and shares the sun direction instead of copying it', () => {
    const sunDir = new THREE.Vector3(0, 1, 0);
    const sky = make(DEFAULT_CLOUDS, sunDir);
    const u = sky.mesh.material.uniforms;
    for (const k of ['top', 'hor', 'sunC']) expect(u[k].value).toBeInstanceOf(THREE.Color);
    expect(u.sunDir.value).toBe(sunDir);
    expect(u.seed.value.toArray()).toEqual(seedOffset(DEFAULT_CLOUDS.seed));
    expect(u.threshold.value).toBe(CLOUD_PRESETS.partly.threshold);
  });

  it('follows the camera and moves the clouds with time, not with frames', () => {
    const sky = make();
    const cam = new THREE.Vector3(10, 20, 30);
    sky.update(cam, 100, 1 / 60);
    expect(sky.mesh.position.toArray()).toEqual([10, 20, 30]);
    const u = sky.mesh.material.uniforms;
    const at100 = u.wind.value.clone();
    for (let i = 0; i < 10; i++) sky.update(cam, 100 + i / 10, 1 / 10);
    sky.update(cam, 101, 1 / 10);
    const via = u.wind.value.clone();
    sky.update(cam, 101, 0); // the same moment again, reached in one step
    expect(u.wind.value.toArray()).toEqual(via.toArray());
    expect(via.distanceTo(at100)).toBeGreaterThan(0);
  });

  it('dims the sun only as far as the preset allows, and not at all with clouds off', () => {
    const sky = make({ ...DEFAULT_CLOUDS, cover: 'mostly' });
    for (let t = 0; t < 600; t += 0.5) {
      sky.update(new THREE.Vector3(), t, 0.5);
      expect(sky.sunFactor).toBeGreaterThanOrEqual(1 - CLOUD_PRESETS.mostly.sunDim - 1e-9);
      expect(sky.sunFactor).toBeLessThanOrEqual(1);
    }
    const off = make({ ...DEFAULT_CLOUDS, cover: 'off' });
    off.update(new THREE.Vector3(), 50, 1);
    expect(off.sunFactor).toBe(1);
    expect(off.mesh.material.defines.CLOUDS).toBe(0);
  });

  it('starts the sunlight where it should be, with no fade-in on the first frame', () => {
    const sky = make({ ...DEFAULT_CLOUDS, cover: 'mostly' });
    sky.update(new THREE.Vector3(), 777, 1 / 60);
    const first = sky.state().sunShade;
    const fresh = make({ ...DEFAULT_CLOUDS, cover: 'mostly' });
    fresh.update(new THREE.Vector3(), 777, 5);
    expect(fresh.state().sunShade).toBeCloseTo(first, 12);
  });

  it('draws fewer octaves and no self-shadow in the low quality mode', () => {
    const d = make({ ...DEFAULT_CLOUDS, quality: 'low' }).mesh.material.defines;
    expect(d.OCTAVES).toBe(LOW_OCTAVES);
    expect(d.SHADE).toBe(0);
  });

  it('frees its geometry and material', () => {
    const sky = make();
    let freed = 0;
    sky.mesh.geometry.addEventListener('dispose', () => freed++);
    sky.mesh.material.addEventListener('dispose', () => freed++);
    sky.dispose();
    expect(freed).toBe(2);
  });
});
