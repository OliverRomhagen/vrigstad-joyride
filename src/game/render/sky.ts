// The sky dome: the blue gradient, the sun's glow and the fair-weather clouds, all in one shader, so the clouds cost no
// extra draw call and no geometry. The clouds lie on a flat layer CLOUD_ALTITUDE_M up: each pixel finds where its view
// ray meets the layer and reads the cloud field there, so the clouds stay put in the world when the camera turns and
// drift past with parallax when it moves. The field is src/world/clouds.ts's, mirrored in GLSL below.
import * as THREE from 'three';
import {
  approach,
  CLOUD_ALTITUDE_M,
  CLOUD_CURVE,
  CLOUD_FADE_M,
  CLOUD_PRESETS,
  CLOUD_SCALE_M,
  EROSION,
  type CloudConfig,
  evolveAt,
  HIGH_OCTAVES,
  LOW_OCTAVES,
  SUN_SHADE_TAU_S,
  seedOffset,
  sunCover,
  windOffset,
} from '../../world/clouds';

export interface SkyOptions {
  /** sRGB colours, used as written (colour management is off, see three-legacy.ts) */
  top: number;
  horizon: number;
  sunColour: number;
  /** unit direction to the sun; shared, not copied, so whoever moves the sun moves the sky's sun and clouds' light */
  sunDir: THREE.Vector3;
  clouds: CloudConfig;
  /** dome radius (m); inside the camera's far plane */
  radius?: number;
}

const glsl = String.raw;
const FRAGMENT = glsl`
uniform vec3 top, hor, sunC, sunDir, camPos;
uniform vec2 wind, seed;
uniform float evolve, threshold, softness, cluster, opacity;
varying vec3 vDir;
#if CLOUDS
// hash3, vnoise, fbm and the field are src/world/clouds.ts's hash3, valueNoise, fbm and cloudField
float hash3(vec3 p) {
  p = mod(p, 256.0);
  vec3 q = fract(p * 0.1031);
  q += dot(q, q.zyx + 31.32);
  return fract((q.x + q.y) * q.z);
}
float vnoise(vec3 x) {
  vec3 i = floor(x), f = x - i, u = f * f * (3.0 - 2.0 * f);
  return mix(mix(mix(hash3(i), hash3(i + vec3(1, 0, 0)), u.x), mix(hash3(i + vec3(0, 1, 0)), hash3(i + vec3(1, 1, 0)), u.x), u.y),
             mix(mix(hash3(i + vec3(0, 0, 1)), hash3(i + vec3(1, 0, 1)), u.x), mix(hash3(i + vec3(0, 1, 1)), hash3(i + vec3(1, 1, 1)), u.x), u.y), u.z);
}
float fbm(vec3 p, int octaves) {
  float s = 0.0, a = 0.5, n = 0.0;
  for (int i = 0; i < 5; i++) {
    if (i >= octaves) break;
    s += a * vnoise(p); n += a; a *= 0.5;
    p = p * 2.0 + vec3(17.0, 31.0, 7.0);
  }
  return s / n;
}
float billow(vec3 p, int octaves) {
  float s = 0.0, a = 0.5, n = 0.0;
  for (int i = 0; i < 5; i++) {
    if (i >= octaves) break;
    s += a * abs(2.0 * vnoise(p) - 1.0); n += a; a *= 0.5;
    p = p * 2.0 + vec3(17.0, 31.0, 7.0);
  }
  return s / n;
}
#endif
void main() {
  vec3 d = normalize(vDir);
  vec3 c = mix(hor, top, pow(max(d.y, 0.0), 0.55));
  float s = max(dot(d, sunDir), 0.0);
  vec3 glow = sunC * (pow(s, 48.0) * 0.6 + pow(s, 6.0) * 0.12);
#if CLOUDS
  if (d.y > 0.012) {
    float reach = (ALTITUDE - camPos.y) / (d.y + CURVE);
    float far = exp(-reach / FADE);
    vec2 p = (camPos.xz + d.xz * reach) / SCALE - wind + seed;
    vec2 q = p + (vec2(fbm(vec3(p * 0.5 + vec2(5.0, 1.0), evolve), 2), fbm(vec3(p * 0.5 + vec2(83.0, 47.0), evolve), 2)) - 0.5) * 1.6;
    float cl = vnoise(vec3(p * 0.25 + vec2(40.0, 9.0), evolve * 0.5));
    float base = fbm(vec3(q, evolve), 3);
    float cover = smoothstep(threshold - 0.12, threshold + 0.12, base + (cl - 0.5) * cluster);
    // clear sky stops here: with no cover, erosion can only take away, so the detail and shading are skipped
    float eroded = cover > 0.0 ? cover - (1.0 - cover) * billow(vec3(q * 4.0 + vec2(3.0, 11.0), evolve * 2.0), OCTAVES - 2) * EROSION : 0.0;
    // thin out towards the horizon, and with distance, so the layer never ends in a hard line
    float a = smoothstep(0.0, softness * 2.0, eroded) * opacity * far * smoothstep(0.012, 0.13, d.y);
    if (a > 0.002) {
      // self-shadow: the field a step towards the sun. Denser there means this side faces away from the light.
      #if SHADE
      float toward = fbm(vec3(q + normalize(sunDir.xz + 1e-4) * 0.1, evolve), 3);
      float shade = clamp((toward - base) * 6.0 + 0.45, 0.0, 1.0);
      #else
      float shade = 0.45;
      #endif
      float thick = smoothstep(0.15, 0.9, eroded);
      vec3 lit = mix(vec3(1.0, 0.975, 0.93), sunC, 0.55) * 1.06;
      vec3 under = mix(hor, top, 0.3) * vec3(0.8, 0.82, 0.88);
      // thin rims stay light and let the sky through; only the body of a cloud shades its far side and its belly
      vec3 cc = mix(lit, under, clamp((shade * 0.85 + thick * 0.4 - 0.15) * smoothstep(0.04, 0.45, eroded), 0.0, 1.0));
      // thin edges towards the sun catch the light
      cc += sunC * pow(s, 9.0) * (1.0 - smoothstep(0.0, 0.55, a)) * 0.7;
      // distant clouds take on the haze
      cc = mix(hor, cc, 0.25 + 0.75 * far);
      glow *= 1.0 - a * 0.95;
      c = mix(c, cc, a);
    }
  }
#endif
  gl_FragColor = vec4(c + glow, 1.0);
}`;

