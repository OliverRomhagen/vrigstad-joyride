import { describe, expect, it } from 'vitest';
import { earn, FINE_PER_STAR_KR, fine, newWallet, pay, START_KR, TRISS_KR, TRISS_PLAN, TRISS_TICKETS, trissPrize } from '../../../src/game/economy';

describe('wallet', () => {
  it('starts with some money', () => {
    expect(newWallet().kr).toBe(START_KR);
  });

  it('pays when there is enough, and takes nothing when there is not', () => {
    const w = { kr: 30 };
    expect(pay(w, 25)).toBe(true);
    expect(w.kr).toBe(5);
    expect(pay(w, 30)).toBe(false);
    expect(w.kr).toBe(5);
    expect(pay(w, 5)).toBe(true);   // the last krona too
    expect(w.kr).toBe(0);
  });

  it('refuses a negative payment, which would be earning', () => {
    const w = { kr: 10 };
    expect(pay(w, -5)).toBe(false);
    expect(w.kr).toBe(10);
  });

  it('earns, but never loses money through earn', () => {
    const w = { kr: 10 };
    earn(w, 30);
    earn(w, -100);
    expect(w.kr).toBe(40);
  });
});

describe('trisslott vinstplan', () => {
  it('has fewer winning tickets the bigger the prize', () => {
    for (let i = 1; i < TRISS_PLAN.length; i++) {
      expect(TRISS_PLAN[i][0]).toBeGreaterThan(TRISS_PLAN[i - 1][0]);
      expect(TRISS_PLAN[i][1]).toBeLessThan(TRISS_PLAN[i - 1][1]);
    }
  });

  it('reads the plan in order, and the rest of the tickets lose', () => {
    expect(trissPrize(0)).toBe(30);
    expect(trissPrize(15_999.5 / TRISS_TICKETS)).toBe(30);
    expect(trissPrize(16_000.5 / TRISS_TICKETS)).toBe(60);
    expect(trissPrize(19_999.5 / TRISS_TICKETS)).toBe(10_000);
    expect(trissPrize(20_000.5 / TRISS_TICKETS)).toBe(0);
    expect(trissPrize(0.999999)).toBe(0);
  });

  it('pays each prize to exactly its number of tickets: one in ten wins, and about a fifth comes back', () => {
    const seen = new Map<number, number>();
    for (let i = 0; i < TRISS_TICKETS; i++) { const kr = trissPrize((i + 0.5) / TRISS_TICKETS); seen.set(kr, (seen.get(kr) ?? 0) + 1); }
    for (const [kr, n] of TRISS_PLAN) expect(seen.get(kr)).toBe(n);
    expect(seen.get(0)).toBe(TRISS_TICKETS * 0.9);
    const paid = TRISS_PLAN.reduce((s, [kr, n]) => s + kr * n, 0);
    expect(paid / (TRISS_TICKETS * TRISS_KR)).toBeCloseTo(0.196, 3);
  });
});

describe('Gripen! fine', () => {
  it('takes a quarter of a big wallet', () => {
    expect(fine(2000, 1)).toBe(500);
  });

  it('takes at least the price per star', () => {
    expect(fine(400, 3)).toBe(3 * FINE_PER_STAR_KR);
  });

  it('never takes more than you have', () => {
    expect(fine(50, 2)).toBe(50);
    expect(fine(0, 3)).toBe(0);
  });
});
