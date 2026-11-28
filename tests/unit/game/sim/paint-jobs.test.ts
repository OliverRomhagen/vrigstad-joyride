import { describe, expect, it } from 'vitest';
import { WORKSHOP_PAINTS } from '../../../../src/game/sim/paint-jobs';
import { VEHICLE_SPECS } from '../../../../src/game/sim/vehicle-spec';
import { FRESH_COLOURS, TRACTORS, WRECK_COLOURS } from '../../../../src/game/skroten-yard';

const UNIQUE_DE = 25; // CIE76 ΔE: about where two paints stop reading as the same at a glance

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

describe('paint jobs', () => {
  it("keeps Plåt-Pelle's special paints clearly apart from every colour a car comes in, so only his workshop has them", () => {
    const stock = [
      ...Object.values(VEHICLE_SPECS).flatMap(s => s.cols),
      ...FRESH_COLOURS,
      ...WRECK_COLOURS,
      ...TRACTORS.map(t => t.colour),
    ];
    for (const { paint, name } of WORKSHOP_PAINTS)
      for (const s of stock) expect(deltaE(paint, s), `${name} against ${s}`).toBeGreaterThanOrEqual(UNIQUE_DE);
  });

  it('keeps the special paints clearly apart from each other', () => {
    for (const a of WORKSHOP_PAINTS)
      for (const b of WORKSHOP_PAINTS)
        if (a !== b) expect(deltaE(a.paint, b.paint), `${a.name} against ${b.name}`).toBeGreaterThanOrEqual(UNIQUE_DE);
  });

  it('measures colour distance as CIE76 does', () => {
    expect(deltaE('#ffffff', '#ffffff')).toBe(0);
    expect(deltaE('#000000', '#ffffff')).toBeCloseTo(100, 0); // black to white is 100 in lightness
  });
});
