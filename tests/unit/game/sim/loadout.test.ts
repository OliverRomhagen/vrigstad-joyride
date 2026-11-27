import { describe, expect, it } from 'vitest';
import { AmmoId, accepts } from '../../../../src/game/sim/ammo';
import {
  changeTo,
  DEFAULT_SLOTS,
  heldSlot,
  type Loadout,
  type LoadoutHistory,
  movePointer,
  ownedSlots,
  pointedSlot,
  sameLoadout,
} from '../../../../src/game/sim/loadout';
import { WEAPONS, WeaponId } from '../../../../src/game/sim/shots';

const HANDS: Loadout = { weapon: null, ammo: null };
const pick = (ammo: AmmoId): Loadout => ({ weapon: WeaponId.PICKADOLL, ammo });

describe('the default slots', () => {
  it('start with Hands, and each weapon fires the ammo its slot gives it', () => {
    expect(DEFAULT_SLOTS[0]).toEqual(HANDS);
    for (const s of DEFAULT_SLOTS.slice(1)) {
      const w = WEAPONS.find(x => x.id === s.weapon);
      expect(w, String(s.weapon)).toBeDefined();
      expect(accepts(w!, s.ammo!), `${s.weapon} ${s.ammo}`).toBe(true);
    }
  });

  it('can hold one weapon twice, with different ammo, but never the same loadout twice', () => {
    expect(DEFAULT_SLOTS.filter(s => s.weapon === WeaponId.PICKADOLL)).toHaveLength(2);
    for (const [i, s] of DEFAULT_SLOTS.entries()) expect(heldSlot(DEFAULT_SLOTS, s)).toBe(i);
  });
});

describe('which slot holds what is in your hand', () => {
  it('matches the weapon and its ammo, and Hands whatever ammo was picked last', () => {
    expect(heldSlot(DEFAULT_SLOTS, pick(AmmoId.DANS))).toBe(2);
    expect(heldSlot(DEFAULT_SLOTS, { weapon: null, ammo: AmmoId.PANG })).toBe(0);
  });

  it('is none for a loadout Q and G made that no slot has', () => {
    expect(heldSlot(DEFAULT_SLOTS, pick(AmmoId.PANG))).toBe(-1);
  });
});

describe('the slots you own', () => {
  it('skip a weapon you do not own, and always keep Hands', () => {
    const slots = ownedSlots(DEFAULT_SLOTS, w => w === WeaponId.PICKADOLL);
    expect(slots).toEqual([HANDS, pick(AmmoId.GEGGA), pick(AmmoId.DANS)]);
    expect(ownedSlots(DEFAULT_SLOTS, () => false)).toEqual([HANDS]);
  });
});

describe('the slot pointed at', () => {
  it('is the first straight up, and goes on clockwise', () => {
    expect(pointedSlot(0, -50, 4, 20)).toBe(0);
    expect(pointedSlot(50, 0, 4, 20)).toBe(1);
    expect(pointedSlot(0, 50, 4, 20)).toBe(2);
    expect(pointedSlot(-50, 0, 4, 20)).toBe(3);
  });

  it('is the nearest slot between two', () => {
    // with 9 slots, each is 40° wide: 30° right of up is still the second, 10° left of up still the first
    const at = (deg: number) =>
      pointedSlot(Math.sin((deg * Math.PI) / 180) * 50, -Math.cos((deg * Math.PI) / 180) * 50, 9, 20);
    expect(at(30)).toBe(1);
    expect(at(-10)).toBe(0);
    expect(at(-30)).toBe(8);
  });

  it('is none inside the dead zone, or on a wheel with no slots', () => {
    expect(pointedSlot(10, -10, 4, 20)).toBe(-1);
    expect(pointedSlot(0, -50, 0, 20)).toBe(-1);
  });
});

describe("the wheel's pointer", () => {
  it('follows the moves, but stops at the reach', () => {
    const p = { x: 0, y: 0 };
    movePointer(p, 30, 0, 90);
    expect(p).toEqual({ x: 30, y: 0 });
    movePointer(p, 0, -400, 90);
    expect(Math.hypot(p.x, p.y)).toBeCloseTo(90);
    expect(p.y).toBeLessThan(0);
  });
});

describe('swapping back', () => {
  it('remembers the loadout before the one you hold, from any change', () => {
    const h: LoadoutHistory = { now: HANDS, last: null };
    changeTo(h, pick(AmmoId.GEGGA));
    changeTo(h, pick(AmmoId.DANS)); // G: a new ammo is a new loadout
    expect(h.last).toEqual(pick(AmmoId.GEGGA));
    expect(h.now).toEqual(pick(AmmoId.DANS));
  });

  it('ignores a change to what you already hold', () => {
    const h: LoadoutHistory = { now: HANDS, last: null };
    changeTo(h, pick(AmmoId.GEGGA));
    changeTo(h, pick(AmmoId.GEGGA));
    expect(h.last).toEqual(HANDS);
    expect(sameLoadout(HANDS, { weapon: null, ammo: AmmoId.GEGGA })).toBe(true);
  });
});
