// Input: keys, the mouse (pointer lock and drag to look), the touch joystick and buttons. DOM events in, key state and callbacks out.
// Moved from src/game/main.ts (#177); main.ts passes in the menus' key handling and what each key or button does. Turning
// this into one set of intents (throttle / steer / brake / action) for keyboard, touch and gamepad is #50.
import { clamp } from '../world/math';

const KEYMAP: Record<string, Key> = {
  KeyW: 'up',
  ArrowUp: 'up',
  KeyS: 'down',
  ArrowDown: 'down',
  KeyA: 'left',
  ArrowLeft: 'left',
  KeyD: 'right',
  ArrowRight: 'right',
  Space: 'brake',
  ShiftLeft: 'run',
  ShiftRight: 'run',
};
// mouse look: a click on the game locks the pointer, and the mouse then turns the camera with no button held. Esc frees the cursor.
// Touch, and a mouse in a browser that refuses the lock, turn the camera by dragging.
const LOCK_K = 0.4; // a locked mouse turns this much less per pixel than a drag: it travels much further
const LOCK_MAX_PX = 120; // per event; some browsers report a huge movementX right after locking, which would spin the camera
const JOY_RADIUS_PX = 44; // the joystick knob's travel; full deflection there

export type Key = 'up' | 'down' | 'left' | 'right' | 'brake' | 'run';
/** The touch joystick: x right, y up, each -1..1; `on` while a finger holds it. */
export interface Joy {
  x: number;
  y: number;
  on: boolean;
}
/** The parts of a page element the input uses, so a test can pass a stub. */
export interface InputElement extends Pick<HTMLElement, 'addEventListener' | 'setPointerCapture' | 'hidden'> {
  readonly style: Pick<CSSStyleDeclaration, 'transform'>;
  getBoundingClientRect(): Pick<DOMRect, 'left' | 'top' | 'width' | 'height'>;
}

/** What the input reads from and calls in the rest of the game. The getters are read when used, so main.ts can declare them later. */
export interface InputDeps {
  win: EventTarget; // window: keys, focus loss and the first touch
  doc: EventTarget & { readonly pointerLockElement: object | null };
  canvas: Pick<HTMLCanvasElement, 'addEventListener' | 'setPointerCapture'> & {
    requestPointerLock?(): Promise<void> | undefined;
  }; // older browsers return nothing, or lack the lock
  $(id: string): InputElement; // the joystick, its knob, the touch pad and its buttons
  coarse: boolean; // a touchscreen: show the touch controls from the start
  readonly started: boolean;
  readonly menuOpen: boolean; // the kiosk / pet menu needs the cursor
  menuKey(e: KeyboardEvent): boolean; // the menus see each key first; true when they used it
  action(): void; // E, F, Enter or the touch action button
  respawn(): void; // R
  rain(): void; // L: låt det regna
  jump(): void; // a fresh Space / touch Brake press; main.ts decides whether a jump can start
  look(dx: number, dy: number): void; // turns the camera by this many pixels: a drag's own, or a locked mouse's scaled by LOCK_K
  lockLost(): void; // the pointer lock ended while playing with no menu open
}

/** Keyboard, mouse and touch input for the game page. Registers its listeners when built. */
export class Input {
  readonly keys: Partial<Record<Key, boolean>> = {};
  readonly joy: Joy = { x: 0, y: 0, on: false };
  private dragId: number | null = null;
  private lx = 0;
  private ly = 0;
  private joyId: number | null = null;
  private readonly g: InputDeps;

