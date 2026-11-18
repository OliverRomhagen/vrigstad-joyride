import { describe, expect, it } from 'vitest';
import { confettiCount } from '../../../src/game/confetti';
import { TRISS_PLAN } from '../../../src/game/economy';

describe('confetti count', () => {
  it('gives a ticket back 40 pieces, and the 10 000 kr win about 300', () => {
    expect(confettiCount(30)).toBe(40);
    expect(confettiCount(10_000)).toBeGreaterThan(280);
    expect(confettiCount(10_000)).toBeLessThan(320);
  });

  it('gives every bigger prize more', () => {
    for (let i = 1; i < TRISS_PLAN.length; i++) expect(confettiCount(TRISS_PLAN[i][0])).toBeGreaterThan(confettiCount(TRISS_PLAN[i - 1][0]));
  });
});
