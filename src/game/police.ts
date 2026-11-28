// The wanted level and the police: stars, police cars that chase you, losing them, lying low and getting caught.
// Moved from src/game/main.ts (#177); main.ts passes in car spawning, removal and the driving model, the roads, the seeded rolls and what the HUD shows. No three.js or DOM here.
import { clamp, wrap } from '../world/math';
import type { RoadNetwork } from '../world/roads';
import { command, int } from './command-args';
import type { Commands } from './commands';
import { wrecked } from './health';

export const MAX_STARS = 3; // one police car per star
const SPAWN_MIN_M = 200,
  SPAWN_MAX_M = 480,
  SPAWN_TRIES = 60; // a police car starts on a road this far from you (m); after this many misses, on any road
// stay further than this from every police car for this long (s) to lose them; the stars show it after EVADE_SHOW_S. The
// marketing page's getaway (wiki/src/routes/about/) loses them by the same rule.
export const EVADE_DIST_M = 170,
  EVADE_S = 18;
const EVADE_SHOW_S = 2;
const BUST_DIST_M = 7.5,
  BUST_SPEED_MS = 2.5,
  BUST_S = 1.6; // a police car this close while you're this slow for this long (s) gets you Gripen!
// chasing: full throttle when you're within FULL_ANGLE of straight ahead, stop next to you, back out after being stuck
const FULL_ANGLE = 1.1,
  TURN_THROTTLE = 0.45,
  STEER_GAIN = 2.2; // rad; throttle while turning towards you; steer per rad off course
const STOP_M = 9,
  STUCK_MS = 0.8,
  STUCK_S = 1.1,
  REVERSE_S = 1.3; // stops this close (m); slower than this (m/s) for this long (s) counts as stuck; then reverses this long (s)

type Point = { x: number; z: number };
/** A police car, as the chase sees it. `rev` > 0 while it backs out, steering `revSteer`; `stuck` is how long it has been stuck (s); `dmg` is its damage (health.ts). */
export interface PoliceCar extends Point {
  h: number;
  v: number;
  rev: number;
  stuck: number;
  revSteer: number;
  dmg: number;
}

/** What the wanted level reads from the rest of the game. The getter is read when used, so main.ts can declare it later. */
export interface WantedDeps {
  roads: Pick<RoadNetwork, 'lines' | 'driveable'>;
  rnd(): number; // the seeded stream: police rolls are part of gameplay
  pick<T>(a: readonly T[]): T; // a random element, from the same stream
  spawnCar(x: number, z: number, h: number): PoliceCar; // adds a police car to the world
  removeCar(c: PoliceCar): void;
  drive(c: PoliceCar, throttle: number, steer: number, brake: boolean, dt: number): void; // the shared driving model
  toast(msg: string): void;
  drawStars(): void; // the HUD reads `stars` and redraws them
  showEvading(on: boolean): void; // the stars show that you're getting away
  caught(stars: number): void; // Gripen! with this many stars: back to Torget; the stars are already cleared
  readonly lyingLow: boolean; // inside a safehouse
  readonly god: boolean; // god mode: they chase you, but can't catch you
}

/** The wanted level and the police cars that come with it. */
export class Wanted {
  stars = 0;
  readonly police: PoliceCar[] = [];
  evade = 0; // time out of reach of every police car (s)
  bust = 0; // time with a police car on you while you're slow (s); it drains when you get going
  hideLeft = 0; // time left lying low in a safehouse before the police give up (s)
  private readonly g: WantedDeps;

  constructor(g: WantedDeps) {
    this.g = g;
  }

  addStar(msg?: string) {
    if (this.stars < MAX_STARS) this.stars++;
    this.evade = 0;
    this.g.drawStars();
    if (msg) this.g.toast(msg);
  }

  clear() {
    this.stars = 0;
    this.evade = 0;
    this.bust = 0;
    for (const p of this.police) this.g.removeCar(p);
    this.police.length = 0;
    this.g.drawStars();
    this.g.showEvading(false);
  }

  /** Sets the wanted level, for the dev console: 0 clears it, fewer stars send the extra police cars away. */
  setStars(n: number) {
    n = clamp(Math.round(n), 0, MAX_STARS);
    if (n === 0) return this.clear();
    this.stars = n;
    this.evade = this.bust = 0;
    let live = this.police.filter(p => !wrecked(p)).length;
    for (let i = this.police.length - 1; i >= 0 && live > n; i--) {
      if (wrecked(this.police[i])) continue;
      this.g.removeCar(this.police[i]);
      this.police.splice(i, 1);
      live--;
    }
    this.g.drawStars();
    this.g.showEvading(false);
  }

