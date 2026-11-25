import { describe, expect, it } from 'vitest';
import { Commands } from '../../../src/game/commands';
import {
  CRASH_COOL_S,
  crackLevel,
  crashCars,
  crashDamage,
  DMG_MAX,
  damageCar,
  driverHurt,
  HP_MAX,
  heal,
  hurt,
  impactSpeed,
  LIMP_TOP,
  newHealth,
  REGEN_DELAY_S,
  REGEN_HP_S,
  regen,
  registerHealthCommands,
  runOverHurt,
  smokeLevel,
  topSpeedShare,
  wakeSpot,
  wrecked,
} from '../../../src/game/health';

describe('player health', () => {
  it('starts full', () => {
    expect(newHealth().hp).toBe(HP_MAX);
  });

  it('knocks the player out only on the hit that reaches zero', () => {
    const h = newHealth();
    expect(hurt(h, 60)).toBe(false);
    expect(h.hp).toBe(40);
    expect(hurt(h, 60)).toBe(true);
    expect(h.hp).toBe(0);
    expect(hurt(h, 10)).toBe(false); // already out
  });

  it('ignores a hurt of zero, which also leaves regeneration running', () => {
    const h = newHealth();
    h.hp = 50;
    expect(hurt(h, 0)).toBe(false);
    expect(h).toEqual({ hp: 50, calm: REGEN_DELAY_S, god: false });
  });

  it('heals up to the maximum', () => {
    const h = newHealth();
    h.hp = 90;
    heal(h, 25);
    expect(h.hp).toBe(HP_MAX);
  });

  it('regenerates only after a calm spell', () => {
    const h = newHealth();
    hurt(h, 50);
    regen(h, REGEN_DELAY_S - 1);
    expect(h.hp).toBe(50);
    regen(h, 1);
    expect(h.hp).toBe(50 + REGEN_HP_S);
  });

  it('does not regenerate from zero', () => {
    const h = newHealth();
    hurt(h, HP_MAX);
    regen(h, 60);
    expect(h.hp).toBe(0);
  });
});

describe('impacts', () => {
  it('counts the closing speed along the normal only', () => {
    expect(impactSpeed(0, 20, 0, -1)).toBe(20); // head-on into a wall to the south
    expect(impactSpeed(20, 0, 0, -1)).toBe(0); // sliding along it
    expect(impactSpeed(0, -20, 0, -1)).toBe(0); // moving away
    expect(impactSpeed(12, 16, 0, -1)).toBeCloseTo(16); // a glancing hit at 20 m/s
  });

  it('does no damage to a car below the threshold, then grows with speed', () => {
    expect(crashDamage(7)).toBe(0);
    expect(crashDamage(17)).toBe(22.5);
  });

  it('wrecks a car on the fourth crash at ~70 km/h, not the third', () => {
    expect(3 * crashDamage(19)).toBeLessThan(DMG_MAX);
    expect(4 * crashDamage(19)).toBeGreaterThanOrEqual(DMG_MAX);
  });

  it('hurts the driver only in a hard crash', () => {
    expect(driverHurt(13)).toBe(0);
    expect(driverHurt(24)).toBe(35);
  });

  it('hurts a player on foot from a slow hit', () => {
    expect(runOverHurt(4)).toBe(0);
    expect(runOverHurt(9)).toBe(40);
  });
});

describe('car damage', () => {
  it('wrecks the car on the hit that reaches the maximum, and only then', () => {
    const c = { dmg: 0 };
    expect(damageCar(c, 60)).toBe(false);
    expect(damageCar(c, 60)).toBe(true);
    expect(c.dmg).toBe(DMG_MAX);
    expect(wrecked(c)).toBe(true);
    expect(damageCar(c, 10)).toBe(false);
  });

  it('keeps full top speed up to the limp point, then slows, then stops', () => {
    expect(topSpeedShare(0)).toBe(1);
    expect(topSpeedShare(50)).toBe(1);
    expect(topSpeedShare(75)).toBeCloseTo((1 + LIMP_TOP) / 2);
    expect(topSpeedShare(99.9)).toBeCloseTo(LIMP_TOP, 2);
    expect(topSpeedShare(DMG_MAX)).toBe(0);
  });

  it('smokes grey past half damage, black near the end', () => {
    expect(smokeLevel(49)).toBe(0);
    expect(smokeLevel(50)).toBe(1);
    expect(smokeLevel(80)).toBe(2);
  });

  it('cracks more glass as the damage grows', () => {
    expect(crackLevel(19)).toBe(0);
    expect(crackLevel(20)).toBe(1);
    expect(crackLevel(50)).toBe(2);
    expect(crackLevel(99)).toBe(3);
  });
});

