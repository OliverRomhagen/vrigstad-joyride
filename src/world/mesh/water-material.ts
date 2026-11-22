import '../three-legacy';
import * as THREE from 'three';
import type { WaterColours } from '../water-palette';

export interface WaterMaterialOptions {
  colours: WaterColours;
  /** unit vector towards the sun, shared and updated by the page's daylight; read by reference */
  sunDir: THREE.Vector3;
  /** the horizon (fog) colour in sRGB, updated by the page's daylight; read by reference */
  horizon: THREE.Color;
  /** river: ripples run along the flow (the surface's `flowUv` is distance along and across it); lake: a light wind drifts them */
  flowing: boolean;
  /** `lite` (coarse devices, the map): one ripple layer and no glints */
  detail: 'full' | 'lite';
  /**
   * `linear`: the page renders in linear light and converts on output (the game), so sRGB colours are converted;
   * `as-written`: the page uses colours as written (the map, as in r128).
   */
  colourSpace?: 'linear' | 'as-written';
}

/** how wide the shore's line and the shallows are, from the waterline (m); narrower on rivers, a few metres wide */
const LAKE_EDGE_W_M = 0.6;
const RIVER_EDGE_W_M = 0.3;
const LAKE_SHALLOW_W_M = 4.5;
const RIVER_SHALLOW_W_M = 0.9;
/** how far the bands' edges wobble with the large ripples (m) */
const LAKE_WOBBLE_M = 1.1;
const RIVER_WOBBLE_M = 0.4;
/** how fast the ripples drift: along a river (m/s), and with the wind on a lake (m/s, towards x and z) */
const RIVER_FLOW_M_S = 0.45;
const LAKE_WIND = [0.12, 0.05] as const;

const VERTEX_HEAD = /* glsl */ `
attribute float shore;
attribute vec2 flowUv;
varying float vShore;
varying vec2 vFlowUv;
varying vec3 vWaterWorld;
`;

const FRAGMENT_HEAD = /* glsl */ `
uniform float uTime, uSoft, uEdgeW, uShallowW, uWobble, uGlint, uSunLight;
uniform vec2 uDrift;
uniform vec3 uDeep, uShallow, uEdge, uRipple, uSunDir, uHorizon;
varying float vShore;
varying vec2 vFlowUv;
varying vec3 vWaterWorld;
float wHash(vec2 p) { return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453); }
float wNoise(vec2 p) {
  vec2 i = floor(p), f = fract(p);
  vec2 u = f * f * (3.0 - 2.0 * f);
  return mix(mix(wHash(i), wHash(i + vec2(1.0, 0.0)), u.x), mix(wHash(i + vec2(0.0, 1.0)), wHash(i + vec2(1.0, 1.0)), u.x), u.y);
}
`;

// the colour: three bands from the shore, their edges wobbling with the large ripples, and thin ripple lines on top
const FRAGMENT_COLOUR = /* glsl */ `
  vec2 wp = vFlowUv - uDrift * uTime;
  float big = wNoise(wp / 12.0 + vec2(0.0, uTime * 0.01));
  #ifdef WATER_FULL
  float fine = wNoise(wp * vec2(0.45, 0.8) + vec2(uTime * 0.07, 3.1));
  float ripple = big * 0.35 + fine * 0.65;
  #else
  float ripple = big;
  #endif
  float sd = vShore + (big - 0.5) * uWobble;
  float shallowBand = 1.0 - smoothstep(uShallowW - uSoft, uShallowW + uSoft, sd);
  float edgeBand = 1.0 - smoothstep(uEdgeW - uSoft * 0.5, uEdgeW + uSoft * 0.5, sd);
  vec3 waterC = mix(mix(uDeep, uShallow, shallowBand), uEdge, edgeBand);
  float line = smoothstep(0.61, 0.625, ripple) * (1.0 - smoothstep(0.645, 0.66, ripple));
  waterC = mix(waterC, uRipple, line * (0.2 - edgeBand * 0.12));
  vec4 diffuseColor = vec4(waterC, opacity);
`;

