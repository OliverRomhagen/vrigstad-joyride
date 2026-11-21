// What pressing E does (walk into a place, pet a cat, open the kiosk, get in or out of a car, steal one), and where you end up after Gripen! or a knock-out.
// Moved from src/game/main.ts (#177); main.ts passes in the places, the cats' menus, the police, what the HUD draws and whether the player's mesh shows. No three.js or DOM here.
import { wrap } from '../world/math';
import type { Car } from './cars';
import type { Cat } from './cats';
import { fine, fmtKr, pay, type Wallet } from './economy';
import { type Health, HP_MAX, wakeSpot } from './health';
import type { Place, Places } from './places';
import { carInReach, HOME, type PlayerState, standAt, stepOut, tooFastToGetOut } from './player';
import type { Wanted } from './police';
import type { GameState, ViewState } from './state';

type Point = { x: number; z: number };
const WAKE_LINES = ['”Va hände? Ja minns ingenting.”', '”Aj, mitt huve…”'];
/** What you say on a new star. */
export const WANTED_LINES = [
  '”Oj, nu ä länsman efter mä!”',
  '”Ajaj, nu kommer snuten.”',
  '”Fan, nu ä snuten på mä.”',
  '”Nu blir dä bråk mä länsman, dä.”',
];

/** What E reads from the rest of the game. */
export interface ActionsDeps {
  game: GameState;
  view: ViewState;
  player: PlayerState;
  readonly cars: readonly Car[];
  places: Pick<Places, 'inside' | 'list'>;
  wanted: Pick<Wanted, 'addStar' | 'police' | 'stars' | 'clear'>;
  health: Health;
  wallet: Wallet;
  menuOpen(): boolean; // the menu plate is up: E closes it
  closeMenu(): void;
  showPlayer(shown: boolean): void; // the player's mesh: hidden while you drive
  nearPlace(): Place | null;
  enterHouse(p: Place): void;
  leaveHouse(): void;
  nearCat(): Cat | null;
  catFirst(kt: Cat | null, pl: Place | null): boolean;
  openOwnCat(k: Cat): void;
  petCat(k: Cat): void;
  openKiosk(): void;
  atSkroten(): boolean; // the car you drive stands on Skroten's ring
  openSkroten(): void; // Skroten's offer for it
  nearOwner(): boolean; // you stand on foot next to Plåt-Pelle
  talkToOwner(): void;
  collide(o: Point, r: number): unknown;
  placeCar(c: Car): void;
  rnd(): number;
  pick<T>(a: readonly T[]): T;
  toast(msg: string, secs?: number): void;
  carName(c: Car): string;
  spokenName(c: Car): string | undefined; // the car's name as its driver says it, if its model has one
  driverOut(c: Car): void; // the driver of a car you steal gets out: a person mesh, so render/shouting-drivers.ts draws it
  spawnTraffic(p: Point): void;
  drawStolen(): void;
  drawHealth(): void;
  titleCard(title: string, msg: string): void;
  sayLater(line: string): void;
  pickLine(lines: readonly string[]): string;
}

/** What E does, and putting you back on your feet. */
export class Actions {
  private readonly g: ActionsDeps;

  constructor(g: ActionsDeps) {
    this.g = g;
  }

