import { describe, expect, it } from 'vitest';
import { fmtKr, KORV_KR, TRISS_PLAN } from '../../../src/game/economy';
import { GAME_TABLES } from '../../../wiki/src/lib/game-tables';

describe('GAME_TABLES', () => {
  it("lists the kiosk's menu at the game's prices", () => {
    const kiosk = GAME_TABLES.kiosk();
    expect(kiosk.rows.find(r => r[0] === 'Korv me brö')?.[1]).toBe(fmtKr(KORV_KR));
  });

  it('gives every trisslott prize its chance, the biggest first, and what comes back', () => {
    const t = GAME_TABLES.trisslott();
    expect(t.rows).toHaveLength(TRISS_PLAN.length + 1);
    expect(t.rows[0]).toEqual([fmtKr(10_000), `1 in ${(10_000).toLocaleString('sv-SE')}`]);
    expect(t.rows.at(-2)).toEqual([fmtKr(30), `1 in ${(12.5).toLocaleString('sv-SE')}`]); // 8 000 tickets in 100 000
    expect(t.rows.at(-1)).toEqual(['Nothing', 'Most tickets (90 %)']); // one ticket in ten wins
    expect(t.note).toContain('about 20 %'); // 587 000 kr back on 100 000 tickets at 30 kr
  });
});