describe('crashes', () => {
  const car = (dmg = 0) => ({ dmg, hitAt: -9 });
  const HARD_MS = 27; // 20 m/s over CRASH_MIN_MS: 45 damage

  it('damages both cars in a hard hit, only the car against a wall, and never a spared car', () => {
    const a = car(),
      b = car();
    expect(crashCars(0, HARD_MS, a, b).map(h => h.car)).toEqual([a, b]);
    expect(a.dmg).toBe(45);
    expect(b.dmg).toBe(45);
    const c = car();
    expect(crashCars(0, HARD_MS, c, null).map(h => h.car)).toEqual([c]);
    const spared = car(),
      other = car();
    expect(crashCars(0, HARD_MS, spared, other, k => k === spared).map(h => h.wrecked)).toEqual([false, false]);
    expect([spared.dmg, other.dmg]).toEqual([0, crashDamage(HARD_MS)]); // god mode spares the car you drive
  });

  it('ignores a slow bump, which also leaves the cooldown alone', () => {
    const a = car();
    expect(crashCars(0, 7, a, null)).toEqual([]);
    expect(a).toEqual(car());
  });

  it('gives each car its own cooldown', () => {
    const a = car(),
      b = car();
    crashCars(0, HARD_MS, a, null);
    expect(crashCars(CRASH_COOL_S / 2, HARD_MS, a, b).map(h => h.car)).toEqual([b]); // a was just hit; b still takes it
    expect(a.dmg).toBe(45);
    expect(crashCars(CRASH_COOL_S, HARD_MS, a, null)).toHaveLength(1);
    expect(a.dmg).toBe(90);
  });

  it('says when a hit makes a car smoke more, and when it wrecks it instead', () => {
    const a = car(40);
    expect(crashCars(0, HARD_MS, a, null)).toEqual([{ car: a, wrecked: false, smokeUp: true }]); // 40 → 85: black smoke
    expect(crashCars(1, HARD_MS, a, null)).toEqual([{ car: a, wrecked: true, smokeUp: false }]);
    expect(crashCars(2, HARD_MS, a, null)).toEqual([{ car: a, wrecked: false, smokeUp: false }]); // already wrecked
  });
});

describe('waking up after a knock-out', () => {
  const home = { x: 0, z: 0 };
  const places = [
    { x: 100, z: 0, kind: 'safe', name: 'Storgatan' },
    { x: 30, z: 0, kind: 'kiosk', name: 'Kiosken' },
    { x: -60, z: 0, kind: 'safe', name: 'Torggatan' },
  ];

  it('comes to at the nearest safehouse when it is nearer than home', () => {
    expect(wakeSpot(90, 0, home, places)).toBe(places[0]);
    expect(wakeSpot(-50, 0, home, places)).toBe(places[2]);
  });

  it('comes to at home when that is nearer, even with a kiosk closer still', () => {
    expect(wakeSpot(25, 0, home, places)).toBe(home);
  });
});

describe('god mode', () => {
  it('takes no health while on, and fills it up when switched on', () => {
    const h = newHealth(),
      c = new Commands();
    let drawn = 0;
    registerHealthCommands(c, h, () => drawn++);
    hurt(h, 40);
    expect(c.run('god')).toBe('God mode on.');
    expect(h.hp).toBe(HP_MAX);
    expect(hurt(h, HP_MAX)).toBe(false);
    expect(h.hp).toBe(HP_MAX);
    expect(c.run('god on')).toBe('God mode on.'); // on stays on, rather than flipping
    expect(c.run('god')).toBe('God mode off.');
    expect(hurt(h, HP_MAX)).toBe(true);
    expect(c.run('god maybe')).toBe('mode is on or off. Usage: god [mode]');
    expect(drawn).toBe(3);
  });
});
