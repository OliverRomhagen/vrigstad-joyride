// Sunlight streaks (#212): broad, soft photographic god rays and glare from the sun's direction, and a sun disc in the
// sky. Art-directed, not volumetric: the look is Art Direction Lab v21's "Warm Nostalgia + Dusty Late Summer". The
// streaks are one full-screen quad drawn last in the normal render, screen-blended over the world and evaluated
// analytically in the shader (no blur, no canvas, no extra pass, no readback); the HUD is DOM, so it stays on top.
// The sun's direction is the day cycle's (SUN_DIR, shared, not copied) and its strength the day cycle's direct light
// times the clouds' shade, so the streaks, the disc, the sky's glow and the shadows all follow one sun.
import * as THREE from 'three';
import { col } from '../../world/three-legacy';

/**
 * The lab's five rays, measured for a 16:9 frame: angle off the fan's axis (rad), length and width (in frame heights,
 * width as the Gaussian's spread in rad) and opacity. Uneven on purpose: an even fan reads as a starburst. Wide and
 * faint, so neighbours overlap into one feathered fan instead of a few separate bright columns.
 */
const RAYS: readonly (readonly [angle: number, length: number, spread: number, opacity: number])[] = [
  [-0.735, 1.64, 0.2, 0.26],
  [-0.365, 1.46, 0.16, 0.34],
  [0.052, 1.47, 0.21, 0.29],
  [0.496, 1.48, 0.17, 0.28],
  [0.846, 1.8, 0.15, 0.2],
];
// Below FORWARD_KNEE (about 53° off the view axis, past the corners of a 2.2:1 frame) the projection's divisor eases
// towards FORWARD_FLOOR instead of passing through 0, so a sun beside or behind the camera stays finite and on its own
// side of the frame, never mirrored. Above the knee it is the exact perspective projection, so in frame the streaks
// leave from the disc.
const FORWARD_KNEE = 0.6,
  FORWARD_FLOOR = 0.15;
// The rays are a low-sun effect: full below about 20° (sun y 0.35), approaching 12% at about 53° (y 0.8), so
// midday shows only a hint and late afternoon gets the drama. Tuned to the game's day (day-cycle.ts): its sun stands at
// y 0.79 at noon, 0.58 at 17:00 and 0.33 at 19:00. Noon approaches the high-sun floors (12% rays, 50% halo)
// without quite reaching them, and the evening sun never sinks below y 0.33.
const LOW_SUN_Y = 0.35,
  HIGH_SUN_Y = 0.8,
  HIGH_SUN_RAYS = 0.12,
  HIGH_SUN_HALO = 0.5;
const DISC_DIST_M = 2000; // inside the sky dome (3000 m) and the far plane; nearer things hide the disc
const DISC_SIZE = 0.19; // the disc sprite's width over its distance: the lab's 29 at 150

export interface SunStreakOptions {
  /** unit direction to the sun; shared, not copied */
  sunDir: THREE.Vector3;
  /** overall opacity of the streaks and glare */
  strength?: number;
  /** times each ray's width */
  rayWidth?: number;
  /** times each ray's length */
  rayReach?: number;
}

/** Where the streaks start and how strong they are; see sunSource. */
export interface SunSource {
  x: number;
  y: number;
  presence: number;
  glare: number;
}

const smoothstep = (a: number, b: number, x: number) => {
  const t = Math.min(1, Math.max(0, (x - a) / (b - a)));
  return t * t * (3 - 2 * t);
};

/**
 * The streaks' source on screen, from the sun's direction in camera axes (`right`, `up`, `forward`: dot products with
 * the camera's unit axes) and tan of half the vertical field of view. x and y are in frame heights from the centre, y up,
 * so the frame spans y ±0.5 and x ±aspect/2; off screen they stay finite and keep moving smoothly (never clamped).
 * `presence` (soft directional streaks) fades out as the camera turns away; `glare` (the bright halo) only looks
 * towards the sun. Both are continuous in the direction.
 */
export function sunSource(right: number, up: number, forward: number, tanV: number, out: SunSource): SunSource {
  const m = FORWARD_KNEE - FORWARD_FLOOR;
  const f = forward >= FORWARD_KNEE ? forward : FORWARD_KNEE - m * Math.tanh((FORWARD_KNEE - forward) / m);
  out.x = (0.5 * right) / (f * tanV);
  out.y = (0.5 * up) / (f * tanV);
  out.presence = smoothstep(-0.75, 0.55, forward);
  out.glare = smoothstep(0.55, 0.95, forward);
  return out;
}