// after the light: a tint towards the horizon at grazing angles, and a few hard glints on the sun's path
const FRAGMENT_LIGHT = /* glsl */ `
  vec3 toEye = normalize(cameraPosition - vWaterWorld);
  float grazing = pow(1.0 - clamp(toEye.y, 0.0, 1.0), 3.0);
  #ifdef WATER_AS_WRITTEN
  vec3 horizonC = uHorizon;
  #else
  vec3 horizonC = pow(uHorizon, vec3(2.2));
  #endif
  outgoingLight = mix(outgoingLight, horizonC * 0.85, grazing * 0.45);
  #ifdef WATER_FULL
  vec3 mirrored = vec3(-toEye.x, toEye.y, -toEye.z);
  float sparkle = wNoise(wp * 2.6 + vec2(17.0, uTime * 0.6));
  float toSun = dot(mirrored, uSunDir) + (sparkle - 0.5) * 0.1;
  outgoingLight += vec3(1.0, 0.96, 0.86) * uGlint * uSunLight * smoothstep(0.962, 0.978, toSun) * step(0.9, sparkle);
  #endif
  #include <opaque_fragment>
`;

/**
 * The stylised water material: a MeshLambertMaterial, so fog, shadows and the scene's lights work as on everything
 * else, with its colour and a glint worked out per pixel. No textures, no extra passes. The page owns the instance:
 * `tick` once a frame, `dispose()` when done.
 */
export class WaterMaterial {
  readonly material: THREE.MeshLambertMaterial;
  private readonly uniforms: Record<string, THREE.IUniform>;
  private readonly convert: boolean;

  constructor({ colours, sunDir, horizon, flowing, detail, colourSpace = 'linear' }: WaterMaterialOptions) {
    this.convert = colourSpace === 'linear';
    this.uniforms = {
      uTime: { value: 0 },
      uSoft: { value: 0.35 },
      uEdgeW: { value: flowing ? RIVER_EDGE_W_M : LAKE_EDGE_W_M },
      uWobble: { value: flowing ? RIVER_WOBBLE_M : LAKE_WOBBLE_M },
      uShallowW: { value: flowing ? RIVER_SHALLOW_W_M : LAKE_SHALLOW_W_M },
      uGlint: { value: 1.6 },
      uSunLight: { value: 1 },
      uDrift: { value: new THREE.Vector2(...(flowing ? [RIVER_FLOW_M_S, 0] : LAKE_WIND)) },
      uDeep: { value: new THREE.Color() },
      uShallow: { value: new THREE.Color() },
      uEdge: { value: new THREE.Color() },
      uRipple: { value: new THREE.Color() },
      uSunDir: { value: sunDir },
      uHorizon: { value: horizon },
    };
    this.setColours(colours);
    const material = new THREE.MeshLambertMaterial({ name: flowing ? 'water-river' : 'water-lake' });
    material.defines = {};
    if (detail === 'full') material.defines.WATER_FULL = '';
    if (!this.convert) material.defines.WATER_AS_WRITTEN = '';
    material.onBeforeCompile = shader => {
      Object.assign(shader.uniforms, this.uniforms);
      shader.vertexShader = shader.vertexShader
        .replace('#include <common>', `#include <common>${VERTEX_HEAD}`)
        .replace(
          '#include <project_vertex>',
          '#include <project_vertex>\nvShore = shore;\nvFlowUv = flowUv;\nvWaterWorld = (modelMatrix * vec4(transformed, 1.0)).xyz;',
        );
      shader.fragmentShader = shader.fragmentShader
        .replace('#include <common>', `#include <common>${FRAGMENT_HEAD}`)
        .replace('vec4 diffuseColor = vec4( diffuse, opacity );', FRAGMENT_COLOUR)
        .replace('#include <opaque_fragment>', FRAGMENT_LIGHT);
    };
    material.customProgramCacheKey = () => `water-${detail}-${colourSpace}`;
    this.material = material;
  }

  /** Recolours, for a theme change or a season. */
  setColours(colours: WaterColours) {
    const set = (name: string, hex: number) => {
      const c = (this.uniforms[name].value as THREE.Color).set(hex);
      if (this.convert) c.convertSRGBToLinear();
    };
    set('uDeep', colours.deep);
    set('uShallow', colours.shallow);
    set('uEdge', colours.edge);
    set('uRipple', colours.ripple);
  }

  /** Harder band edges for the cel-shaded style (#206): the water keeps its own material there, never the toon swap. */
  set toon(on: boolean) {
    this.uniforms.uSoft.value = on ? 0.04 : 0.35;
  }

  /** Once a frame: moves the ripples on by `dt` seconds; `sunLight` (0 to 1) dims the glints with the sun. */
  tick(dt: number, sunLight = 1) {
    this.uniforms.uTime.value = (this.uniforms.uTime.value + dt) % 3600;
    this.uniforms.uSunLight.value = sunLight;
  }

  dispose() {
    this.material.dispose();
  }
}