/**
 * The sky: one inward-facing sphere that the caller keeps centred on the camera (update does it). Adds nothing to a
 * scene; `dispose()` frees its geometry and material. `sunFactor` is how much of the direct sunlight gets through:
 * multiply the sun's intensity by it.
 */
export class Sky {
  readonly mesh: THREE.Mesh<THREE.SphereGeometry, THREE.ShaderMaterial>;
  /** 1 under a clear sun, lower while a cloud is in front of it; eased, never jumps */
  sunFactor = 1;
  private readonly cfg: CloudConfig;
  private readonly sunDir: THREE.Vector3;
  private readonly wind: [number, number] = [0, 0];
  private shade = -1; // -1: not yet set; the first update starts it where it should be, with no fade-in
  private timeS = 0;

  constructor({ top, horizon, sunColour, sunDir, clouds, radius = 3000 }: SkyOptions) {
    this.cfg = { ...clouds };
    this.sunDir = sunDir;
    const on = clouds.cover !== 'off';
    const preset = CLOUD_PRESETS[on ? (clouds.cover as keyof typeof CLOUD_PRESETS) : 'partly'];
    const material = new THREE.ShaderMaterial({
      side: THREE.BackSide,
      depthWrite: false,
      fog: false,
      defines: {
        CLOUDS: on ? 1 : 0,
        SHADE: clouds.quality === 'high' ? 1 : 0,
        OCTAVES: clouds.quality === 'high' ? HIGH_OCTAVES : LOW_OCTAVES,
        ALTITUDE: CLOUD_ALTITUDE_M.toFixed(1),
        SCALE: CLOUD_SCALE_M.toFixed(1),
        FADE: CLOUD_FADE_M.toFixed(1),
        CURVE: CLOUD_CURVE.toFixed(3),
        EROSION: EROSION.toFixed(3),
      },
      uniforms: {
        top: { value: new THREE.Color(top) },
        hor: { value: new THREE.Color(horizon) },
        sunC: { value: new THREE.Color(sunColour) },
        sunDir: { value: sunDir },
        camPos: { value: new THREE.Vector3() },
        wind: { value: new THREE.Vector2() },
        seed: { value: new THREE.Vector2(...seedOffset(clouds.seed)) },
        evolve: { value: 0 },
        threshold: { value: preset.threshold },
        softness: { value: preset.softness * clouds.softness },
        cluster: { value: preset.cluster },
        opacity: { value: preset.opacity },
      },
      vertexShader: 'varying vec3 vDir; void main() { vDir = position; gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0); }',
      fragmentShader: FRAGMENT,
    });
    this.mesh = new THREE.Mesh(new THREE.SphereGeometry(radius, 32, 16), material);
    this.mesh.renderOrder = -1;
    this.mesh.frustumCulled = false;
  }

  /**
   * Centres the dome on the camera and moves the clouds to `timeS` (seconds since the game started; the wind and the
   * shapes depend only on it, never on frame count). `dt` eases the sunlight when a cloud crosses the sun.
   */
  update(camera: THREE.Vector3, timeS: number, dt: number) {
    this.mesh.position.copy(camera);
    this.timeS = timeS;
    if (this.cfg.cover === 'off') return;
    const u = this.mesh.material.uniforms;
    u.camPos.value.copy(camera);
    windOffset(this.cfg, timeS, this.wind);
    u.wind.value.set(this.wind[0], this.wind[1]);
    u.evolve.value = evolveAt(timeS);
    const d = this.sunDir;
    const cover = sunCover(this.cfg, camera.x, camera.y, camera.z, d.x, d.y, d.z, timeS);
    this.shade = this.shade < 0 ? cover : approach(this.shade, cover, dt, SUN_SHADE_TAU_S);
    this.sunFactor = 1 - CLOUD_PRESETS[this.cfg.cover].sunDim * this.shade;
  }

  /** read-only state for the test hook */
  state() {
    const { cover, seed, windFromDeg, windSpeedMps, quality } = this.cfg;
    return { cover, seed, windFromDeg, windSpeedMps, quality, timeS: this.timeS, sunShade: Math.max(0, this.shade), sunFactor: this.sunFactor };
  }

  dispose() {
    this.mesh.geometry.dispose();
    this.mesh.material.dispose();
  }
}
