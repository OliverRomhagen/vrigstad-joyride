import { describe, expect, it } from 'vitest';
import { CashRain, GAWK_LINES, RAIN_LINES } from '../../../src/game/cash-rain';
import { RAIN_KR } from '../../../src/game/economy';
import { newGameState } from '../../../src/game/state';

function rain(o: { kr?: number; seen?: boolean; calm?: boolean; menuOpen?: boolean; lyingLow?: boolean } = {}) {
  const game = { ...newGameState(), started: true },
    player = { x: 3, z: 4 },
    wallet = { kr: o.kr ?? RAIN_KR },
    drops: { x: number; z: number }[] = [],
    toasts: string[] = [],
    later: string[] = [];
  const r = new CashRain({
    game,
    player,
    wallet,
    lyingLow: !!o.lyingLow,
    menuOpen: !!o.menuOpen,
    calmMotion: !!o.calm,
    dropNotes: around => drops.push({ x: around.x, z: around.z }),
    stare: () => !!o.seen,
    toast: m => toasts.push(m),
    sayLater: line => later.push(line),
    pickLine: lines => lines[0],
  });
  return { r, game, wallet, drops, toasts, later };
}

describe('låt det regna', () => {
  it('throws RAIN_KR in the air around you, and a walker who saw it says so', () => {
    const t = rain({ seen: true });
    t.r.makeItRain();
    expect(t.wallet.kr).toBe(0);
    expect(t.drops).toEqual([{ x: 3, z: 4 }]);
    expect(t.toasts).toEqual([RAIN_LINES[0]]);
    expect(t.later).toEqual([GAWK_LINES[0]]);
  });

  it('rains around the car you drive', () => {
    const t = rain();
    t.game.inCar = true;
    t.game.pcar = { x: 10, z: -2 } as typeof t.game.pcar;
    t.r.makeItRain();
    expect(t.drops).toEqual([{ x: 10, z: -2 }]);
  });

  it('throws nothing without the money, and says how much you have', () => {
    const t = rain({ kr: RAIN_KR - 1 });
    t.r.makeItRain();
    expect(t.wallet.kr).toBe(RAIN_KR - 1);
    expect(t.drops).toEqual([]);
    expect(t.toasts[0]).toMatch(/^”Låta dä regna\? Mä 999 riksdaler/);
  });

  it('does nothing before Start, under the big screen, in a safehouse or with a menu open', () => {
    const cases = [rain(), rain(), rain({ lyingLow: true }), rain({ menuOpen: true })];
    cases[0].game.started = false;
    cases[1].game.bigT = 2;
    for (const t of cases) {
      t.r.makeItRain();
      expect([t.drops, t.toasts, t.wallet.kr]).toEqual([[], [], RAIN_KR]);
    }
  });

  it('showers a big win for free, but not with reduced motion', () => {
    const t = rain({ kr: 0 });
    t.r.showerWin();
    expect(t.drops).toEqual([{ x: 3, z: 4 }]);
    const calm = rain({ calm: true });
    calm.r.showerWin();
    expect(calm.drops).toEqual([]);
  });
});
