import * as THREE from 'three';
import { LEGACY_LIGHT, srgb } from '../../world/three-legacy';
import type { Sky } from '../day-cycle';

const SUN_I = 0.95,
  HEMI_I = 0.62; // midday intensities in r128 units, which the scene was tuned with
const SKY_DIM = 0.45; // sky dome and fog brightness lost per unit of Sky.light below 1
const lin = (c: number) => new THREE.Color(c).convertSRGBToLinear();
// Light colours are linear. The sky, fog and clear colours stay sRGB: three applies fog after the output conversion.
const SUN_DAY = lin(0xfff4dd),
  SUN_LOW = lin(0xffa860);
const HEMI_DAY = lin(0xffffff),
  HEMI_LOW = lin(0xffd6b0);
const TOP_DAY = srgb(0x5f97c9),
  TOP_LOW = srgb(0x7c8cbf);
const HOR_DAY = srgb(0xd6e4e6),
  HOR_LOW = srgb(0xf2c39a);
const GLOW_DAY = srgb(0xfff1d0),
  GLOW_LOW = srgb(0xffa860);

/** What the time of day changes in the scene. `sunDir` is shared with the sky dome's shader and the shadow camera. */
export interface DaylightTargets {
  sun: THREE.DirectionalLight;
  hemi: THREE.HemisphereLight;
  sunDir: THREE.Vector3;
  dome: { top: { value: THREE.Color }; hor: { value: THREE.Color }; sunC: { value: THREE.Color } };
  fog: THREE.Color;
  background: THREE.Color;
}

/**
 * Turns a Sky into light and sky colours. It changes intensities and colours only: the sun keeps casting shadows even
 * when it gives almost no light, because switching a light or its shadows on or off recompiles every material.
 */
export class Daylight {
  /** the sun's intensity for the time of day under a clear sky; the clouds' shade (sky.ts) multiplies it, so the camera rig sets sun.intensity */
  sunIntensity = SUN_I * LEGACY_LIGHT;
  constructor(private readonly targets: DaylightTargets) {}

  apply(sky: Sky) {
    const { sun, hemi, sunDir, dome, fog, background } = this.targets;
    sunDir.set(sky.x, sky.y, sky.z);
    this.sunIntensity = SUN_I * LEGACY_LIGHT * sky.sun;
    sun.color.copy(SUN_DAY).lerp(SUN_LOW, sky.warm);
    hemi.intensity = HEMI_I * LEGACY_LIGHT * sky.light;
    hemi.color.copy(HEMI_DAY).lerp(HEMI_LOW, sky.warm * 0.5);
    const dim = 1 - SKY_DIM * (1 - sky.light);
    dome.top.value
      .copy(TOP_DAY)
      .lerp(TOP_LOW, sky.warm * 0.7)
      .multiplyScalar(dim);
    dome.hor.value
      .copy(HOR_DAY)
      .lerp(HOR_LOW, sky.warm * 0.8)
      .multiplyScalar(dim);
    dome.sunC.value.copy(GLOW_DAY).lerp(GLOW_LOW, sky.warm);
    fog.copy(dome.hor.value);
    background.copy(fog);
  }
}