  /** The dev console's `stars <0-3>`. */
  registerCommands(commands: Pick<Commands, 'register'>) {
    commands.register(
      'stars',
      command({
        help: 'set the wanted level; 0 calls the police off',
        examples: ['stars 3', 'stars 0'],
        args: [int('stars', { min: 0, max: MAX_STARS })],
        run: ({ stars }) => {
          this.setStars(stars);
          return stars === 0 ? 'Not wanted.' : `Wanted: ${stars} star${stars > 1 ? 's' : ''}.`;
        },
      }),
    );
  }

  /** Starts the safehouse timer; it only runs while `lyingLow` and you have stars. */
  lieLow(secs: number) {
    this.hideLeft = secs;
  }

  /** One frame: tops up the police to one working car per star (a wreck is out of the chase), chases `target` (you, or the car you drive) and decides whether you got away or got caught.
   *  Returns whether you were wanted at the start of the frame. */
  update(dt: number, target: Point, speed: number): boolean {
    let live = 0;
    for (const p of this.police) if (!wrecked(p)) live++;
    for (; live < this.stars; live++) this.spawn(target);
    if (this.stars <= 0) return false;
    let md = 1e9;
    for (const p of this.police) {
      const d = this.chase(p, dt, target, speed);
      if (!wrecked(p)) md = Math.min(md, d);
    }
    if (md > EVADE_DIST_M) {
      this.evade += dt;
      if (this.evade > EVADE_S) {
        this.clear();
        this.g.toast('You lost them.');
        return true; // lost: the safehouse timer mustn't clear them again
      }
    } else this.evade = 0;
    this.g.showEvading(this.evade > EVADE_SHOW_S);
    if (this.g.lyingLow) {
      this.hideLeft -= dt;
      if (this.hideLeft <= 0) {
        this.clear();
        this.g.toast('The police gave up. The coast is clear.');
      }
    } else if (!this.g.god && md < BUST_DIST_M && speed < BUST_SPEED_MS) {
      this.bust += dt;
      if (this.bust > BUST_S) {
        const n = this.stars;
        this.clear();
        this.g.caught(n);
      }
    } else this.bust = Math.max(0, this.bust - dt);
    return true;
  }

  private spawn(T: Point) {
    const { lines: R, driveable } = this.g.roads,
      g = this.g;
    let spot: [number, number] | null = null;
    for (let t = 0; t < SPAWN_TRIES && !spot; t++) {
      const r = R[g.pick(driveable)],
        p = g.pick(r.p),
        d = Math.hypot(p[0] - T.x, p[1] - T.z);
      if (d > SPAWN_MIN_M && d < SPAWN_MAX_M) spot = p;
    }
    if (!spot) spot = g.pick(R[g.pick(driveable)].p);
    this.police.push(this.g.spawnCar(spot[0], spot[1], Math.atan2(T.x - spot[0], -(T.z - spot[1]))));
  }

  /** Drives one police car towards the target, moving at `tv` (m/s); returns its distance from the target (m). */
  private chase(c: PoliceCar, dt: number, T: Point, tv: number) {
    const dx = T.x - c.x,
      dz = T.z - c.z,
      d = Math.hypot(dx, dz);
    if (wrecked(c)) {
      this.g.drive(c, 0, 0, false, dt);
      return d;
    } // a wreck only rolls to a stop: no chasing, and no stuck rolls from rnd()
    const diff = wrap(Math.atan2(dx, -dz) - c.h);
    let thr = Math.abs(diff) < FULL_ANGLE ? 1 : TURN_THROTTLE,
      steer = clamp(diff * STEER_GAIN, -1, 1),
      brake = false;
    if (d < STOP_M) {
      thr = 0;
      brake = c.v > Math.max(1, tv);
    }
    if (c.rev > 0) {
      c.rev -= dt;
      thr = -1;
      steer = c.revSteer;
      brake = false;
    } else if (Math.abs(c.v) < STUCK_MS && d > STOP_M) {
      c.stuck += dt;
      if (c.stuck > STUCK_S) {
        c.stuck = 0;
        c.rev = REVERSE_S;
        c.revSteer = this.g.rnd() < 0.5 ? 1 : -1;
      }
    } else c.stuck = 0;
    this.g.drive(c, thr, steer, brake, dt);
    return d;
  }
}
