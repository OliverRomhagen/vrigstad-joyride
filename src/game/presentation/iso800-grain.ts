import { makeRnd } from '../../world/random';

// Strength is compositor opacity; scale is CSS pixels per fine grain sample,
// independent of the renderer's resolution and device pixel ratio.
export const ISO800_STRENGTH = 0.52;
export const ISO800_SCALE_PX = 1;
export const GRAIN_TILE_SIZE = 256;
const COARSE_GRID_SIZE = 64;
const FINE_CONTRAST = 40;
const COARSE_CONTRAST = 18;
const TEXTURE_ALPHA = 176;

export function grainEnabled(search: string) {
  return new URLSearchParams(search).get('grain')?.trim().toLowerCase() !== 'off';
}

// A separate seeded stream keeps the photograph fixed without consuming game RNG.
// Periodic interpolation joins the edges without seams. Summed samples soften
// the fine distribution; the low-frequency field adds restrained grain clusters.
export function grainPixels() {
  const random = makeRnd(800);
  const coarse = Float32Array.from({ length: COARSE_GRID_SIZE ** 2 }, () => random() * 2 - 1);
  const at = (x: number, y: number) => coarse[(y % COARSE_GRID_SIZE) * COARSE_GRID_SIZE + x % COARSE_GRID_SIZE];
  const pixels = new Uint8ClampedArray(GRAIN_TILE_SIZE ** 2 * 4);
  for (let y = 0; y < GRAIN_TILE_SIZE; y++) {
    for (let x = 0; x < GRAIN_TILE_SIZE; x++) {
      const u = x * COARSE_GRID_SIZE / GRAIN_TILE_SIZE;
      const v = y * COARSE_GRID_SIZE / GRAIN_TILE_SIZE;
      const ix = Math.floor(u), iy = Math.floor(v);
      const fx = u - ix, fy = v - iy;
      const sx = fx * fx * (3 - 2 * fx), sy = fy * fy * (3 - 2 * fy);
      const cluster = (at(ix, iy) * (1 - sx) + at(ix + 1, iy) * sx) * (1 - sy)
        + (at(ix, iy + 1) * (1 - sx) + at(ix + 1, iy + 1) * sx) * sy;
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

  constructor(host: HTMLElement, search = location.search) {
    if (!grainEnabled(search)) return;
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
    // They are rasterized once, not regenerated or moved on game frames or resize.
    Object.assign(layer.style, {
      position: 'fixed', inset: '0', zIndex: '2147483647',
      pointerEvents: 'none', userSelect: 'none',
      mixBlendMode: 'soft-light', opacity: String(ISO800_STRENGTH),
      backgroundImage: `${texture}, ${texture}`,
      backgroundRepeat: 'repeat', backgroundPosition: '0 0, -73px -151px',
      backgroundSize: `${GRAIN_TILE_SIZE * ISO800_SCALE_PX}px ${GRAIN_TILE_SIZE * ISO800_SCALE_PX}px, ${GRAIN_TILE_SIZE * ISO800_SCALE_PX * Math.SQRT2}px ${GRAIN_TILE_SIZE * ISO800_SCALE_PX * Math.SQRT2}px`,
    });
    host.append(layer);
    this.layer = layer;
  }

  dispose() {
    this.layer?.remove();
  }
}
