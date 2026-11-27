import { describe, expect, it } from 'vitest';
import { AMMOS, AmmoId, accepts, ammoFor, EffectKind, effectOf, nextAmmo } from '../../../../src/game/sim/ammo';
import { WEAPONS, WeaponId } from '../../../../src/game/sim/shots';

const weapon = (id: WeaponId) => WEAPONS.find(w => w.id === id)!;
const index = (id: AmmoId) => AMMOS.findIndex(a => a.id === id);

describe('which ammo a weapon fires', () => {
  it('fires every ammo any weapon fires, unless the weapon names its own', () => {
    for (const a of [AmmoId.GEGGA, AmmoId.PANG, AmmoId.DANS]) expect(accepts(weapon(WeaponId.PICKADOLL), a)).toBe(true);
    expect(accepts(weapon(WeaponId.MINIGUN), AmmoId.FOTANGLAR)).toBe(false);
    expect(accepts(weapon(WeaponId.FOTANGLAR), AmmoId.FOTANGLAR)).toBe(true);
    expect(accepts(weapon(WeaponId.FOTANGLAR), AmmoId.GEGGA)).toBe(false);
  });

  it('gives fotanglar to no weapon but their own', () => {
    expect(WEAPONS.filter(w => accepts(w, AmmoId.FOTANGLAR)).map(w => w.id)).toEqual([WeaponId.FOTANGLAR]);
  });

  it('leaves no weapon without an ammo to fire', () => {
    for (const w of WEAPONS) expect(AMMOS.some(a => accepts(w, a.id))).toBe(true);
  });

  it("fires the ammo picked last when it can, else the weapon's first", () => {
    expect(ammoFor(weapon(WeaponId.MINIGUN), index(AmmoId.DANS))).toBe(index(AmmoId.DANS));
    expect(ammoFor(weapon(WeaponId.FOTANGLAR), index(AmmoId.DANS))).toBe(index(AmmoId.FOTANGLAR));
    expect(ammoFor(weapon(WeaponId.MINIGUN), index(AmmoId.FOTANGLAR))).toBe(index(AmmoId.GEGGA));
  });

  it('steps on to the next ammo the weapon fires, round again, skipping the rest', () => {
    const minigun = weapon(WeaponId.MINIGUN);
    expect(nextAmmo(minigun, index(AmmoId.GEGGA))).toBe(index(AmmoId.PANG));
    expect(nextAmmo(minigun, index(AmmoId.DANS))).toBe(index(AmmoId.GEGGA)); // past fotanglar
    expect(nextAmmo(weapon(WeaponId.FOTANGLAR), index(AmmoId.FOTANGLAR))).toBe(index(AmmoId.FOTANGLAR));
  });
});

describe('what an ammo does', () => {
  it('marks where every ammo lands, but the fotanglar, which lie there instead', () => {
    for (const a of AMMOS) expect(!!effectOf(a, EffectKind.SPLAT)).toBe(!effectOf(a, EffectKind.SPIKES));
  });

  it('finds an effect of a kind with its numbers, or nothing', () => {
    const dans = AMMOS[index(AmmoId.DANS)];
    expect(effectOf(dans, EffectKind.DANCE)?.s).toBeGreaterThan(0);
    expect(effectOf(dans, EffectKind.THROW)).toBeUndefined();
  });

  it('names each ammo once', () => {
    expect(new Set(AMMOS.map(a => a.id)).size).toBe(AMMOS.length);
  });
});