  constructor(g: InputDeps) {
    this.g = g;
    const { win, doc, canvas, $ } = g,
      { keys, joy } = this;
    win.addEventListener('keydown', ev => {
      const e = ev as KeyboardEvent;
      if (!this.g.started) return;
      const k = KEYMAP[e.code];
      if (this.g.menuKey(e)) return;
      if (k) {
        keys[k] = true;
        e.preventDefault();
        if (k === 'brake' && !e.repeat) this.g.jump();
      } else if ((e.code === 'KeyE' || e.code === 'KeyF' || e.code === 'Enter') && !e.repeat) this.g.action();
      else if (e.code === 'KeyR') this.g.respawn();
      else if (e.code === 'KeyL' && !e.repeat) this.g.rain();
    });
    win.addEventListener('keyup', ev => {
      const k = KEYMAP[(ev as KeyboardEvent).code];
      if (k) keys[k] = false;
    });
    win.addEventListener('blur', () => this.releaseKeys());
    doc.addEventListener('pointerlockchange', () => {
      if (!this.locked() && this.g.started && !this.g.menuOpen) this.g.lockLost();
    });
    canvas.addEventListener('pointerdown', e => {
      this.dragId = e.pointerId;
      this.lx = e.clientX;
      this.ly = e.clientY;
      try {
        canvas.setPointerCapture(e.pointerId);
      } catch {}
      if (this.g.started && !this.g.menuOpen && e.pointerType === 'mouse') this.lockMouse();
    }); // the kiosk menu needs the cursor
    // Only the mouse takes the locked path: a finger dragging while the mouse holds the lock keeps drag speed. The locked mouse's
    // clientX is frozen, so it must not touch lx / ly, or the next touch move jumps.
    canvas.addEventListener('pointermove', e => {
      const lk = this.locked() && e.pointerType === 'mouse';
      if (!lk && e.pointerId !== this.dragId) return;
      let dx: number, dy: number;
      if (lk) {
        dx = clamp(e.movementX, -LOCK_MAX_PX, LOCK_MAX_PX) * LOCK_K;
        dy = clamp(e.movementY, -LOCK_MAX_PX, LOCK_MAX_PX) * LOCK_K;
      } else {
        dx = e.clientX - this.lx;
        dy = e.clientY - this.ly;
        this.lx = e.clientX;
        this.ly = e.clientY;
      }
      this.g.look(dx, dy);
    });
    const endDrag = (e: PointerEvent) => {
      if (e.pointerId === this.dragId) this.dragId = null;
    };
    canvas.addEventListener('pointerup', endDrag);
    canvas.addEventListener('pointercancel', endDrag);
    const joyEl = $('joy'),
      knob = $('knob');
    const joyMove = (e: PointerEvent) => {
      const r = joyEl.getBoundingClientRect();
      let dx = e.clientX - r.left - r.width / 2,
        dy = e.clientY - r.top - r.height / 2;
      const L = Math.hypot(dx, dy),
        m = JOY_RADIUS_PX;
      if (L > m) {
        dx *= m / L;
        dy *= m / L;
      }
      joy.x = dx / m;
      joy.y = -dy / m;
      knob.style.transform = 'translate(' + dx + 'px,' + dy + 'px)';
    };
    joyEl.addEventListener('pointerdown', e => {
      this.joyId = e.pointerId;
      joy.on = true;
      try {
        joyEl.setPointerCapture(e.pointerId);
      } catch {}
      joyMove(e);
    });
    joyEl.addEventListener('pointermove', e => {
      if (e.pointerId === this.joyId) joyMove(e);
    });
    const joyEnd = (e: PointerEvent) => {
      if (e.pointerId !== this.joyId) return;
      this.joyId = null;
      joy.on = false;
      joy.x = joy.y = 0;
      knob.style.transform = '';
    };
    joyEl.addEventListener('pointerup', joyEnd);
    joyEl.addEventListener('pointercancel', joyEnd);
    const hold = (el: InputElement, k: Key) => {
      el.addEventListener('pointerdown', e => {
        keys[k] = true;
        e.preventDefault();
      });
      for (const t of ['pointerup', 'pointercancel', 'pointerleave'])
        el.addEventListener(t, () => {
          keys[k] = false;
        });
    };
    hold($('p-brake'), 'brake');
    $('p-brake').addEventListener('pointerdown', () => this.g.jump());
    $('p-act').addEventListener('click', () => this.g.action());
    const showTouch = () => {
      $('joy').hidden = false;
      $('pad').hidden = false;
    };
    if (g.coarse) showTouch();
    else win.addEventListener('touchstart', showTouch, { once: true, passive: true });
  }

  /** A drag (finger or unlocked mouse) is turning the camera; the car camera waits for it to end before it swings back. */
  get dragging() {
    return this.dragId !== null;
  }

  locked() {
    return this.g.doc.pointerLockElement === this.g.canvas;
  }

  /** Lets go of every held key, as when the window loses focus or the dev console takes the keys. */
  releaseKeys() {
    for (const k in this.keys) this.keys[k as Key] = false;
  }

  lockMouse() {
    const { canvas } = this.g;
    if (this.locked() || !canvas.requestPointerLock) return;
    try {
      const p = canvas.requestPointerLock();
      if (p?.catch) p.catch(() => {});
    } catch {}
  }
}