const glsl = String.raw;
const VERTEX = glsl`
uniform float aspect;
varying vec2 q;
void main() { q = position.xy * vec2(aspect, 1.0) * 0.5; gl_Position = vec4(position.xy, 0.0, 1.0); }`;
// halo and glare profiles fit the lab's canvas gradients; colours are its near-white at the source, pale gold further out
const FRAGMENT = glsl`
uniform vec2 src, axis;
uniform float aspect, presence, glare, reach, width;
uniform vec4 rays[${RAYS.length}];
varying vec2 q;
void main() {
  vec2 v = q - src;
  float d = length(v);
  float phi = atan(dot(v, vec2(-axis.y, axis.x)), dot(v, axis) + 1e-6); // atan(0, 0) is undefined in GLSL
  // rays carry the sunlight while the sun is out of frame; facing it, the halo takes over and the rays step back,
  // so the image keeps its darks instead of washing out
  float rayGain = max(presence - 0.4 * glare, 0.0);
  float keep = 1.0;
  for (int i = 0; i < ${RAYS.length}; i++) {
    vec4 r = rays[i];
    float t = min(d / (r.y * reach), 1.0);
    float a = (phi - r.x) / (r.z * width);
    keep *= 1.0 - r.w * pow(1.0 - t, 1.5) * exp(-a * a) * rayGain;
  }
  float halo = 0.65 * pow(max(1.0 - d / (0.6 * max(aspect, 1.0)), 0.0), 2.6) * (0.3 * presence + 0.7 * glare);
  float local = 0.6 * pow(max(1.0 - d / (0.29 * min(aspect, 1.0)), 0.0), 3.9) * glare;
  float alpha = 1.0 - keep * (1.0 - halo) * (1.0 - local);
  vec3 c = mix(vec3(1.0, 0.99, 0.92), vec3(1.0, 0.86, 0.64), smoothstep(0.0, 1.2, d));
  gl_FragColor = vec4(c * alpha, 1.0);
}`;

// a soft white disc with a warm aureole, the lab's radial gradient; built as data, so it needs no canvas
function discTexture() {
  const n = 128,
    px = new Uint8Array(n * n * 4);
  const stops: [number, number, number, number, number][] = [
    [0, 255, 255, 255, 1],
    [0.095, 255, 255, 245, 1],
    [0.15, 255, 249, 224, 0.98],
    [0.23, 255, 231, 187, 0.48],
    [0.43, 255, 220, 157, 0.13],
    [0.73, 255, 216, 153, 0.025],
    [1, 255, 216, 153, 0],
  ];
  for (let y = 0; y < n; y++)
    for (let x = 0; x < n; x++) {
      const r = Math.min(1, Math.hypot(x + 0.5 - n / 2, y + 0.5 - n / 2) / (n / 2));
      let k = 1;
      while (k < stops.length - 1 && stops[k][0] < r) k++;
      const a = stops[k - 1],
        b = stops[k],
        t = (r - a[0]) / (b[0] - a[0]),
        i = (y * n + x) * 4;
      for (let c = 1; c < 5; c++) px[i + c - 1] = Math.round((a[c] + (b[c] - a[c]) * t) * (c === 4 ? 255 : 1));
    }
  const tex = new THREE.DataTexture(px, n, n);
  tex.colorSpace = THREE.SRGBColorSpace;
  tex.magFilter = tex.minFilter = THREE.LinearFilter;
  tex.needsUpdate = true;
  return tex;
}

const _axis = new THREE.Vector3();
const _white = col(0xffffff);

/**
 * Owns the streak quad and the sun disc; add `object` to the scene once, call `update` every frame after the camera is
 * placed, `dispose` to free the GPU resources. It reads the camera's aspect every frame, so a resize needs no call.
 */
export class SunStreaks {
  readonly object = new THREE.Group();
  private readonly quad: THREE.Mesh<THREE.PlaneGeometry, THREE.ShaderMaterial>;
  private readonly disc: THREE.Sprite;
  private readonly sunDir: THREE.Vector3;
  private readonly strength: number;
  private readonly reach: number;
  private readonly source: SunSource = { x: 0, y: 0, presence: 0, glare: 0 };
  private light = 0;