  nearestCar = () => {
    const { player, cars } = this.g;
    return carInReach(player, cars);
  };
  // park the car where it stands and put you on foot; the caller places you
  leaveCar = () => {
    const { game, placeCar, showPlayer } = this.g;
    const c = game.pcar!;
    c.mode = 'idle';
    c.v = c.slip = c.drift = c.boost = c.thr = c.st = 0;
    placeCar(c);
    game.pcar = null;
    game.inCar = false;
    showPlayer(true);
  };
  // out of the car you drive and onto your feet beside it, looking where you looked
  getOut = () => {
    const { game, view, player, collide } = this.g;
    stepOut(player, game.pcar!);
    collide(player, 0.5);
    this.leaveCar();
    game.jumpQ = false;
    view.camYaw = wrap(view.camYaw + view.lookOff);
    view.lookOff = 0;
  };
  action = () => {
    const {
      game,
      view,
      player,
      places,
      wanted,
      menuOpen,
      closeMenu,
      showPlayer,
      nearPlace,
      enterHouse,
      leaveHouse,
      nearCat,
      catFirst,
      openOwnCat,
      petCat,
      openKiosk,
      atSkroten,
      openSkroten,
      nearOwner,
      talkToOwner,
      rnd,
      pick,
      toast,
      carName,
      spokenName,
      driverOut,
      spawnTraffic,
      drawStolen,
      pickLine,
    } = this.g;
    if (!game.started || game.titleCardT > 0) return;
    if (places.inside) {
      leaveHouse();
      return;
    }
    if (menuOpen()) {
      closeMenu();
      return;
    }
    const pl = nearPlace(),
      kt = nearCat();
    if (catFirst(kt, pl)) {
      if (kt!.owned) openOwnCat(kt!);
      else petCat(kt!);
      return;
    }
    if (pl) {
      if (pl.kind === 'safe') enterHouse(pl);
      else openKiosk();
      return;
    }
    if (nearOwner()) {
      talkToOwner();
      return;
    }
    if (game.inCar) {
      if (tooFastToGetOut(game.pcar!)) {
        toast('Slow down before you get out.', 2);
        return;
      }
      if (atSkroten()) openSkroten();
      else this.getOut();
      return;
    }
    const c = this.nearestCar();
    if (!c) return;
    if (c.mode === 'ai') {
      driverOut(c);
      toast(
        pick([
          '”Hörru! Det där är min bil!”',
          '”Men va fan gör du?!”',
          '”Polisen! Han tar ' + (spokenName(c) || 'min ' + c.T.name) + '!”',
          '”Ring snuten! Han snor min bil!”',
        ]) + ' The driver calls the police.',
      );
      wanted.addStar();
      spawnTraffic(player);
    } else if (!c.owned) {
      if (wanted.police.length || rnd() < 0.35)
        wanted.addStar(
          pickLine(WANTED_LINES) + ' A neighbour saw you take the ' + carName(c) + ' and called the police.',
        );
      else
        toast(
          c.type === 'epa'
            ? 'EPA-traktor: legally limited to 30 km/h. Good luck outrunning anyone.'
            : 'You took the ' + carName(c) + '. Nobody noticed.',
        );
    }
    if (!c.owned) {
      c.owned = true;
      game.stolen++;
      drawStolen();
    }
    c.mode = 'player';
    c.vh = c.h;
    c.slip = c.drift = c.boost = c.loose = c.thr = c.st = 0;
    game.pcar = c;
    game.inCar = true;
    player.y = player.vy = 0;
    showPlayer(false);
    view.lookOff = 0;
    view.camYaw = c.h;
  };
  respawn = () => {
    const { game, player, leaveHouse, collide } = this.g;
    leaveHouse();
    if (game.inCar) this.leaveCar();
    standAt(player, HOME.x, HOME.z);
    game.jumpQ = false;
    collide(player, 0.6);
  };
  // the fine goes by the stars you had, which are already cleared
  busted = (stars = 0) => {
    const { health, wallet, drawHealth, titleCard } = this.g;
    const fineKr = fine(wallet.kr, stars);
    pay(wallet, fineKr);
    this.respawn();
    health.hp = HP_MAX;
    drawHealth();
    titleCard(
      'Gripen!',
      'Busted. The police ' + (fineKr ? 'fine you ' + fmtKr(fineKr) + ' and ' : '') + 'drop you off at Torget.',
    );
  };
  // health at zero: with the police after you it's Gripen!, otherwise you come to at the nearest safehouse, or Torget
  knockedOut = () => {
    const { player, places, wanted, health, collide, drawHealth, titleCard, sayLater, pickLine } = this.g;
    if (wanted.stars) {
      const stars = wanted.stars;
      wanted.clear();
      this.busted(stars);
      return;
    } // Gripen! expects the stars cleared
    const spot = wakeSpot(player.x, player.z, HOME, places.list);
    this.respawn();
    standAt(player, spot.x, spot.z);
    collide(player, 0.6);
    health.hp = HP_MAX;
    drawHealth();
    titleCard(
      'Däckad!',
      'Knocked out. You come to ' +
        ('name' in spot && spot.name ? 'at the safehouse on ' + spot.name : 'at Torget') +
        '.',
    );
    sayLater(pickLine(WAKE_LINES));
  };
}
