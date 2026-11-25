// Input: keys, the mouse (pointer lock and drag to look), the touch joystick and buttons. DOM events in, key state and callbacks out.
// Moved from src/game/main.ts (#177); main.ts passes in the menus' key handling and what each key or button does. Turning
// this into one set of intents (throttle / steer / brake / action) for keyboard, touch and gamepad is #50. Until then a
// module that needs a key or a button of its own adds a control (`addControl`, below) and never listens itself (rule 3).
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

// The game's own keys besides KEYMAP's, and what each one calls in InputDeps. A held key doesn't press again, but R
// does: holding it respawns again and again. A module's control can't take these.
const GAME_KEYS: Record<string, 'action' | 'respawn' | 'rain'> = {
  KeyE: 'action',
  KeyF: 'action',
  Enter: 'action',
  KeyR: 'respawn',
  KeyL: 'rain',
};
// Other keys a module's control can't take: the menus' (menu.ts) and the dev console's (devconsole.ts), which opens on
// the character § or `, so on another layout it can be another key too.
const RESERVED_CODES = ['NumpadEnter', 'Escape', 'KeyP', 'Backquote', 'IntlBackslash'];
const BUTTON_BITS = [1, 4, 2]; // PointerEvent.button (left, middle, right) as its bit in PointerEvent.buttons

export type Key = 'up' | 'down' | 'left' | 'right' | 'brake' | 'run';
/** The mouse buttons a control can take, as their bits in PointerEvent.buttons. */
export const MouseButton = { LEFT: 1, RIGHT: 2 } as const;
export type MouseButton = (typeof MouseButton)[keyof typeof MouseButton];
/**
 * What a module's control is held by, and what holding it does. A press counts only while the game is played: not
 * before Start, and not while a menu or the dev console is open. A key or a touch button already held when a menu
 * opens stays held until it is let go, so the module still decides what holding it does then; a mouse button is let
 * go at once, as the menu takes the lock.
 */
export interface ControlSpec {
  codes?: readonly string[]; // keys, as KeyboardEvent.code. With ctrl, alt or ⌘ held they are the browser's
  mouseButton?: MouseButton; // counts only while the mouse is locked on the game: the click that locks it never presses
  press?(): void; // at each fresh press of a key or a button of it: twice when two of them are pressed together,
  release?(): void; // and this once, when the last of them is let go. Don't count one against the other
}
/** A control a module added with `Input.addControl`. */
export interface Control {
  /** True while a key or a button of it is held. */
  readonly held: boolean;
  /** Makes a touch button of the module's own hold the control while a finger is on it. */
  hold(el: Pick<InputElement, 'addEventListener'>): void;
}
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
  readonly consoleOpen: boolean; // the dev console: a module's control can't be pressed under it
  menuKey(e: KeyboardEvent): boolean; // the menus see each key first; true when they used it
  action(): void; // E, F, Enter or the touch action button
  respawn(): void; // R
  rain(): void; // L: låt det regna
  jump(): void; // a fresh Space / touch Brake press; main.ts decides whether a jump can start
  look(dx: number, dy: number): void; // turns the camera by this many pixels: a drag's own, or a locked mouse's scaled by LOCK_K
  zoom(factor: number): void; // multiplies the camera distance: above 1 is further out
  lockLost(): void; // the pointer lock ended while playing with no menu open
}

// A touch button, the game's own or a control's: down with the finger, up when it lifts or leaves the button
function onHold(el: Pick<InputElement, 'addEventListener'>, down: () => void, up: () => void) {
  el.addEventListener('pointerdown', e => {
    down();
    e.preventDefault();
  });
  for (const t of ['pointerup', 'pointercancel', 'pointerleave']) el.addEventListener(t, up);
}

// A module's control and what holds it right now: a key's code, 'mouse', or a touch button's element.
class HeldControl implements Control {
  private readonly holders = new Set<string | object>();
  // copied when the control is added, as Input's lookups are built from them then
  readonly codes: readonly string[];
  readonly mouseButton: MouseButton | 0;

  constructor(
    private readonly spec: ControlSpec,
    private readonly playing: () => boolean, // started, and no menu or console open
  ) {
    this.codes = [...(spec.codes ?? [])];
    this.mouseButton = spec.mouseButton ?? 0;
  }

  get held() {
    return this.holders.size > 0;
  }

  take(by: string | object) {
    if (this.holders.has(by) || !this.playing()) return;
    this.holders.add(by);
    this.spec.press?.();
  }

  drop(by: string | object) {
    if (this.holders.delete(by) && !this.holders.size) this.spec.release?.();
  }

  dropAll() {
    if (!this.holders.size) return;
    this.holders.clear();
    this.spec.release?.();
  }

