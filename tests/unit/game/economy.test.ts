import { describe, expect, it } from 'vitest';
import { Commands } from '../../../src/game/commands';
import {
  carPrice,
  earn,
  FINE_PER_STAR_KR,
  fine,
  lotPrice,
  newWallet,
  pay,
  registerWalletCommands,
  SCRAP_KR,
  START_KR,
  salePrice,
  TRISS_KR,
  TRISS_PLAN,
  TRISS_TICKETS,
  trissPrize,
} from '../../../src/game/economy';
import { DMG_MAX } from '../../../src/game/health';

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
    expect(pay(w, 5)).toBe(true); // the last krona too
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
    expect(trissPrize(7_999.5 / TRISS_TICKETS)).toBe(30);
    expect(trissPrize(8_000.5 / TRISS_TICKETS)).toBe(60);
    expect(trissPrize(9_999.5 / TRISS_TICKETS)).toBe(10_000);
    expect(trissPrize(10_000.5 / TRISS_TICKETS)).toBe(0);
    expect(trissPrize(0.999999)).toBe(0);
  });

  it('pays each prize to exactly its number of tickets: one in ten wins, and about a fifth comes back', () => {
    const seen = new Map<number, number>();
    for (let i = 0; i < TRISS_TICKETS; i++) {
      const kr = trissPrize((i + 0.5) / TRISS_TICKETS);
      seen.set(kr, (seen.get(kr) ?? 0) + 1);
    }
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

describe('wallet commands', () => {
  it('adds riksdaler with kr and mynt, and takes no more than you have', () => {
    const w = { kr: 100 },
      c = new Commands();
    registerWalletCommands(c, w);
    expect(c.run('kr 50')).toBe('Wallet: 150 riksdaler.');
    expect(c.run('mynt')).toBe('Wallet: 1\u00a0150 riksdaler.');
    c.run('kr -5000');
    expect(w.kr).toBe(0);
  });
});

describe('what Skroten pays for a car', () => {
  it('pays by the model a car wears, else by its type', () => {
    expect(carPrice('saab', 'xc70', 0)).toBe(1400);
    expect(carPrice('saab', undefined, 0)).toBe(1000);
    expect(carPrice('traktor', undefined, 0)).toBe(1200);
  });

  it('takes damage off, down to the scrap price for a wreck, in round tens', () => {
    expect(carPrice('volvo', 'volvo240', DMG_MAX / 2)).toBe(450);
    expect(carPrice('volvo', 'volvo240', 33)).toBe(570);
    expect(carPrice('volvo', 'volvo240', DMG_MAX)).toBe(SCRAP_KR);
  });

  it('never buys a police car', () => {
    expect(carPrice('polis', 'xc70-police', 0)).toBeNull();
    expect(carPrice('polis', undefined, 0)).toBeNull();
  });
});

describe('what Plåt-Pelle asks for a car on his lot', () => {
  it('asks two and a half times what Skroten pays for one whole, in round hundreds, and never sells a police car', () => {
    expect(salePrice('volvo', 'volvo240')).toBe(2000);
    expect(salePrice('saab', 'saab900')).toBe(2500);
    expect(salePrice('volvo', 'impala1970')).toBe(4000);
    expect(salePrice('epa', 'duett-epa')).toBe(1500);
    expect(salePrice('saab', undefined)).toBe(2500); // by type when the model has no price
    expect(salePrice('polis', undefined)).toBeNull();
  });

  it('asks less for one that got knocked about, never under scrap, and sells no wreck', () => {
    expect(lotPrice(2000, 0)).toBe(2000);
    expect(lotPrice(2000, 30)).toBe(1400);
    expect(lotPrice(2000, 99)).toBe(SCRAP_KR);
    expect(lotPrice(2000, DMG_MAX)).toBeNull();
  });
});
