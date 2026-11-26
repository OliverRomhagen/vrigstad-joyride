import { makeRnd } from '../../world/random';

// Strength is compositor opacity; scale is CSS pixels per fine grain sample,
// independent of the renderer's resolution and device pixel ratio.
const ISO800_STRENGTH = 0.4;
const ISO800_SCALE_PX = 1;
export const GRAIN_TILE_SIZE = 256;
const COARSE_GRID_SIZE = 64;
const FINE_CONTRAST = 40;
const COARSE_CONTRAST = 18;
const TEXTURE_ALPHA = 176;
export const GRAIN_UPDATES_PER_SECOND = 12;
// While the camera is still the grain keeps boiling, but slowly: frozen grain reads as a dirty screen, 12 Hz as busy.
export const GRAIN_STILL_UPDATES_PER_SECOND = 4;
// Per-frame camera change below which it counts as still. The chase camera eases towards its target and never
// stops exactly, so an exact comparison would keep it 'moving' for seconds after the car stops.
const GRAIN_STILL_MOVE_M = 0.001;
const GRAIN_STILL_TURN_RAD = 1e-4;
const GRAIN_SEQUENCE_LENGTH = 97;

// Uncorrelated jumps of two independently positioned repetitions produce boiling,
// rather than a texture drifting in a direction. CSS interpolates no positions.
export function grainKeyframes(): Keyframe[] {
  const random = makeRnd(801);
  return Array.from({ length: GRAIN_SEQUENCE_LENGTH }, () => ({
    backgroundPosition: `${Math.floor(random() * 256)}px ${Math.floor(random() * 256)}px, ${Math.floor(random() * 362)}px ${Math.floor(random() * 362)}px`,
    easing: 'steps(1, end)',
  }));
}

export function grainEnabled(search: string) {
  const value = new URLSearchParams(search).get('grain')?.trim().toLowerCase();
  return value === 'on' || value === 'iso800';
}

type Vec = { x: number; y: number; z: number };
type Quat = Vec & { w: number };
/** Whether the camera moved or turned noticeably between two frames. Plain numbers, so the effect needs no three.js. */
export function cameraMoved(fromPosition: Vec, fromRotation: Quat, toPosition: Vec, toRotation: Quat) {
  const dx = toPosition.x - fromPosition.x,
    dy = toPosition.y - fromPosition.y,
    dz = toPosition.z - fromPosition.z;
  if (dx * dx + dy * dy + dz * dz > GRAIN_STILL_MOVE_M ** 2) return true;
  const dot = Math.abs(
    fromRotation.x * toRotation.x +
      fromRotation.y * toRotation.y +
      fromRotation.z * toRotation.z +
      fromRotation.w * toRotation.w,
  );
  return 2 * Math.acos(Math.min(1, dot)) > GRAIN_STILL_TURN_RAD;
}

const playbackRate = (moving: boolean) => (moving ? 1 : GRAIN_STILL_UPDATES_PER_SECOND / GRAIN_UPDATES_PER_SECOND);

// A separate seeded stream keeps the photograph fixed without consuming game RNG.
// Periodic interpolation joins the edges without seams. Summed samples soften
// the fine distribution; the low-frequency field adds restrained grain clusters.
export function grainPixels() {
  const random = makeRnd(800);
  const coarse = Float32Array.from({ length: COARSE_GRID_SIZE ** 2 }, () => random() * 2 - 1);
  const at = (x: number, y: number) => coarse[(y % COARSE_GRID_SIZE) * COARSE_GRID_SIZE + (x % COARSE_GRID_SIZE)];
  const pixels = new Uint8ClampedArray(GRAIN_TILE_SIZE ** 2 * 4);
  for (let y = 0; y < GRAIN_TILE_SIZE; y++) {
    for (let x = 0; x < GRAIN_TILE_SIZE; x++) {
      const u = (x * COARSE_GRID_SIZE) / GRAIN_TILE_SIZE;
      const v = (y * COARSE_GRID_SIZE) / GRAIN_TILE_SIZE;
      const ix = Math.floor(u),
        iy = Math.floor(v);
      const fx = u - ix,
        fy = v - iy;
      const sx = fx * fx * (3 - 2 * fx),
        sy = fy * fy * (3 - 2 * fy);
      const cluster =
        (at(ix, iy) * (1 - sx) + at(ix + 1, iy) * sx) * (1 - sy) +
        (at(ix, iy + 1) * (1 - sx) + at(ix + 1, iy + 1) * sx) * sy;
      let fine = -3;
      for (let sample = 0; sample < 6; sample++) fine += random();
      const value = Math.max(0, Math.min(255, 127.5 + fine * FINE_CONTRAST + cluster * COARSE_CONTRAST));
      const i = (y * GRAIN_TILE_SIZE + x) * 4;
      pixels[i] = pixels[i + 1] = pixels[i + 2] = value;
      pixels[i + 3] = TEXTURE_ALPHA;
    }
  }
  return pixels;
}

