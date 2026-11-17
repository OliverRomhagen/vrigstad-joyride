// Health and damage (#80): the player's health and each car's damage, as plain data and pure rules (no three.js, no DOM).
// Crashes (#40), knocking down pedestrians (#35), food (#30), drink (#16) and cat scratches build on hurt / heal / damageCar.

export const HP_MAX = 100;
export const KORV_HP = 10, RULLE_HP = 20;               // food from the kiosk: korv me brö, and a smålandsrulle
export const LOW_HP = 30;                                // below this the hearts pulse, and you say you're hungry
export const CAT_SCRATCH_HP = 5;                         // a cat's scratch when petting goes wrong
export const REGEN_DELAY_S = 10, REGEN_HP_S = 1;         // health starts coming back this long after the last hurt, at this rate (hp/s): a heart (20 hp) in 20 s

// Impact speed is the closing speed along the line of the hit (m/s), so a scrape along a wall costs little and a head-on hit a lot.
export const CRASH_MIN_MS = 7, CRASH_DMG_PER_MS = 2.25;  // a car takes no damage below ~25 km/h, then this much per m/s above it: three crashes at ~70 km/h leave it running, the fourth wrecks it
export const HURT_MIN_MS = 14, HURT_HP_PER_MS = 3.5;     // the driver is fine below ~50 km/h, then loses this much health per m/s above it
export const RUN_OVER_MIN_MS = 4, RUN_OVER_HP_PER_MS = 8;   // on foot, hit by a car: from ~15 km/h, then this much health per m/s
export const CRASH_COOL_S = 0.5;                          // after a hit, the same car takes no new hit for this long: contact lasts several frames

export const DMG_MAX = 100;                               // a car at this much damage is wrecked: it won't drive
export const SMOKE_AT = 50, BLACK_SMOKE_AT = 80;          // grey smoke from the bonnet, then black
export const LIMP_AT = 50, LIMP_TOP = 0.45;               // past LIMP_AT the top speed falls, down to this share just before it's wrecked
export const CRACK_AT = [20, 50, 75];                     // cracked glass: the windscreen and rear window, then the side windows, then everything badly

export interface Health {
  hp: number;
  calm: number;   // s since the last hurt
}

export const newHealth = (): Health => ({ hp: HP_MAX, calm: REGEN_DELAY_S });

/** Takes n health. True when this knocks the player out (health hits zero). */
export function hurt(h: Health, n: number): boolean {
  if (n <= 0 || h.hp <= 0) return false;
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
export const crackLevel = (dmg: number) => CRACK_AT.filter((d) => dmg >= d).length;
