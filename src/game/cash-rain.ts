// Låt det regna (#76): an easter egg, L throws RAIN_KR in the air as banknotes, and walkers nearby stop and stare.
// The big trisslott win rains them too. The notes themselves are src/game/render/banknotes.ts; no three.js or DOM here.
import type { PointXZ } from '../world/buildings';
import { fmtKr, pay, RAIN_KR, type Wallet } from './economy';
import type { GameState } from './state';

const SEEN_M = 20,
  GAWK_S = 5; // walkers this close (m) stop and stare this long (s)
export const RAIN_LINES = ['”Låt dä regna!”', '”Pengar ä bara papper, dä.”', '”Hôll i hatten, nu regnar dä sedlar!”'];
export const GAWK_LINES = ['”Va i hela friden!”', '”Ä du inte klok, människa?!”', '”Hörru, ja tar en sån där!”'];

/** What the rain reads from the rest of the game. The getters are read when used, so they follow the game. */
export interface CashRainDeps {
  game: Pick<GameState, 'started' | 'titleCardT' | 'inCar' | 'pcar'>;
  player: PointXZ;
  wallet: Wallet;
  readonly lyingLow: boolean; // inside a safehouse
  readonly menuOpen: boolean;
  readonly calmMotion: boolean; // reduced motion: the big win rains nothing (L still does, it's what you asked for)
  dropNotes(around: PointXZ): void;
  stare(around: PointXZ, radiusM: number, secs: number): boolean; // true when a walker saw it
  toast(msg: string, secs?: number): void;
  sayLater(line: string): void; // a walker's line, once the toast is gone
  pickLine(lines: readonly string[]): string;
}

/** Banknotes in the air: L throws them, a big trisslott win showers them. */
export class CashRain {
  private readonly g: CashRainDeps;

  constructor(g: CashRainDeps) {
    this.g = g;
  }

  /** L: throws RAIN_KR in the air around you, or the car you drive, if you have it and nothing else is going on. */
  makeItRain() {
    const g = this.g,
      { game } = g;
    if (!game.started || game.titleCardT > 0 || g.lyingLow || g.menuOpen) return;
    if (!pay(g.wallet, RAIN_KR)) {
      g.toast('”Låta dä regna? Mä ' + fmtKr(g.wallet.kr) + '? Nä.”', 2.5);
      return;
    }
    const you = game.inCar && game.pcar ? game.pcar : g.player;
    g.dropNotes(you);
    const seen = g.stare(you, SEEN_M, GAWK_S);
    g.toast(g.pickLine(RAIN_LINES), 2.5);
    if (seen) g.sayLater(g.pickLine(GAWK_LINES));
  }

  /** The big trisslott win: notes around you, for free. */
  showerWin() {
    if (!this.g.calmMotion) this.g.dropNotes(this.g.player);
  }
}
