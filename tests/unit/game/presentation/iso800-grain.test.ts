import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  cameraMoved,
  FilmGrain,
  GRAIN_STILL_UPDATES_PER_SECOND,
  GRAIN_TILE_SIZE,
  GRAIN_UPDATES_PER_SECOND,
  grainEnabled,
  grainKeyframes,
  grainPixels,
} from '../../../../src/game/presentation/iso800-grain';

describe('ISO 800 presentation texture', () => {
  it('defaults off and accepts explicit enable values', () => {
    for (const query of ['', '?grain=', '?grain=unknown']) expect(grainEnabled(query)).toBe(false);
    for (const value of ['on', 'iso800', '%20ON%20']) expect(grainEnabled('?grain=' + value)).toBe(true);
    for (const value of ['subtle', 'strong']) expect(grainEnabled('?grain=' + value)).toBe(false); // no strengths until they differ
    expect(grainEnabled('?grain=off')).toBe(false);
    expect(grainEnabled('?grain=%20OFF%20')).toBe(false);
  });

  afterEach(() => vi.unstubAllGlobals());

  it('allocates nothing when disabled', () => {
    vi.stubGlobal('document', {
      createElement: vi.fn(() => {
        throw new Error('allocation');
      }),
    });
    const grain = new FilmGrain({} as HTMLElement, false);
    expect(grain.enabled).toBe(false);
    expect(() => grain.dispose()).not.toThrow();
  });

  it('uses bounded deterministic independent discrete offsets', () => {
    const frames = grainKeyframes();
    expect(frames).toEqual(grainKeyframes());
    expect(new Set(frames.map(frame => frame.backgroundPosition)).size).toBe(frames.length);
    for (const frame of frames) {
      expect(frame.easing).toBe('steps(1, end)');
      const offsets = String(frame.backgroundPosition).match(/\d+/g)!.map(Number);
      expect(offsets.every(value => value >= 0 && value < 362)).toBe(true);
    }
  });

  it('boils slowly while still, at full rate while moving, and cleans up on disposal', () => {
    const cancel = vi.fn(),
      remove = vi.fn();
    const animation = { cancel, playbackRate: 1 };
    const animate = vi.fn(() => animation);
    const still = GRAIN_STILL_UPDATES_PER_SECOND / GRAIN_UPDATES_PER_SECOND;
    const layer = { style: {}, setAttribute: vi.fn(), animate, remove };
    const motion = { matches: false, addEventListener: vi.fn(), removeEventListener: vi.fn() };
    vi.stubGlobal('matchMedia', () => motion);
    vi.stubGlobal('document', {
      createElement: (tag: string) =>
        tag === 'canvas'
          ? {
              getContext: () => ({
                createImageData: () => ({ data: new Uint8ClampedArray(256 ** 2 * 4) }),
                putImageData: vi.fn(),
              }),
              toDataURL: () => 'data:image/png;base64,test',
            }
          : layer,
    });
    const grain = new FilmGrain({ append: vi.fn() } as unknown as HTMLElement, true);
    expect(grain.enabled).toBe(true);
    expect(animate).toHaveBeenCalledOnce();
    expect(animation.playbackRate).toBeCloseTo(still);
    grain.setMoving(true);
    expect(animation.playbackRate).toBe(1);
    grain.setMoving(false);
    expect(animation.playbackRate).toBeCloseTo(still);
    const listener = motion.addEventListener.mock.calls[0][1] as () => void;
    motion.matches = true;
    listener();
    expect(cancel).toHaveBeenCalledOnce();
    motion.matches = false;
    listener();
    expect(animate).toHaveBeenCalledTimes(2);
    grain.dispose();
    expect(cancel).toHaveBeenCalledTimes(2);
    expect(motion.removeEventListener).toHaveBeenCalledWith('change', listener);
    listener();
    expect(animate).toHaveBeenCalledTimes(2);
    expect(remove).toHaveBeenCalledOnce();
  });

  it('counts the camera as still below a millimetre and a tenth of a milliradian per frame', () => {
    const at = { x: 10, y: 2, z: -5 },
      level = { x: 0, y: 0, z: 0, w: 1 };
    const turned = (rad: number) => ({ x: 0, y: Math.sin(rad / 2), z: 0, w: Math.cos(rad / 2) });
    expect(cameraMoved(at, level, at, level)).toBe(false);
    expect(cameraMoved(at, level, { ...at, x: 10.0005 }, level)).toBe(false); // the chase camera still easing in
    expect(cameraMoved(at, level, { ...at, x: 10.01 }, level)).toBe(true);
    expect(cameraMoved(at, level, at, turned(5e-5))).toBe(false);
    expect(cameraMoved(at, level, at, turned(1e-3))).toBe(true);
    expect(cameraMoved(at, level, at, { x: 0, y: 0, z: 0, w: -1 })).toBe(false); // the same rotation, sign flipped
  });

  it('produces repeatable, neutral monochrome texture with visible fine variation and clusters', () => {
    const pixels = grainPixels();
    expect(pixels).toEqual(grainPixels());
    expect(pixels.length).toBe(GRAIN_TILE_SIZE ** 2 * 4);
    let mean = 0,
      square = 0,
      adjacent = 0,
      distant = 0;
    for (let y = 0; y < GRAIN_TILE_SIZE; y++) {
      for (let x = 0; x < GRAIN_TILE_SIZE; x++) {
        const i = (y * GRAIN_TILE_SIZE + x) * 4;
        expect(pixels[i]).toBe(pixels[i + 1]);
        expect(pixels[i]).toBe(pixels[i + 2]);
        expect(pixels[i + 3]).toBeGreaterThan(0);
        const value = pixels[i] - 127.5;
        mean += pixels[i];
        square += value * value;
        adjacent += value * (pixels[(y * GRAIN_TILE_SIZE + ((x + 1) % GRAIN_TILE_SIZE)) * 4] - 127.5);
        distant += value * (pixels[(y * GRAIN_TILE_SIZE + ((x + 64) % GRAIN_TILE_SIZE)) * 4] - 127.5);
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
