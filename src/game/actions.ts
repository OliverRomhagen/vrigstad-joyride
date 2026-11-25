// What pressing E does (walk into a place, pet a cat, open the kiosk, get in or out of a car, steal one), and where you end up after Gripen! or a knock-out.
// Moved from src/game/main.ts (#177); main.ts passes in the places, the cats' menus, the police, what the HUD draws and whether the player's mesh shows. No three.js or DOM here.
// Getting in and out of a car are commands, `enter` and `exit` (#366): E only picks which and runs it through the registry,
// so a hook, the console and a test reach the same rule. The other actions follow.
import { wrap } from '../world/math';
import type { Car } from './cars';
import type { Cat } from './cats';
import { command } from './command-args';
import type { Commands } from './commands';
import { fine, fmtKr, pay, type Wallet } from './economy';
import { type Health, HP_MAX, wakeSpot, wrecked } from './health';
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
  commands: Pick<Commands, 'register' | 'run'>; // where enter and exit are registered, and what E runs them through
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
  openSkroten(): boolean; // Skroten's offer for the car you drive on its ring; false when it makes none, so E gets you out
  nearOwner(): boolean; // you stand on foot next to Plåt-Pelle
  talkToOwner(): void;
  offerCar(c: Car): void; // Plåt-Pelle's price for a car on Skroten's lot
  collide(o: Point, r: number): unknown;
  placeCar(c: Car): void;
  rnd(): number;
  pick<T>(a: readonly T[]): T;
  toast(msg: string, secs?: number): void;
  carName(c: Car): string;
  spokenName(c: Car): string | undefined; // the car's name as its driver says it, if its model has one
  driverOut(c: Car): void; // the driver of a car you steal gets out: a person mesh, so render/shouting-drivers.ts draws it
  replaceTaken(taken: Car, p: Point): void; // a traffic car you take: a new one drives in out of sight of p
  drawStolen(): void;
  drawHealth(): void;
  titleCard(title: string, msg: string): void;
  sayLater(line: string): void;
  pickLine(lines: readonly string[]): string;
}

const NOT_NOW = 'Not now: the game is not running.';
const TOO_FAST = 'Slow down before you get out.';

// a car you can get straight back into: one you got out of, while it still drives
const enterable = (c: Car) => c.mode === 'idle' && !wrecked(c);

/** What E does, and putting you back on your feet. */
export class Actions {
  private readonly g: ActionsDeps;

  constructor(g: ActionsDeps) {
    this.g = g;
    g.commands.register(
      'enter',
      command({
        help: 'get into the car in reach, taking it if it is not yours',
        details: 'What E does beside a car. Taking someone else’s car can bring the police.',
        examples: ['enter'],
        access: 'player',
        args: [],
        run: () => this.enterCar(),
      }),
    );
    g.commands.register(
      'exit',
      command({
        help: 'get out of the car you drive',
        details: 'What E does in a car, once it is slow enough.',
        examples: ['exit'],
        access: 'player',
        args: [],
        run: () => this.exitCar(),
      }),
    );
  }

  nearestCar = () => {
    const { player, cars } = this.g,
      c = carInReach(player, cars);
    // E only asks the price of a car on Skroten's lot, so the car you got out of beats a nearer one of those: you step out right
    // beside them. Only then: anywhere else the nearest car wins, or you couldn't walk up to a car beside your own and take it
    return c?.saleKr ? (carInReach(player, cars, enterable) ?? c) : c;
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
      places,
      commands,
      menuOpen,
      closeMenu,
      nearPlace,
      enterHouse,
      leaveHouse,
      nearCat,
      catFirst,
      openOwnCat,
      petCat,
      openKiosk,
      openSkroten,
      nearOwner,
      talkToOwner,
      offerCar,
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
      // too fast, exit says so; otherwise Skroten's offer for the car on its ring comes before getting out
      if (tooFastToGetOut(game.pcar!) || !openSkroten()) commands.run('exit', 'input');
      return;
    }
    const c = this.nearestCar();
    if (!c) return;
    if (c.saleKr) offerCar(c);
    else commands.run('enter', 'input');
  };
  /** The `enter` command: into the car in reach, taking it if it isn't yours. Returns the line the console shows. */
  enterCar = (): string => {
    const {
      game,
      view,
      player,
      places,
      wanted,
      showPlayer,
      rnd,
      pick,
      toast,
      carName,
      spokenName,
      driverOut,
      replaceTaken,
      drawStolen,
      pickLine,
    } = this.g;
    if (!game.started || game.titleCardT > 0) return NOT_NOW;
    if (places.inside) return 'You are inside a house.';
    if (game.inCar) return 'You are already in the ' + carName(game.pcar!) + '.';
    const c = this.nearestCar();
    if (!c) return 'No car in reach.';
    if (c.saleKr) return 'The ' + carName(c) + ' is for sale at Skroten.';
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
      replaceTaken(c, player);
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
    return 'You are in the ' + carName(c) + '.';
  };
  /** The `exit` command: out of the car you drive, unless it is still too fast. Returns the line the console shows. */
  exitCar = (): string => {
    const { game, toast, carName } = this.g;
    if (!game.started || game.titleCardT > 0) return NOT_NOW;
    if (!game.inCar) return 'You are not in a car.';
    if (tooFastToGetOut(game.pcar!)) {
      toast(TOO_FAST, 2);
      return TOO_FAST;
    }
    const name = carName(game.pcar!);
    this.getOut();
    return 'You got out of the ' + name + '.';
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
