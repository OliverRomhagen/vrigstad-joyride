import { describe, expect, it } from 'vitest';
import { ENGINE_ACC, ENGINE_TOP, GLOWS, modAcc, modTop, PAINTS, RIMS } from '../../../../src/game/sim/car-mods';

describe('car mods', () => {
  it('leave a car without an engine step as fast as its type', () => {
    expect(modAcc(undefined)).toBe(1);
    expect(modTop({ paint: 'kiosk-gul', glow: 'rosa' })).toBe(1);
  });

  it('make a tuned engine pull harder and reach a higher top speed', () => {
    expect(modAcc({ engine: 1 })).toBe(ENGINE_ACC);
    expect(modTop({ engine: 1 })).toBe(ENGINE_TOP);
    expect(ENGINE_ACC).toBeGreaterThan(1);
    expect(ENGINE_TOP).toBeGreaterThan(1);
  });

  it('give every part a name, a price and a colour, with kebab-case ids', () => {
    for (const parts of [PAINTS, RIMS, GLOWS])
      for (const [id, p] of Object.entries(parts)) {
        expect(id).toMatch(/^[a-z]+(-[a-z]+)*$/);
        expect(p.name).not.toBe('');
        expect(p.kr).toBeGreaterThan(0);
        expect(p.hex).toMatch(/^#[0-9a-f]{6}$/);
      }
  });

  it('price a metallic paint above a flat one', () => {
    expect(PAINTS['slattsjo-bla'].kr).toBeGreaterThan(PAINTS['vrigstad-rod'].kr);
  });
});
