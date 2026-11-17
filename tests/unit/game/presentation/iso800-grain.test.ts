import { describe, expect, it } from 'vitest';
import { grainEnabled, grainPixels, GRAIN_TILE_SIZE } from '../../../../src/game/presentation/iso800-grain';

describe('ISO 800 presentation texture', () => {
  it('defaults on and supports an explicit case-insensitive off comparison', () => {
    for (const query of ['', '?grain=', '?grain=iso800']) expect(grainEnabled(query)).toBe(true);
    expect(grainEnabled('?grain=off')).toBe(false);
    expect(grainEnabled('?grain=%20OFF%20')).toBe(false);
  });

  it('produces repeatable, neutral monochrome texture with visible fine variation and clusters', () => {
    const pixels = grainPixels();
    expect(pixels).toEqual(grainPixels());
    expect(pixels.length).toBe(GRAIN_TILE_SIZE ** 2 * 4);
    let mean = 0, square = 0, adjacent = 0, distant = 0;
    for (let y = 0; y < GRAIN_TILE_SIZE; y++) {
      for (let x = 0; x < GRAIN_TILE_SIZE; x++) {
        const i = (y * GRAIN_TILE_SIZE + x) * 4;
        expect(pixels[i]).toBe(pixels[i + 1]);
        expect(pixels[i]).toBe(pixels[i + 2]);
        expect(pixels[i + 3]).toBeGreaterThan(0);
        const value = pixels[i] - 127.5;
        mean += pixels[i]; square += value * value;
        adjacent += value * (pixels[(y * GRAIN_TILE_SIZE + (x + 1) % GRAIN_TILE_SIZE) * 4] - 127.5);
        distant += value * (pixels[(y * GRAIN_TILE_SIZE + (x + 64) % GRAIN_TILE_SIZE) * 4] - 127.5);
      }
    }
    const count = GRAIN_TILE_SIZE ** 2;
    expect(mean / count).toBeGreaterThan(124);
    expect(mean / count).toBeLessThan(131);
    expect(Math.sqrt(square / count)).toBeGreaterThan(20);
    expect(Math.sqrt(square / count)).toBeLessThan(40);
    expect(adjacent / count).toBeGreaterThan(distant / count + 10);
  });
});
