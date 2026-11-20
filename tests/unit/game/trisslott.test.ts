import { describe, expect, it } from 'vitest';
import { pay, TRISS_KR, TRISS_PLAN, TRISS_TICKETS } from '../../../src/game/economy';
import { BIG_WIN_KR, TEMPER_LINES, Trisslott, temper } from '../../../src/game/trisslott';
import { makeRnd } from '../../../src/world/random';

// Every ticket loses unless `roll` is set (0 wins the smallest prize, see trissPrize); the clock is moved by hand.
function lotto(roll = 0.5, kr = 1000) {
  const rnd = makeRnd(1),
    clock = { t: 0 },
    wallet = { kr };
  const toasts: string[] = [],
    drawn: [number, number, number][] = [],
    wins: number[] = [];
  const t = new Trisslott({
    random: () => roll,
    pick: a => a[Math.floor(rnd() * a.length)],
    now: () => clock.t,
    toast: m => toasts.push(m),
    buy: () => pay(wallet, TRISS_KR),
    win: n => wins.push(n),
    draw: (b, w, k) => drawn.push([b, w, k]),
  });
  // buys a ticket and scratches it to the end
  const play = () => {
    t.scratch();
    t.update(1);
    return toasts.at(-1)?.slice(1, -1) ?? '';
  };
  return { t, clock, wallet, toasts, drawn, wins, play };
}

describe('trisslott', () => {
  it('gets crosser at 3, 5 and 8 losing tickets', () => {
    expect([1, 2, 3, 4, 5, 7, 8, 20].map(temper)).toEqual([0, 0, 1, 1, 2, 2, 3, 3]);
  });

  it('shows the result after 0.9 s of scratching, and ignores a second scratch meanwhile', () => {
    const { t, toasts, drawn } = lotto();
    t.scratch();
    t.scratch();
    t.update(0.8);
    expect(drawn).toEqual([]);
    t.update(0.2);
    expect(drawn).toEqual([[1, 0, 0]]);
    expect(toasts.filter(m => m.startsWith('Skrap'))).toHaveLength(1);
  });

  it('starts calm, never says the same line twice in a row, and swears by the eighth loss in a row', () => {
    const { play } = lotto(),
      said = Array.from({ length: 8 }, play);
    expect(said[0]).toBe(TEMPER_LINES[0][0]);
    for (let i = 1; i < said.length; i++) expect(said[i]).not.toBe(said[i - 1]);
    expect(TEMPER_LINES[3]).toContain(said[7]);
  });

  it('calms down once 25 s pass between losing tickets', () => {
    const { clock, play } = lotto();
    for (let i = 0; i < 7; i++) play();
    clock.t = 26;
    expect(TEMPER_LINES[0]).toContain(play());
  });

  it('pays out a win and counts it', () => {
    const { toasts, drawn, wins, play } = lotto(0);
    play();
    expect(wins).toEqual([30]);
    expect(drawn).toEqual([[1, 1, 30]]);
    expect(toasts.at(-1)).toMatch(/^”Vinst! 30 riksdaler/);
  });

  it('gives a big win the big toast', () => {
    const before = TRISS_PLAN.slice(0, -1).reduce((n, [, c]) => n + c, 0); // tickets ahead of the top prize in the vinstplan
    const { toasts, wins, play } = lotto(before / TRISS_TICKETS);
    play();
    expect(wins).toEqual([BIG_WIN_KR]);
    expect(toasts.at(-1)).toMatch(/^”VINST!.*You won 10\u00a0000 riksdaler/);
  });

  it('scratches nothing without the money for a ticket', () => {
    const { t, wallet, toasts } = lotto(0.5, TRISS_KR - 1);
    t.scratch();
    expect(t.scratching).toBe(0);
    expect(toasts).toEqual([]);
    expect(wallet.kr).toBe(TRISS_KR - 1);
  });
});
