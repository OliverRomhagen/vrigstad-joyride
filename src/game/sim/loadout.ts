// The weapon wheel's slots (#526, lab: pickadoll): each slot is a loadout, a weapon with one ammo, or Hands with none.
// Holding Q or the weapon button opens the wheel; the page module (../pickadoll.ts) draws it (../weapon-wheel.ts) and
// carries out a pick through the `slot` command. Plain data: which slot is pointed at, which is held, which you own.
import { AmmoId } from './ammo';
import { WeaponId } from './shots';

/** What is in your hand: a weapon and the ammo it fires, or Hands (weapon and ammo null). */
export interface Loadout {
  weapon: WeaponId | null;
  ammo: AmmoId | null;
}

const HANDS: Loadout = { weapon: null, ammo: null };

/**
 * The wheel's slots, clockwise from the top. The same weapon can sit in two slots with different ammo, so a slot
 * stands for picking a weapon and its ammo at once. Nine fit a ring a thumb can point at; once the inventory (#339)
 * says what you own, the slots of weapons you don't own are left out (ownedSlots).
 */
export const DEFAULT_SLOTS: readonly Loadout[] = [
  HANDS,
  { weapon: WeaponId.PICKADOLL, ammo: AmmoId.GEGGA },
  { weapon: WeaponId.PICKADOLL, ammo: AmmoId.DANS },
  { weapon: WeaponId.HAGELBOSSA, ammo: AmmoId.PANG },
  { weapon: WeaponId.MINIGUN, ammo: AmmoId.GEGGA },
  { weapon: WeaponId.POTATISKANON, ammo: AmmoId.PANG },
  { weapon: WeaponId.ALGSTUDSARE, ammo: AmmoId.GEGGA },
  { weapon: WeaponId.GRANAT, ammo: AmmoId.PANG },
  { weapon: WeaponId.FOTANGLAR, ammo: AmmoId.FOTANGLAR },
];

/** The two hold the same weapon with the same ammo, or are both Hands. */
export function sameLoadout(a: Loadout, b: Loadout): boolean {
  return a.weapon === b.weapon && (a.weapon === null || a.ammo === b.ammo);
}

/** The slots you can pick: Hands always, and a weapon's only when you own it. */
export function ownedSlots(slots: readonly Loadout[], owns: (weapon: WeaponId) => boolean): Loadout[] {
  return slots.filter(s => s.weapon === null || owns(s.weapon));
}

/** The slot that holds what is in your hand, or -1 when none does (Q and G can make a loadout no slot has). */
export function heldSlot(slots: readonly Loadout[], held: Loadout): number {
  return slots.findIndex(s => sameLoadout(s, held));
}

/**
 * The slot pointed at by a move of dx, dy (px, y down) from the middle of a wheel of `count` slots, the first at the
 * top and the rest clockwise; -1 inside the dead zone, where letting go picks nothing.
 */
export function pointedSlot(dx: number, dy: number, count: number, deadPx: number): number {
  if (count <= 0 || Math.hypot(dx, dy) < deadPx) return -1;
  const turn = Math.atan2(dx, -dy) / (2 * Math.PI); // 0 at the top, a quarter to the right
  return ((Math.round(turn * count) % count) + count) % count;
}

/** Where the wheel's pointer goes after a move: it follows the mouse or the finger, but no further out than reachPx. */
export function movePointer(p: { x: number; y: number }, dx: number, dy: number, reachPx: number): void {
  p.x += dx;
  p.y += dy;
  const d = Math.hypot(p.x, p.y);
  if (d > reachPx) {
    p.x *= reachPx / d;
    p.y *= reachPx / d;
  }
}

/**
 * What you held before and what you hold now, for swapping back. `changeTo` is called with each new loadout, from the
 * wheel, Q, G or the console alike, so the one before is always the last you held.
 */
export interface LoadoutHistory {
  now: Loadout;
  last: Loadout | null;
}

export function changeTo(h: LoadoutHistory, next: Loadout): void {
  if (sameLoadout(h.now, next)) return;
  h.last = h.now;
  h.now = { ...next };
}