  constructor({ sunDir, strength = 1, rayWidth = 1, rayReach = 1 }: SunStreakOptions) {
    this.sunDir = sunDir;
    this.strength = strength;
    this.reach = rayReach;
    const material = new THREE.ShaderMaterial({
      uniforms: {
        src: { value: new THREE.Vector2() },
        axis: { value: new THREE.Vector2(0, -1) },
        aspect: { value: 1 },
        presence: { value: 0 },
        glare: { value: 0 },
        reach: { value: rayReach },
        width: { value: rayWidth },
        rays: { value: RAYS.map(r => new THREE.Vector4(...r)) },
      },
      vertexShader: VERTEX,
      fragmentShader: FRAGMENT,
      depthTest: false,
      depthWrite: false,
      transparent: true,
      // screen: 1 - (1 - dst)(1 - src), as the lab's mix-blend-mode: screen; it brightens without ever clipping colour
      blending: THREE.CustomBlending,
      blendSrc: THREE.OneMinusDstColorFactor,
      blendDst: THREE.OneFactor,
    });
    this.quad = new THREE.Mesh(new THREE.PlaneGeometry(2, 2), material);
    this.quad.frustumCulled = false;
    this.quad.renderOrder = 1e6; // after everything else in the frame
    this.disc = new THREE.Sprite(
      new THREE.SpriteMaterial({ map: discTexture(), depthWrite: false, fog: false, toneMapped: false }),
    );
    this.disc.scale.setScalar(DISC_DIST_M * DISC_SIZE);
    this.disc.frustumCulled = false;
    this.object.add(this.disc, this.quad);
  }

  /**
   * `direct` is the sun's direct light, 0–1: the day cycle's (Sky.sun) times the clouds' shade (Sky.sunFactor). At 0,
   * as midway through the night skip, everything here fades out. `cloudCover` (Sky.sunShade, how much a cloud covers
   * the sun) hides the disc, which depth can't since the clouds are drawn in the sky dome before it, and takes the rays
   * and glare away with it: a covered sun casts no streaks. `sunColour` tints the disc.
   */
  update(camera: THREE.PerspectiveCamera, direct: number, cloudCover: number, sunColour: THREE.Color) {
    const d = this.sunDir,
      q = camera.quaternion,
      s = this.source;
    this.light = smoothstep(0, 1, direct);
    this.disc.position.copy(camera.position).addScaledVector(d, DISC_DIST_M);
    this.disc.material.color.copy(sunColour).lerp(_white, 0.42);
    this.disc.material.opacity = this.light * (1 - cloudCover);
    this.disc.visible = this.disc.material.opacity > 0;
    const right = _axis.set(1, 0, 0).applyQuaternion(q).dot(d),
      up = _axis.set(0, 1, 0).applyQuaternion(q).dot(d),
      forward = -_axis.set(0, 0, 1).applyQuaternion(q).dot(d);
    sunSource(right, up, forward, Math.tan(THREE.MathUtils.degToRad(camera.fov) / 2), s);
    const u = this.quad.material.uniforms,
      shade = 1 - cloudCover,
      k = this.light * this.strength * shade,
      low = 1 - smoothstep(LOW_SUN_Y, HIGH_SUN_Y, d.y);
    u.src.value.set(s.x, s.y);
    u.aspect.value = camera.aspect;
    // direct already includes Sky.sunFactor; these extra shade factors apply twice to rays and once to glare,
    // so a half-covered sun keeps a halo but casts few streaks
    u.presence.value = s.presence * k * shade * (HIGH_SUN_RAYS + (1 - HIGH_SUN_RAYS) * low);
    u.glare.value = s.glare * k * (HIGH_SUN_HALO + (1 - HIGH_SUN_HALO) * low);
    // the fan opens towards a point half a frame below the bottom edge: straight down for a sun above the frame, as in
    // the lab, and across the frame for one beside it. The sun is never that low in view (it stays above the horizon,
    // the camera looks down), so the axis never degenerates.
    const ax = -s.x,
      ay = -1 - s.y,
      len = Math.hypot(ax, ay) || 1;
    u.axis.value.set(ax / len, ay / len);
    // a source far off screen lengthens the rays (same angles) so they still reach into the frame, but they fade on the way
    u.reach.value = this.reach * Math.max(1, 0.6 * Math.hypot(s.x, s.y) + 1);
    this.quad.visible = u.presence.value > 0.002 || u.glare.value > 0.002;
  }

  /** read-only state for the test hook */
  state() {
    const { x, y, presence, glare } = this.source;
    return { x, y, presence, glare, light: this.light, streaks: this.quad.visible, disc: this.disc.visible };
  }

  dispose() {
    this.object.removeFromParent();
    this.quad.geometry.dispose();
    this.quad.material.dispose();
    this.disc.material.map?.dispose();
    this.disc.material.dispose();
  }
}
