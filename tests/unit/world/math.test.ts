import { describe, expect, it } from 'vitest';
import { clamp, wrap } from '../../../src/world/math';

describe('math', () => {
  it('clamps into a range', () => {
    expect(clamp(5, 0, 3)).toBe(3);
    expect(clamp(-1, 0, 3)).toBe(0);
    expect(clamp(2, 0, 3)).toBe(2);
  });

  it('wraps an angle into -π..π', () => {
    expect(wrap(3 * Math.PI / 2)).toBeCloseTo(-Math.PI / 2);
    expect(wrap(-7 * Math.PI / 2)).toBeCloseTo(Math.PI / 2);
    expect(wrap(1)).toBe(1);
  });
});
