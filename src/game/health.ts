// Health and damage (#80): the player's health and each car's damage, as plain data and pure rules (no three.js, no DOM).
// Crashes (#40), knocking down pedestrians (#35), food (#30), drink (#16) and cat scratches build on hurt / heal / damageCar.
import { command, int, optional, toggle } from './command-args';
import type { Commands } from './commands';
import { type CarMods, damageShare } from './sim/upgrades';

export const HP_MAX = 100;
export const KORV_HP = 10,
  RULLE_HP = 20; // food from the kiosk: korv me brö, and a smålandsrulle
export const LOW_HP = 30; // below this the hearts pulse, and you say you're hungry
export const CAT_SCRATCH_HP = 5; // a cat's scratch when petting goes wrong
export const REGEN_DELAY_S = 10,
  REGEN_HP_S = 1; // health starts coming back this long after the last hurt, at this rate (hp/s): a heart (20 hp) in 20 s

// Impact speed is the closing speed along the line of the hit (m/s), so a scrape along a wall costs little and a head-on hit a lot.
export const CRASH_MIN_MS = 7,
  CRASH_DMG_PER_MS = 2.25; // a car takes no damage below ~25 km/h, then this much per m/s above it: three crashes at ~70 km/h leave it running, the fourth wrecks it
export const HURT_MIN_MS = 14,
  HURT_HP_PER_MS = 3.5; // the driver is fine below ~50 km/h, then loses this much health per m/s above it
export const RUN_OVER_MIN_MS = 4,
  RUN_OVER_HP_PER_MS = 8; // on foot, hit by a car: from ~15 km/h, then this much health per m/s
export const CRASH_COOL_S = 0.5; // after a hit, the same car takes no new hit for this long: contact lasts several frames

export const DMG_MAX = 100; // a car at this much damage is wrecked: it won't drive
export const SMOKE_AT = 50,
  BLACK_SMOKE_AT = 80; // grey smoke from the bonnet, then black
export const LIMP_AT = 50,
  LIMP_TOP = 0.45; // past LIMP_AT the top speed falls, down to this share just before it's wrecked
export const CRACK_AT = [20, 50, 75]; // cracked glass: the windscreen and rear window, then the side windows, then everything badly

export interface Health {
  hp: number;
  calm: number; // s since the last hurt
  god: boolean; // the dev console's god mode: no health lost, your car takes no damage (crashCars), no getting caught (police.ts)
}

export const newHealth = (): Health => ({ hp: HP_MAX, calm: REGEN_DELAY_S, god: false });

/** Whether n health would come off: false in god mode, or once the player is out. */
export const canHurt = (h: Health, n: number) => n > 0 && h.hp > 0 && !h.god;

/** Takes n health. True when this knocks the player out (health hits zero). */
export function hurt(h: Health, n: number): boolean {
  if (!canHurt(h, n)) return false;
  h.hp = Math.max(0, h.hp - n);
  h.calm = 0;
  return h.hp === 0;
}

export function heal(h: Health, n: number) {
  h.hp = Math.min(HP_MAX, h.hp + Math.max(0, n));
}

/** Slow regeneration, once nothing has hurt the player for REGEN_DELAY_S. */
export function regen(h: Health, dt: number) {
  h.calm += dt;
  if (h.hp > 0 && h.calm >= REGEN_DELAY_S) heal(h, REGEN_HP_S * dt);
}

/** Closing speed (m/s) of a velocity (vx, vz) into a surface whose normal (nx, nz, unit length) points back at the mover. */
export const impactSpeed = (vx: number, vz: number, nx: number, nz: number) => Math.max(0, -(vx * nx + vz * nz));

export const crashDamage = (impact: number) => Math.max(0, impact - CRASH_MIN_MS) * CRASH_DMG_PER_MS;
export const driverHurt = (impact: number) => Math.max(0, impact - HURT_MIN_MS) * HURT_HP_PER_MS;
export const runOverHurt = (impact: number) => Math.max(0, impact - RUN_OVER_MIN_MS) * RUN_OVER_HP_PER_MS;

export interface Damageable {
  dmg: number;
}

export const wrecked = (c: Damageable) => c.dmg >= DMG_MAX;

/** Adds n damage. True when this hit wrecks the car. */
export function damageCar(c: Damageable, n: number): boolean {
  if (n <= 0 || wrecked(c)) return false;
  c.dmg = Math.min(DMG_MAX, c.dmg + n);
  return wrecked(c);
}