/** Renderer-independent final presentation, including HTML HUD and menus. */
export class FilmGrain {
  private readonly layer?: HTMLDivElement;
  private motion?: MediaQueryList;
  private animation?: Animation;
  private moving = false;
  private readonly updateMotion = () => {
    if (!this.layer || !this.motion) return;
    this.animation?.cancel();
    this.animation = undefined;
    if (!this.motion.matches) {
      this.animation = this.layer.animate(grainKeyframes(), {
        duration: (GRAIN_SEQUENCE_LENGTH / GRAIN_UPDATES_PER_SECOND) * 1000,
        iterations: Infinity,
      });
      this.animation.playbackRate = playbackRate(this.moving);
    }
  };

  /** `enabled` comes from main.ts: `?lab=grain`, or the older `?grain=on` (grainEnabled). */
  constructor(host: HTMLElement, enabled: boolean) {
    if (!enabled) return;
    const canvas = document.createElement('canvas');
    canvas.width = canvas.height = GRAIN_TILE_SIZE;
    const context = canvas.getContext('2d');
    if (!context) return; // Keep the game usable when canvas allocation is unavailable.
    const image = context.createImageData(GRAIN_TILE_SIZE, GRAIN_TILE_SIZE);
    image.data.set(grainPixels());
    context.putImageData(image, 0, 0);
    const texture = `url("${canvas.toDataURL('image/png')}")`;
    const layer = document.createElement('div');
    layer.id = 'iso800-grain';
    layer.setAttribute('aria-hidden', 'true');
    // Two transparent repetitions at different scales avoid an obvious tile grid.
    // Only their discrete offsets change; the repeated backgrounds always fill
    // the viewport and retain their CSS-pixel scale through resize.
    Object.assign(layer.style, {
      position: 'fixed',
      inset: '0',
      zIndex: '2147483647',
      pointerEvents: 'none',
      userSelect: 'none',
      mixBlendMode: 'soft-light',
      opacity: String(ISO800_STRENGTH),
      backgroundImage: `${texture}, ${texture}`,
      backgroundRepeat: 'repeat',
      backgroundPosition: '0 0, -73px -151px',
      backgroundSize: `${GRAIN_TILE_SIZE * ISO800_SCALE_PX}px ${GRAIN_TILE_SIZE * ISO800_SCALE_PX}px, ${GRAIN_TILE_SIZE * ISO800_SCALE_PX * Math.SQRT2}px ${GRAIN_TILE_SIZE * ISO800_SCALE_PX * Math.SQRT2}px`,
    });
    host.append(layer);
    this.layer = layer;
    this.motion = matchMedia('(prefers-reduced-motion: reduce)');
    this.motion.addEventListener('change', this.updateMotion);
    this.updateMotion();
  }

  /** False when grain is off: the host can skip its per-frame motion check. */
  get enabled() {
    return !!this.layer;
  }

  /** The render host supplies camera motion without exposing scene objects: full rate while moving, slow while still. */
  setMoving(moving: boolean) {
    if (moving === this.moving) return;
    this.moving = moving;
    if (this.animation) this.animation.playbackRate = playbackRate(moving);
  }

  dispose() {
    this.motion?.removeEventListener('change', this.updateMotion);
    this.animation?.cancel();
    this.animation = undefined;
    this.motion = undefined;
    this.layer?.remove();
  }
}
