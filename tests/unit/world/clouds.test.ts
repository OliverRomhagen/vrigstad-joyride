import { describe, expect, it } from 'vitest';
import {
  CLOUD_COVERS,
  CLOUD_PRESETS,
  CLOUD_SCALE_M,
  type CloudConfig,
  cloudAlpha,
  cloudField,
  DEFAULT_CLOUDS,
  FIELD_PERIOD,
  parseCloudConfig,
  seedOffset,
  sunCover,
  windOffset,
} from '../../../src/world/clouds';

const q = (s: string) => new URLSearchParams(s);
const cfg = (over: Partial<CloudConfig> = {}): CloudConfig => ({ ...DEFAULT_CLOUDS, ...over });

/** share of the cloud layer that is mostly cloud, over a 42 km square and three seeds */
function coverage(cover: keyof typeof CLOUD_PRESETS) {
  let n = 0;
  let hit = 0;
  for (const seed of [1, 2, 3]) {
    for (let i = 0; i < 60; i++) {
      for (let j = 0; j < 60; j++) {
        const f = cloudField(i * 700, j * 700, 0, 0, 3, seedOffset(seed));
        if (cloudAlpha(f.base, f.cluster, f.detail, CLOUD_PRESETS[cover]) > 0.5 * CLOUD_PRESETS[cover].opacity) hit++;
        n++;
      }
    }
  }
  return hit / n;
}

describe('parseCloudConfig', () => {
  it('defaults to a partly cloudy late-summer sky', () => {
    expect(parseCloudConfig(q(''))).toEqual(DEFAULT_CLOUDS);
    expect(DEFAULT_CLOUDS.cover).toBe('partly');
    expect(parseCloudConfig(q(''), true).quality).toBe('low'); // touch screens draw the cheaper sky
  });

  it('reads every setting, and keeps the default for anything unreadable', () => {
    expect(parseCloudConfig(q('clouds=mostly&cloudSeed=7&wind=-90,12&cloudSoft=1.5&cloudQuality=low'))).toEqual({
      cover: 'mostly',
      seed: 7,
      windFromDeg: 270,
      windSpeedMps: 12,
      softness: 1.5,
      quality: 'low',
    });
    expect(parseCloudConfig(q('clouds=stormy&cloudSeed=x&wind=a,b&cloudSoft=-2&cloudQuality=ultra'))).toEqual(
      DEFAULT_CLOUDS,
    );
    expect(parseCloudConfig(q('clouds=off')).cover).toBe('off');
    expect(parseCloudConfig(q('wind=90,999')).windSpeedMps).toBe(40);
  });
});

describe('the cloud field', () => {
  it('is the same for the same seed and different for another', () => {
    const a = cloudField(123, -456, 1.5, 2.5, 7, seedOffset(1));
    expect(cloudField(123, -456, 1.5, 2.5, 7, seedOffset(1))).toEqual(a);
    expect(cloudField(123, -456, 1.5, 2.5, 7, seedOffset(2)).base).not.toBe(a.base);
  });

  it('repeats exactly every FIELD_PERIOD, so wrapping the wind offset never shows', () => {
    for (const [x, z] of [
      [0, 0],
      [3100, -870],
      [-12000, 4400],
    ]) {
      const a = cloudField(x, z, 3.25, 0.5, 2, seedOffset(4));
      const b = cloudField(x, z, 3.25 + FIELD_PERIOD, 0.5 - FIELD_PERIOD, 2 + FIELD_PERIOD, seedOffset(4));
      expect(b.base).toBeCloseTo(a.base, 9);
      expect(b.detail).toBeCloseTo(a.detail, 9);
      expect(b.cluster).toBeCloseTo(a.cluster, 9);
    }
  });

  it('gives each preset a meaningfully different share of the sky, in order', () => {
    const share = CLOUD_COVERS.map(coverage);
    expect(share).toEqual([...share].sort((a, b) => a - b));
    const [clear, scattered, partly, mostly] = share;
    expect(clear).toBeLessThan(0.15);
    expect(scattered).toBeGreaterThan(0.12);
    expect(scattered).toBeLessThan(0.32);
    expect(partly).toBeGreaterThan(0.32);
    expect(partly).toBeLessThan(0.55);
    expect(mostly).toBeGreaterThan(0.58);
  });
});

