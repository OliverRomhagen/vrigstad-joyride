import { describe, expect, it } from 'vitest';
import { makeRnd } from '../../../src/world/random';

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
