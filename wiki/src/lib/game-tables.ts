// Tables of the game's own numbers that a page can show, by the ids in its frontmatter's `tables`. Built from the game's
// constants when the wiki is built, so a price or a prize changed in the game changes here too. Plain data: the page renders it.
// Every value imported by name from the game's #game/ alias needs a /** … */ doc comment right above its own declaration,
// saying what it is and its unit (tests/unit/wiki/game-docs.test.ts). That comment is for developers; what players read is
// written here.
import { fmtKr, KORV_KR, RULLE_KR, TREATS_KR, TRISS_KR, TRISS_PLAN, TRISS_TICKETS } from '#game/economy';
import { KORV_HP, RULLE_HP } from '#game/health';
import { TREAT_BAG } from '#game/kiosk-cat-menus';

export type GameTable = {
  title: string;
  /** the column headings; the first column heads the rows */
  head: string[];
  rows: string[][];
  /** a line under the table, such as where the numbers come from */
  note?: string;
};

// in the same Swedish style as the prizes (10 000), and to one decimal when it isn't whole (1 in 12.5)
const oneIn = (tickets: number) =>
  `1 in ${(Math.round((TRISS_TICKETS / tickets) * 10) / 10).toLocaleString('sv-SE', { maximumFractionDigits: 1 })}`;

function trisslott(): GameTable {
  const winning = TRISS_PLAN.reduce((sum, [, n]) => sum + n, 0);
  const paidBack = TRISS_PLAN.reduce((sum, [kr, n]) => sum + kr * n, 0) / (TRISS_KR * TRISS_TICKETS);
  return {
    title: 'What a trisslott wins',
    head: ['Prize', 'Chance'],
    rows: [
      ...[...TRISS_PLAN].reverse().map(([kr, n]) => [fmtKr(kr), oneIn(n)]),
      ['Nothing', `Most tickets (${Math.round(((TRISS_TICKETS - winning) / TRISS_TICKETS) * 100)} %)`],
    ],
    note: `A ticket costs ${fmtKr(TRISS_KR)}. Over many tickets, about ${Math.round(paidBack * 100)} % of the money comes back.`,
  };
}

export const GAME_TABLES: Record<string, () => GameTable> = {
  kiosk: () => ({
    title: 'What the kiosk sells',
    head: ['Item', 'Price', 'Does'],
    // the names as the kiosk's menu shows them (src/game/kiosk-cat-menus.ts), in Swedish. Not all of it: what the menu
    // holds besides is for the player to find at the counter (docs/README.md, what the wiki leaves out)
    rows: [
      ['Trisslott', fmtKr(TRISS_KR), 'A scratch card: see below'],
      [`Kattgodis (${TREAT_BAG} st)`, fmtKr(TREATS_KR), 'For the cats'],
      ['Korv me brö', fmtKr(KORV_KR), `+${KORV_HP} health`],
      ['Smålandsrulle', fmtKr(RULLE_KR), `+${RULLE_HP} health`],
    ],
  }),
  trisslott,
};
