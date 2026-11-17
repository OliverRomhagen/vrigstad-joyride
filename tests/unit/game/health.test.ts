import { describe, expect, it } from 'vitest';
import {
  crackLevel, crashDamage, DMG_MAX, damageCar, driverHurt, HP_MAX, heal, hurt, impactSpeed, LIMP_TOP, newHealth, REGEN_DELAY_S, REGEN_HP_S, regen,
  runOverHurt, smokeLevel, topSpeedShare, wrecked,
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
    expect(hurt(h, 10)).toBe(false);   // already out
  });

  it('ignores a hurt of zero, which also leaves regeneration running', () => {
    const h = newHealth();
    h.hp = 50;
    expect(hurt(h, 0)).toBe(false);
    expect(h).toEqual({ hp: 50, calm: REGEN_DELAY_S });
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
    expect(impactSpeed(0, 20, 0, -1)).toBe(20);                   // head-on into a wall to the south
    expect(impactSpeed(20, 0, 0, -1)).toBe(0);                    // sliding along it
    expect(impactSpeed(0, -20, 0, -1)).toBe(0);                   // moving away
    expect(impactSpeed(12, 16, 0, -1)).toBeCloseTo(16);           // a glancing hit at 20 m/s
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