  hold(el: Pick<InputElement, 'addEventListener'>) {
    onHold(
      el,
      () => this.take(el),
      () => this.drop(el),
    );
  }
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
  private readonly controls: HeldControl[] = [];
  private readonly byCode = new Map<string, HeldControl>();
  private mouseButtons = 0; // the mouse buttons down, as PointerEvent.buttons
  private mouseMask = 0; // the mouse buttons the controls took, as PointerEvent.buttons
  private readonly g: InputDeps;

  constructor(g: InputDeps) {
    this.g = g;
    const { win, doc, canvas, $ } = g,
      { keys, joy } = this;
    win.addEventListener('keydown', ev => {
      const e = ev as KeyboardEvent;
      if (!this.g.started) return;
      const k = KEYMAP[e.code],
        command = GAME_KEYS[e.code];
      if (this.g.menuKey(e)) return;
      if (k) {
        keys[k] = true;
        e.preventDefault();
        if (k === 'brake' && !e.repeat) this.g.jump();
      } else if (command) {
        if (!e.repeat || command === 'respawn') this.g[command]();
      }
      // a repeat too: a key held since before Start or a menu closed then presses the control, as it moves the player
      else if (!e.ctrlKey && !e.metaKey && !e.altKey) this.byCode.get(e.code)?.take(e.code);
    });
    win.addEventListener('keyup', ev => {
      const code = (ev as KeyboardEvent).code,
        k = KEYMAP[code];
      if (k) keys[k] = false;
      else this.byCode.get(code)?.drop(code);
    });
    win.addEventListener('blur', () => this.releaseKeys());
    doc.addEventListener('pointerlockchange', () => {
      if (this.locked()) return;
      // A menu or Esc took the lock, and the button may be let go over something else than the game, where its
      // pointerup never comes here: no control is held by the mouse any more
      this.mouseButtons = 0;
      this.eachControl(c => c.drop('mouse'));
      if (this.g.started && !this.g.menuOpen) this.g.lockLost();
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
    // The mouse buttons of the modules' controls. A button pressed while another is down comes as a pointermove, not a
    // pointerdown, and only the last one let go as a pointerup, so each is read from the buttons held.
    const readButtons = (e: PointerEvent) => {
      if (e.pointerType !== 'mouse' || !this.mouseMask) return;
      // a button that goes down was up, whatever was last seen of it: its pointerup can have gone elsewhere
      if (e.type === 'pointerdown') this.mouseButtons &= ~(BUTTON_BITS[e.button] ?? 0);
      const pressed = e.buttons & ~this.mouseButtons,
        letGo = this.mouseButtons & ~e.buttons;
      this.mouseButtons = e.buttons;
      if (!((pressed | letGo) & this.mouseMask)) return;
      this.eachControl(c => {
        if (pressed & c.mouseButton && this.locked()) c.take('mouse');
        if (letGo & c.mouseButton) c.drop('mouse');
      });
    };
    for (const t of ['pointerdown', 'pointermove', 'pointerup', 'pointercancel'])
      canvas.addEventListener(t, e => readButtons(e as PointerEvent));
    // the right button is a control's when one took it, not the browser's menu
    canvas.addEventListener('contextmenu', e => {
      if (this.mouseMask & MouseButton.RIGHT) e.preventDefault();
    });
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
    onHold(
      $('p-brake'),
      () => {
        keys.brake = true;
      },
      () => {
        keys.brake = false;
      },
    );
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

  /** Lets go of every held key and control, as when the window loses focus or the dev console takes the keys. */
  releaseKeys() {
    for (const k in this.keys) this.keys[k as Key] = false;
    this.eachControl(c => c.dropAll());
  }

  // A module's press or release that throws must not keep the other controls from being pressed or let go: each runs,
  // and the first error is thrown after them
  private eachControl(fn: (c: HeldControl) => void) {
    let failed: { err: unknown } | undefined;
    for (const c of this.controls)
      try {
        fn(c);
      } catch (err) {
        failed ??= { err };
      }
    if (failed) throw failed.err;
  }

  /**
   * Adds a control for a module: held while one of its keys, its mouse button or a touch button of its own is down.
   * The dev console and the menus see each key first, as they do the game's own. Throws when a key or the mouse
   * button is already taken, by the game, a menu, the console or another control, and adds nothing then.
   */
  addControl(spec: ControlSpec): Control {
    const bound = new HeldControl(spec, () => this.g.started && !this.g.menuOpen && !this.g.consoleOpen);
    for (const code of bound.codes)
      if (KEYMAP[code] || GAME_KEYS[code] || RESERVED_CODES.includes(code) || this.byCode.has(code))
        throw new Error(`Input: ${code} is already taken`);
    if (this.mouseMask & bound.mouseButton)
      throw new Error(`Input: mouse button ${bound.mouseButton} is already taken`);
    this.controls.push(bound);
    for (const code of bound.codes) this.byCode.set(code, bound);
    this.mouseMask |= bound.mouseButton;
    return bound;
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
