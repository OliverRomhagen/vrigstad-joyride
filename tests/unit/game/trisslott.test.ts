import { describe, expect, it } from 'vitest';
import { TEMPER_LINES, Trisslott, temper } from '../../../src/game/trisslott';
import { makeRnd } from '../../../src/world/random';

// Every ticket loses unless `win` is set; the clock is moved by hand.
function lotto(win = false) {
  const rnd = makeRnd(1),
    clock = { t: 0 };
  const toasts: string[] = [],
    drawn: [number, number][] = [];
  const t = new Trisslott({
    random: () => (win ? 0 : 0.5),
    pick: a => a[Math.floor(rnd() * a.length)],
    now: () => clock.t,
    toast: m => toasts.push(m),
    draw: (b, w) => drawn.push([b, w]),
  });
  // buys a ticket and scratches it to the end
  const play = () => {
    t.scratch();
    t.update(1);
    return toasts.at(-1)?.slice(1, -1) ?? '';
  };
  return { t, clock, toasts, drawn, play };
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
    expect(drawn).toEqual([[1, 0]]);
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

  it('counts a win', () => {
    const { toasts, drawn, play } = lotto(true);
    play();
    expect(drawn).toEqual([[1, 1]]);
    expect(toasts.at(-1)).toMatch(/^”VINST!/);
  });
});
