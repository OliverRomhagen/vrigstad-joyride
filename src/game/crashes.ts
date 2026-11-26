// A crash: both cars take the damage (crashCars in health.ts), and the player too if they're in one. This adds what you
// hear and feel: a line, the hurt, the camera's jolt. Also what you say to your cat while it rides along.
// Moved from src/game/main.ts (#177); main.ts passes in the HUD's toast, the player's hurt and the camera's shake.
import { makeRnd } from '../world/random';
import type { Car } from './cars';
import type { Cat } from './cats';
import { crashCars, crashDamage, driverHurt, smokeLevel } from './health';
import type { GameState } from './state';

type Point = { x: number; z: number };

const POLICE_WRECK_SEEN_M = 80; // "the police car is wrecked" only when it happens this close to the camera
const CRASH_LINE_S = 6; // at most one "that hurt" line this often (s)
const CRASH_LINES = [
  '”AJ! Dä där kändes i nacken.”',
  '”Hoppsan. Dä där va inte meningen.”',
  '”Va fan, vem satte dit den där?!”',
  '”Oj oj, nu blev ho lite fördärvad.”',
];
const WRECK_LINES = [
  '”Nä, nu ä den kaputt.”',
  '”Dä va dä, den bilen.”',
  '”Den rullar inte mer, den.”',
  '”Ajaj, nu ä denna bilen fördärvad.”',
  '”Nu ä ho fördärvad, hela bilen.”',
];
const POLICE_WRECK_LINES = ['”Hoppsan, nu ä länsmans bil fördärvad.”', '”Dä där fick snuten inte betalt för.”'];
const SMOKE_LINES = [null, '”Hörru, dä ryker ur motorn!”', '”Svart rök… dä ä inte bra, dä.”']; // by smokeLevel
const CAT_FAST_MS = 25,
  CAT_CALM_MS = 20; // above ~90 km/h with your cat along you tell it to hold on; it can come again once you've been below ~72 km/h

/** What a crash reads from the rest of the game. The getters are read when a crash happens. */
export interface CrashDeps {
  game: Pick<GameState, 'clockS' | 'inCar' | 'pcar'>;
  colony: { readonly owned: (Cat & { ride: unknown }) | null };
  readonly viewer: Point; // the camera, which decides whether you saw a police car wreck
  toast(msg: string, secs?: number): void;
  hurtPlayer(n: number): void;
  readonly god: boolean; // god mode: the car you drive takes no damage
  shake(dmg: number): void; // the camera's jolt
}

/** What crashes make you say and feel; `pickLine` picks a line from its own stream. */
export class Crashes {
  private readonly g: CrashDeps;
  private crashLineAt = -9;
  private catFastSaid = false;
  // what you say about a crash (#213 moves these into a speech bubble over you); picked from their own random stream, so they don't shift the world's rolls
  private readonly lineRnd = makeRnd(213);

  constructor(g: CrashDeps) {
    this.g = g;
  }

  pickLine = <T>(a: readonly T[]) => a[Math.floor(this.lineRnd() * a.length)];
  // your cat riding in your car: then the lines are about it (you first, then the cat, each on their own line)
  private catAboard = () => {
    const { colony, game } = this.g;
    return colony.owned && colony.owned.ride === game.pcar ? colony.owned : null;
  };

  // the car you drive in god mode, and Plåt-Pelle's cars for sale: he sells them as new, so a dented one never comes cheap
  private spared = (k: Car) => k.saleKr > 0 || (this.g.god && k === this.g.game.pcar);

  // one hit: both cars take the damage, and the player too if they're in one; the glass cracks in updateSmoke
  crash = (c: Car, o: Car | null, impact: number) => {
    const { game, toast, hurtPlayer, shake, viewer } = this.g,
      { catAboard, pickLine } = this;
    const hits = crashCars(game.clockS, impact, c, o, this.spared);
    if (!hits.length) return;
    let said = false; // one line per crash: wrecked, then smoke, then the crash itself
    for (const { car: k, wrecked: w, smokeUp } of hits) {
      if (w && k === game.pcar) {
        const cat = catAboard();
        toast(
          (cat ? '”Ut, ' + cat.name + '! Den här bilen ä slut.”\n”Mjäu.”' : pickLine(WRECK_LINES)) +
            ' The car is wrecked. Get out and find another.',
          4,
        );
        said = true;
      } else if (w && k.mode === 'police' && Math.hypot(k.x - viewer.x, k.z - viewer.z) < POLICE_WRECK_SEEN_M) {
        toast(pickLine(POLICE_WRECK_LINES) + ' The police car is wrecked.', 3);
        said = true;
      } else if (smokeUp && k === game.pcar) {
        toast(SMOKE_LINES[smokeLevel(k.dmg)]!, 3);
        said = true;
      }
    }
    if (hits.some(h => h.car === game.pcar)) {
      const n = driverHurt(impact);
      hurtPlayer(n);
      shake(crashDamage(impact));
      const cat = catAboard(); // with your cat along, any real crash is about the cat; without, only one that hurts you
      if ((n > 0 || cat) && !said && game.clockS - this.crashLineAt > CRASH_LINE_S) {
        this.crashLineAt = game.clockS;
        toast(cat ? '”Förlåt, ' + cat.name + '! Ä du hel?”\n”Fräs!”' : pickLine(CRASH_LINES), 2.5);
      }
    }
  };

  /** Above about 90 km/h with your cat along, you tell it to hold on. */
  catRideLines() {
    const { game, toast } = this.g,
      cat = game.inCar && this.catAboard(),
      v = game.inCar && game.pcar ? Math.abs(game.pcar.v) : 0;
    if (cat && v > CAT_FAST_MS && !this.catFastSaid) {
      this.catFastSaid = true;
      toast('”Håll i dä, ' + cat.name + '!”\n”MJAAAU!”', 2.5);
    } else if (v < CAT_CALM_MS) this.catFastSaid = false;
  }
}
