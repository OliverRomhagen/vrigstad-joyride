// The weapon wheel (#526, lab: pickadoll): a ring of slots over the middle of the view, each a weapon and its ammo
// (./sim/loadout.ts). It only draws: the lab (./pickadoll.ts) opens it, says which slot is pointed at and carries out
// the pick. A page module: it uses the DOM.
import { createElement, type IconNode } from 'lucide';

/** One slot as the wheel shows it. */
export interface WheelSlot {
  name: string; // the weapon's, or Hands
  ammo: string | null; // the ammo's name, null on Hands
  icon: IconNode;
}

/** The ring of slots, built once and shown while Q or the weapon button is held. */
export class WeaponWheel {
  private readonly el: HTMLElement;
  private readonly ring: HTMLElement;
  private readonly label: HTMLElement; // in the middle: the slot pointed at, in full
  private slots: HTMLElement[] = [];
  private views: readonly WheelSlot[] = [];
  private pointed = -1;
  private isOpen = false;

  constructor(parent: HTMLElement) {
    this.el = document.createElement('div');
    this.el.id = 'lab-wheel';
    this.el.setAttribute('aria-hidden', 'true'); // read out through the middle's live label instead
    this.ring = document.createElement('div');
    this.ring.className = 'ring';
    this.label = document.createElement('p');
    this.label.className = 'label';
    this.label.id = 'lab-wheel-label';
    this.label.setAttribute('aria-live', 'polite');
    this.el.append(this.ring);
    parent.append(this.el, this.label);
  }

  get open() {
    return this.isOpen;
  }

  /** Shows the slots, clockwise from the top, with the one you hold marked. */
  show(views: readonly WheelSlot[], held: number) {
    this.views = views;
    this.slots = views.map((v, i) => {
      const slot = document.createElement('div');
      slot.className = 'slot';
      slot.classList.toggle('held', i === held);
      slot.style.setProperty('--turn', i / views.length + 'turn');
      const name = document.createElement('b');
      name.textContent = v.name;
      const ammo = document.createElement('small');
      ammo.textContent = v.ammo ?? '';
      slot.append(createElement(v.icon, { 'aria-hidden': 'true' }), name, ammo);
      return slot;
    });
    this.ring.replaceChildren(...this.slots);
    this.pointed = -1;
    this.label.textContent = '';
    this.isOpen = true;
    this.el.classList.add('open');
    this.label.classList.add('open');
  }

  /** Marks the slot pointed at, -1 for none. */
  point(index: number) {
    if (index === this.pointed) return;
    this.slots[this.pointed]?.classList.remove('pointed');
    this.pointed = index;
    this.slots[index]?.classList.add('pointed');
    const v = this.views[index];
    this.label.textContent = v ? v.name + (v.ammo ? ' · ' + v.ammo : '') : '';
  }

  /** Hides the wheel. */
  hide() {
    this.isOpen = false;
    this.el.classList.remove('open');
    this.label.classList.remove('open');
  }
}
