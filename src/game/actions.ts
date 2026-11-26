// What pressing E does (walk into a place, pet a cat, open the kiosk, get in or out of a car, steal one), and where you end up after Gripen! or a knock-out.
// Moved from src/game/main.ts (#177); main.ts passes in the places, the cats' menus, the police, what the HUD draws and whether the player's mesh shows. No three.js or DOM here.
// Getting in and out of a car are commands, `enter` and `exit` (#366): E only picks which and runs it through the registry,
// so a hook, the console and a test reach the same rule. A rule that says no returns a refusal from ACTION_REFUSAL with its reason, and E shows the
// reason of a refusal as a toast. The other actions follow.
import { wrap } from '../world/math';
import type { Car } from './cars';
import type { Cat } from './cats';
import { command } from './command-args';
import { type Commands, type Outcome, refuse } from './commands';
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
  commands: Pick<Commands, 'execute'>; // what E runs enter and exit through
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

/**
 * Why an action didn't happen, by name: what a tutorial, a sound or a test matches on (`outcome.code`), while the
 * sentence beside it stays free to be reworded. It grows as more of what E does becomes a command.
 */
export const ACTION_REFUSAL = {
  /** Start isn't pressed yet */
  NOT_STARTED: 'not-started',
  /** a title card (Gripen!, Däckad!) is still up */
  TITLE_CARD: 'title-card',
  /** you are inside a safehouse */
  INDOORS: 'indoors',
  /** a menu is open: the kiosk's, a cat's, Skroten's */
  MENU_OPEN: 'menu-open',
  ALREADY_DRIVING: 'already-driving',
  NO_CAR_IN_REACH: 'no-car-in-reach',
  /** the car in reach is Plåt-Pelle's to sell: E asks its price */
  CAR_FOR_SALE: 'car-for-sale',
  NOT_DRIVING: 'not-driving',
  /** the car you drive is too fast to get out of */
  TOO_FAST: 'too-fast',
} as const;

// the refusal when nobody can act at all, if that is so: Start not pressed, or a title card still up. E ignores the
// press then, but a typed line, a script or a test gets to a rule without E
const notPlaying = (game: GameState): Outcome | undefined =>
  !game.started
    ? refuse(ACTION_REFUSAL.NOT_STARTED, 'Press Start first.')
    : game.titleCardT > 0
      ? refuse(ACTION_REFUSAL.TITLE_CARD, 'Wait for the title card to go.')
      : undefined;

// a car you can get straight back into: one you got out of, while it still drives
const enterable = (c: Car) => c.mode === 'idle' && !wrecked(c);

/** What E does, and putting you back on your feet. */
export class Actions {
  private readonly g: ActionsDeps;

  constructor(g: ActionsDeps) {
    this.g = g;
  }

  /** Adds `enter` and `exit`: what E runs at a car, for the console, a script and a test too. */
  registerCommands(commands: Pick<Commands, 'register'>): void {
    commands.register(
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
    commands.register(
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
      // too fast, exit refuses; otherwise Skroten's offer for the car on its ring comes before getting out
      if (tooFastToGetOut(game.pcar!) || !openSkroten()) this.press('exit');
      return;
    }
    const c = this.nearestCar();
    if (!c) return;
    if (c.saleKr) offerCar(c);
    else this.press('enter');
  };
  // runs a command as the player's key press; when it is refused, by its rule or by a hook, the reason is what you see
  private press = (line: string) => {
    const outcome = this.g.commands.execute(line, 'input');
    if (!outcome.ok) this.g.toast(outcome.text, 2);
  };
  /** The `enter` command: into the car in reach, taking it if it isn't yours. Returns the line to show, or a refusal with its reason. */
  enterCar = (): string | Outcome => {
    const {
      game,
      view,
      player,
      places,
      wanted,
      menuOpen,
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
    // E checks these before it picks, but a typed line, a script or a test gets here without E
    const refusal = notPlaying(game);
    if (refusal) return refusal;
    if (places.inside) return refuse(ACTION_REFUSAL.INDOORS, 'You are inside a house.');
    if (menuOpen()) return refuse(ACTION_REFUSAL.MENU_OPEN, 'Close the menu first.');
    if (game.inCar)
      return refuse(ACTION_REFUSAL.ALREADY_DRIVING, 'You are already in the ' + carName(game.pcar!) + '.');
    const c = this.nearestCar();
    if (!c) return refuse(ACTION_REFUSAL.NO_CAR_IN_REACH, 'No car in reach.');
    if (c.saleKr) return refuse(ACTION_REFUSAL.CAR_FOR_SALE, 'The ' + carName(c) + ' is for sale at Skroten.');
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
  /** The `exit` command: out of the car you drive, unless it is still too fast. Returns the line to show, or a refusal with its reason. */
  exitCar = (): string | Outcome => {
    const { game, menuOpen, carName } = this.g;
    const refusal = notPlaying(game);
    if (refusal) return refusal;
    if (menuOpen()) return refuse(ACTION_REFUSAL.MENU_OPEN, 'Close the menu first.');
    if (!game.inCar) return refuse(ACTION_REFUSAL.NOT_DRIVING, 'You are not in a car.');
    if (tooFastToGetOut(game.pcar!)) return refuse(ACTION_REFUSAL.TOO_FAST, 'Slow down before you get out.');
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
