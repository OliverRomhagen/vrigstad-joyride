import { describe, expect, it } from 'vitest';
import { fnv1a, hash01, hashInts, makeRnd } from '../../../src/world/random';

const take = (seed: number, count: number) => {
  const rnd = makeRnd(seed);
  return Array.from({ length: count }, rnd);
};

describe('makeRnd', () => {
  // both pages lay out the world from this seed; a change to the algorithm moves every building colour and tree
  it('keeps the sequence the world is built from', () => {
    expect(take(57355, 3)).toEqual([0.2670932961627841, 0.16539462911896408, 0.6030152291059494]);
  });

  it('gives the same sequence for the same seed', () => {
    expect(take(57355, 50)).toEqual(take(57355, 50));
  });

  it('gives a different sequence for another seed', () => {
    expect(take(57355, 5)).not.toEqual(take(57356, 5));
  });

  it('stays in [0, 1)', () => {
    for (const v of take(1, 10_000)) {
      expect(v).toBeGreaterThanOrEqual(0);
      expect(v).toBeLessThan(1);
    }
  });
});

describe('fnv1a', () => {
  it('matches the reference FNV-1a values', () => {
    expect(fnv1a('')).toBe(0x811c9dc5);
    expect(fnv1a('a')).toBe(0xe40c292c);
    expect(fnv1a('foobar')).toBe(0xbf9cf968);
  });

  it('joins parts with a colon and scales into [0, 1)', () => {
    expect(fnv1a(12, 'verge')).toBe(fnv1a('12:verge'));
    expect(hash01(12, 'verge')).toBeGreaterThanOrEqual(0);
    expect(hash01(12, 'verge')).toBeLessThan(1);
  });
});

describe('hashInts', () => {
  it('gives the same number for the same integers, in [0, 1), and spreads neighbours apart', () => {
    expect(hashInts(12, -7)).toBe(hashInts(12, -7));
    const values = Array.from({ length: 1000 }, (_, i) => hashInts(i, 3));
    expect(Math.min(...values)).toBeGreaterThanOrEqual(0);
    expect(Math.max(...values)).toBeLessThan(1);
    expect(values.filter(v => v < 0.5).length).toBeGreaterThan(450);
    expect(values.filter(v => v < 0.5).length).toBeLessThan(550);
  });
});