/** Share of its top speed a car with this much damage still reaches: 1 up to LIMP_AT, falling to LIMP_TOP, 0 when wrecked. */
export function topSpeedShare(dmg: number) {
  if (dmg >= DMG_MAX) return 0;
  if (dmg <= LIMP_AT) return 1;
  return 1 - ((1 - LIMP_TOP) * (dmg - LIMP_AT)) / (DMG_MAX - LIMP_AT);
}

/** 0 none, 1 grey smoke, 2 black smoke. */
export const smokeLevel = (dmg: number) => (dmg >= BLACK_SMOKE_AT ? 2 : dmg >= SMOKE_AT ? 1 : 0);

/** 0 whole glass, then 1–3 as more of it cracks (CRACK_AT). */
export const crackLevel = (dmg: number) =>
  dmg >= CRACK_AT[2] ? 3 : dmg >= CRACK_AT[1] ? 2 : dmg >= CRACK_AT[0] ? 1 : 0; // no filter: updateSmoke asks for every car every frame

export interface Crashable extends Damageable {
  hitAt: number; // clock (s) of the car's last hit, for CRASH_COOL_S
  mods: CarMods; // a reinforced body takes less of the damage (sim/upgrades.ts)
}

export interface CrashHit<C extends Crashable> {
  car: C;
  wrecked: boolean; // this hit wrecked it
  smokeUp: boolean; // this hit made it smoke more, short of wrecking it
}

const NO_HITS: never[] = []; // shared: a slow scrape along a wall calls crashCars every frame of contact

/** A crash at this impact speed (m/s) of car a into car b, or into a wall when b is null, at clock nowS (s).
 * Damages each car not hit in the last CRASH_COOL_S (each keeps its own, so ramming a car that was just hit still damages yours)
 * and says what changed for it; empty when nothing took damage. */
export function crashCars<C extends Crashable>(
  nowS: number,
  impact: number,
  a: C,
  b: C | null,
  spared: C | null = null, // takes the hit but no damage: the car you drive in god mode
): CrashHit<C>[] {
  const d = crashDamage(impact);
  if (d <= 0) return NO_HITS;
  const hits: CrashHit<C>[] = [];
  for (const car of b ? [a, b] : [a]) {
    if (nowS - car.hitAt < CRASH_COOL_S) continue;
    car.hitAt = nowS;
    const smoke = smokeLevel(car.dmg),
      w = car !== spared && damageCar(car, d * damageShare(car.mods));
    hits.push({ car, wrecked: w, smokeUp: !w && smokeLevel(car.dmg) > smoke });
  }
  return hits;
}

export interface Spot {
  x: number;
  z: number;
}

/** Where a knocked-out player comes to: the nearest safehouse, if one is nearer than home. */
export function wakeSpot<S extends Spot & { kind: string }>(
  x: number,
  z: number,
  home: Spot,
  places: readonly S[],
): S | Spot {
  let spot: S | Spot = home,
    best = Math.hypot(x - home.x, z - home.z);
  for (const p of places) {
    const d = Math.hypot(x - p.x, z - p.z);
    if (p.kind === 'safe' && d < best) {
      best = d;
      spot = p;
    }
  }
  return spot;
}

/** The dev console's `god [on|off]`: on its own it flips. Switching it on fills the health up too. */
export function registerHealthCommands(commands: Pick<Commands, 'register'>, h: Health, drawHealth: () => void): void {
  commands.register(
    'god',
    command({
      help: 'god mode: no hurt, no damage to your car, no getting caught',
      details: 'Crashes and chases still happen: the police chase you, but can’t catch you.',
      examples: ['god', 'god off'],
      args: [optional(toggle('mode'))],
      run: ({ mode }) => {
        h.god = mode ?? !h.god;
        if (h.god) heal(h, HP_MAX);
        drawHealth();
        return h.god ? 'God mode on.' : 'God mode off.';
      },
    }),
  );
}

/** The dev console's `damage <0-100>`: sets the damage of the car you drive, to try Skroten's repairs and the smoke and cracks. */
export function registerCarDamageCommand(commands: Pick<Commands, 'register'>, car: () => Damageable | null): void {
  commands.register(
    'damage',
    command({
      help: `set the damage of the car you drive; ${DMG_MAX} wrecks it`,
      examples: ['damage 60', 'damage 0'],
      args: [int('damage', { min: 0, max: DMG_MAX })],
      run: ({ damage }) => {
        const c = car();
        if (!c) return 'Get in a car first.';
        c.dmg = damage;
        return `Car damage: ${damage}.`;
      },
    }),
  );
}
