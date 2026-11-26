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
// camera zoom (#208): the wheel, a trackpad pinch (ctrl + wheel) and a two-finger pinch zoom the camera, not the page
const WHEEL_ZOOM_K = 0.0015,
  PINCH_WHEEL_ZOOM_K = 0.01; // zoom per pixel of wheel delta: a trackpad pinch sends small deltas
const PINCH_MAX_PX = 40; // a ctrl + wheel event above this is a mouse wheel turned with ctrl held (a notch is ~100 px), not a pinch
const WHEEL_LINE_PX = 16; // a wheel that reports lines instead of pixels (deltaMode 1)
// ctrl/⌘ with these zooms the page. The typed character covers every layout (on a Nordic or German one, `-` is on `Slash`),
// the physical keys cover the numpad and shifted `+`. Ctrl/⌘ + 0 stays free: it resets a page zoom the browser remembers.
const PAGE_ZOOM_CHARS = /^[-+=]$/,
  PAGE_ZOOM_KEYS = /^(Equal|Minus|NumpadAdd|NumpadSubtract)$/;

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
  toggleView(): void; // V, or the touch View button: the driver's view in a car, where the lab has it (#473)
  emotes(): void; // G, or the touch Emote button: the emote picker (#296)
  jump(): void; // a fresh Space / touch Brake press; main.ts decides whether a jump can start
  look(dx: number, dy: number): void; // turns the camera by this many pixels: a drag's own, or a locked mouse's scaled by LOCK_K
  zoom(factor: number): void; // multiplies the camera distance: above 1 is further out
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
  private readonly pinch = new Map<number, { x: number; y: number }>(); // touches on the game, by pointer id
  private pinchD = 0; // the two touches' last distance apart (px); 0 until two are down
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
      else if (e.code === 'KeyV' && !e.repeat) this.g.toggleView();
      else if (e.code === 'KeyG' && !e.repeat) this.g.emotes();
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
    // The browser's own zoom scales and crops the whole page, so it is blocked: ctrl/⌘ + wheel, ctrl/⌘ + − = 0 and Safari's
    // gesture events. The viewport meta and touch-action in index.html stop pinch and double-tap on phones.
    win.addEventListener(
      'wheel',
      ev => {
        if ((ev as WheelEvent).ctrlKey) ev.preventDefault();
      },
      { passive: false },
    );
    // only on the game: elsewhere, e.g. the intro, the wheel scrolls
    canvas.addEventListener(
      'wheel',
      e => {
        e.preventDefault();
        const px = e.deltaY * (e.deltaMode ? WHEEL_LINE_PX : 1);
        const isPinch = e.ctrlKey && !e.deltaMode && Math.abs(px) < PINCH_MAX_PX;
        this.g.zoom(Math.exp(px * (isPinch ? PINCH_WHEEL_ZOOM_K : WHEEL_ZOOM_K)));
      },
      { passive: false },
    );
    win.addEventListener('keydown', ev => {
      const e = ev as KeyboardEvent;
      if ((e.ctrlKey || e.metaKey) && (PAGE_ZOOM_CHARS.test(e.key) || PAGE_ZOOM_KEYS.test(e.code))) e.preventDefault();
    });
    for (const t of ['gesturestart', 'gesturechange', 'gestureend']) doc.addEventListener(t, e => e.preventDefault());
    // Two fingers on the game pinch instead of turning the camera; the joystick and buttons are other elements, so they
    // don't count. Registered after the drag's pointerdown, so a second (or third) finger ends the drag it started; when only
    // one finger is left, it turns the camera again.
    const { pinch } = this;
    const spread = () => {
      const [a, b] = pinch.values();
      return Math.hypot(a.x - b.x, a.y - b.y);
    };
    canvas.addEventListener('pointerdown', e => {
      if (e.pointerType !== 'touch') return;
      pinch.set(e.pointerId, { x: e.clientX, y: e.clientY });
      if (pinch.size >= 2) this.dragId = null;
      if (pinch.size === 2) this.pinchD = spread();
    });
    canvas.addEventListener('pointermove', e => {
      const p = pinch.get(e.pointerId);
      if (!p) return;
      p.x = e.clientX;
      p.y = e.clientY;
      if (pinch.size !== 2) return;
      const d = spread();
      if (this.pinchD > 0 && d > 0) this.g.zoom(this.pinchD / d);
      this.pinchD = d;
    });
    const endPinch = (e: PointerEvent) => {
      if (!pinch.delete(e.pointerId)) return;
      this.pinchD = 0;
      if (pinch.size !== 1) return;
      const [[id, p]] = pinch;
      this.dragId = id;
      this.lx = p.x;
      this.ly = p.y;
    };
    canvas.addEventListener('pointerup', endPinch);
    canvas.addEventListener('pointercancel', endPinch);
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
    $('p-view').addEventListener('click', () => this.g.toggleView());
    $('p-emote').addEventListener('click', () => this.g.emotes());
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