describe('wind and time', () => {
  it('carries the clouds downwind: a westerly moves them east', () => {
    const [u0] = windOffset({ windFromDeg: 270, windSpeedMps: 10 }, 0);
    const [u1, v1] = windOffset({ windFromDeg: 270, windSpeedMps: 10 }, 100);
    expect(u1 - u0).toBeCloseTo((10 * 100) / CLOUD_SCALE_M, 9);
    expect(Math.min(v1, FIELD_PERIOD - v1)).toBeCloseTo(0, 9); // offsets wrap: a hair below zero is just under FIELD_PERIOD
    const [, vn] = windOffset({ windFromDeg: 180, windSpeedMps: 10 }, 100); // from the south: towards north, -z
    expect(vn).toBeCloseTo(FIELD_PERIOD - (10 * 100) / CLOUD_SCALE_M, 6);
  });

  it('moves continuously: the sky a frame apart barely changes, at any frame rate', () => {
    const c = cfg();
    let worst = 0;
    for (let t = 0; t < 120; t += 1 / 30) {
      const a = sunCover(c, 0, 20, 0, 0.3, 0.9, 0.3, t);
      const b = sunCover(c, 0, 20, 0, 0.3, 0.9, 0.3, t + 1 / 30);
      worst = Math.max(worst, Math.abs(a - b));
    }
    expect(worst).toBeLessThan(0.05);
  });
});

describe('sunCover', () => {
  it('is nothing with clouds off or the sun on the horizon, and between 0 and 1 otherwise', () => {
    expect(sunCover(cfg({ cover: 'off' }), 0, 0, 0, 0, 1, 0, 10)).toBe(0);
    expect(sunCover(cfg(), 0, 0, 0, 1, 0, 0, 10)).toBe(0);
    for (let i = 0; i < 50; i++) {
      const v = sunCover(cfg({ cover: 'mostly' }), i * 97, 10, -i * 53, 0.2, 0.8, -0.3, i);
      expect(v).toBeGreaterThanOrEqual(0);
      expect(v).toBeLessThanOrEqual(1);
    }
  });

  it('reads the field with the octaves of the quality the sky draws', () => {
    const covers = (quality: CloudConfig['quality']) => {
      const out: number[] = [];
      for (let t = 0; t < 2000; t += 10)
        out.push(sunCover(cfg({ cover: 'partly', quality }), 0, 20, 0, -0.5, 0.75, 0.4, t));
      return out;
    };
    expect(covers('low')).not.toEqual(covers('high'));
  });

  it('gives the same cover with the wind and seed offsets passed in', () => {
    const c = cfg({ cover: 'mostly' });
    for (let t = 0; t < 200; t += 7) {
      const passed = sunCover(c, 5, 20, -3, 0.2, 0.8, -0.3, t, windOffset(c, t), seedOffset(c.seed));
      expect(passed).toBe(sunCover(c, 5, 20, -3, 0.2, 0.8, -0.3, t));
    }
  });

  it('covers the sun more often under a cloudier sky', () => {
    const often = (cover: CloudConfig['cover']) => {
      let n = 0;
      for (let t = 0; t < 4000; t += 20) n += sunCover(cfg({ cover }), 0, 20, 0, -0.5, 0.75, 0.4, t);
      return n;
    };
    expect(often('clear')).toBeLessThan(often('scattered'));
    expect(often('scattered')).toBeLessThan(often('partly'));
    expect(often('partly')).toBeLessThan(often('mostly'));
  });
});
