import { describe, expect, it } from 'vitest';
import { sunAt } from '../../../src/world/sun';

const highest = (day: number) => {
  let best = -90;
  for (let h = 0; h < 24; h += 1 / 60) best = Math.max(best, sunAt(day, h).elevationDeg);
  return best;
};

describe('sunAt', () => {
  // highest sun = 90° − latitude ± 23.44° declination at the solstices
  it('reaches the right height at the solstices', () => {
    expect(highest(172)).toBeCloseTo(56.1, 0);
    expect(highest(355)).toBeCloseTo(9.2, 0);
  });

  it('rises in the east, stands in the south at midday and sets in the west', () => {
    expect(sunAt(196, 8).x).toBeGreaterThan(0.5);
    const noon = sunAt(196, 13.1);   // solar noon in summer time at 14.5° E
    expect(noon.z).toBeGreaterThan(0);
    expect(Math.abs(noon.x)).toBeLessThan(0.02);
    expect(sunAt(196, 18).x).toBeLessThan(-0.5);
  });

  it('gives a unit vector that agrees with the elevation', () => {
    for (const h of [3, 9, 15, 23]) {
      const p = sunAt(196, h);
      expect(Math.hypot(p.x, p.y, p.z)).toBeCloseTo(1, 9);
      expect((Math.asin(p.y) * 180) / Math.PI).toBeCloseTo(p.elevationDeg, 9);
    }
  });

  it('is below the horizon at midnight and above it from 05:00 to 19:00 in mid July', () => {
    expect(sunAt(196, 0).elevationDeg).toBeLessThan(0);
    for (let h = 5; h <= 19; h += 0.25) expect(sunAt(196, h).elevationDeg).toBeGreaterThan(0);
  });
});
