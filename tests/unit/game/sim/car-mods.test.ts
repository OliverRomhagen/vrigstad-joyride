import { describe, expect, it } from 'vitest';
import {
  ENGINE_ACC,
  ENGINE_TOP,
  FINISH_METAL_MAX,
  GLOWS,
  modAcc,
  modTop,
  PAINT_UNIQUE_DE,
  PAINTS,
  RIMS,
} from '../../../../src/game/sim/car-mods';
import { VEHICLE_SPECS } from '../../../../src/game/sim/vehicle-spec';
import { FRESH_COLOURS, TRACTORS, WRECK_COLOURS } from '../../../../src/game/skroten-yard';

// CIE76 ΔE between two sRGB colours: the straight distance between them in CIE Lab (D65)
function deltaE(a: string, b: string) {
  const lab = (hex: string) => {
    const [r, g, bl] = [1, 3, 5].map(i => {
      const c = Number.parseInt(hex.slice(i, i + 2), 16) / 255;
      return c > 0.04045 ? ((c + 0.055) / 1.055) ** 2.4 : c / 12.92;
    }) as [number, number, number];
    const f = (t: number) => (t > 0.008856 ? Math.cbrt(t) : 7.787 * t + 16 / 116);
    const x = f((0.4124 * r + 0.3576 * g + 0.1805 * bl) / 0.95047),
      y = f(0.2126 * r + 0.7152 * g + 0.0722 * bl),
      z = f((0.0193 * r + 0.1192 * g + 0.9505 * bl) / 1.08883);
    return [116 * y - 16, 500 * (x - y), 200 * (y - z)];
  };
  const [p, q] = [lab(a), lab(b)];
  return Math.hypot(p[0]! - q[0]!, p[1]! - q[1]!, p[2]! - q[2]!);
}

describe('car mods', () => {
  it('leave a car without an engine step as fast as its type', () => {
    expect(modAcc(undefined)).toBe(1);
    expect(modTop({ paint: 'kiosk-gul', glow: 'rosa' })).toBe(1);
  });

  it('make a tuned engine pull harder and reach a higher top speed', () => {
    expect(modAcc({ engine: 1 })).toBe(ENGINE_ACC);
    expect(modTop({ engine: 1 })).toBe(ENGINE_TOP);
    expect(ENGINE_ACC).toBeGreaterThan(1);
    expect(ENGINE_TOP).toBeGreaterThan(1);
  });

  it('give every part a name, a price and a colour, with kebab-case ids', () => {
    for (const parts of [PAINTS, RIMS, GLOWS])
      for (const [id, p] of Object.entries(parts)) {
        expect(id).toMatch(/^[a-z]+(-[a-z]+)*$/);
        expect(p.name).not.toBe('');
        expect(p.kr).toBeGreaterThan(0);
        expect(p.hex).toMatch(/^#[0-9a-f]{6}$/);
      }
  });

  it("keep the rims' metalness low, since a metal with no environment map to reflect draws black", () => {
    for (const r of Object.values(RIMS)) expect(r.metalness).toBeLessThanOrEqual(FINISH_METAL_MAX);
  });

  it('paint in colours no car in the world drives in, and none like another', () => {
    const world = [
      ...Object.values(VEHICLE_SPECS).flatMap(s => s.cols),
      ...FRESH_COLOURS,
      ...WRECK_COLOURS,
      ...TRACTORS.map(t => t.colour),
    ];
    expect(world.length).toBeGreaterThan(30);
    const paints = Object.values(PAINTS);
    for (const p of paints) {
      for (const w of world) expect(deltaE(p.hex, w), `${p.name} against ${w}`).toBeGreaterThanOrEqual(PAINT_UNIQUE_DE);
      for (const o of paints)
        if (o !== p)
          expect(deltaE(p.hex, o.hex), `${p.name} against ${o.name}`).toBeGreaterThanOrEqual(PAINT_UNIQUE_DE);
    }
  });

  it('measures colour difference the way the uniqueness test needs', () => {
    expect(deltaE('#ffffff', '#ffffff')).toBe(0);
    expect(deltaE('#000000', '#ffffff')).toBeCloseTo(100, 0); // black to white is 100 in lightness
  });

  it('price a metallic paint above a flat one', () => {
    expect(PAINTS['slattsjo-bla'].kr).toBeGreaterThan(PAINTS['kiosk-gul'].kr);
  });
});
