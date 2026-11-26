import { describe, expect, it } from 'vitest';
import { Input, type InputDeps, MouseButton } from '../../../src/game/input';

// Node has EventTarget and Event, so the input gets real listeners on stub elements; each stub carries only what the input touches.
type Stub = EventTarget & {
  hidden: boolean;
  style: { transform: string };
  captured: number[];
  setPointerCapture(id: number): void;
  getBoundingClientRect(): { left: number; top: number; width: number; height: number };
};
function stub(): Stub {
  const el = new EventTarget() as Stub;
  el.hidden = true;
  el.style = { transform: '' };
  el.captured = [];
  el.setPointerCapture = id => {
    el.captured.push(id);
  };
  el.getBoundingClientRect = () => ({ left: 0, top: 0, width: 100, height: 100 }); // the joystick's centre is at (50, 50)
  return el;
}
function fire(target: EventTarget, type: string, props: Record<string, unknown> = {}) {
  const e = Object.assign(new Event(type, { cancelable: true }), props);
  target.dispatchEvent(e);
  return e;
}

function input(
  opts: {
    coarse?: boolean;
    started?: boolean;
    menuKey?: (e: KeyboardEvent) => boolean;
    keyTaken?: (code: string) => boolean;
  } = {},
) {
  const win = new EventTarget(),
    els: Record<string, Stub> = {};
  const doc = Object.assign(new EventTarget(), { pointerLockElement: null as object | null });
  const canvas = Object.assign(stub(), {
    locks: 0,
    requestPointerLock() {
      canvas.locks++;
      return undefined;
    },
  });
  const calls: string[] = [],
    looks: [number, number][] = [],
    zooms: number[] = [];
  const game = { started: opts.started ?? true, menuOpen: false, consoleOpen: false };
  const deps: InputDeps = {
    win,
    doc,
    canvas,
    $: id => (els[id] ??= stub()),
    coarse: opts.coarse ?? false,
    get started() {
      return game.started;
    },
    get menuOpen() {
      return game.menuOpen;
    },
    get consoleOpen() {
      return game.consoleOpen;
    },
    menuKey: opts.menuKey ?? (() => false),
    keyTaken: opts.keyTaken ?? (() => false),
    action: () => {
      calls.push('action');
    },
    respawn: () => {
      calls.push('respawn');
    },
    rain: () => {
      calls.push('rain');
    },
    toggleView: () => {
      calls.push('view');
    },
    jump: () => {
      calls.push('jump');
    },
    look: (dx, dy) => {
      looks.push([dx, dy]);
    },
    zoom: f => {
      zooms.push(f);
    },
    lockLost: () => {
      calls.push('lockLost');
    },
  };
  return { i: new Input(deps), win, doc, canvas, els, calls, looks, zooms, game };
}

describe('Input', () => {
  it('holds WASD and the arrows while pressed, and lets go of every key when the window loses focus', () => {
    const { i, win } = input();
    fire(win, 'keydown', { code: 'KeyW' });
    fire(win, 'keydown', { code: 'ArrowLeft' });
    expect(i.keys).toMatchObject({ up: true, left: true });
    fire(win, 'keyup', { code: 'KeyW' });
    expect(i.keys.up).toBe(false);
    fire(win, 'blur');
    expect(i.keys.left).toBe(false);
  });

  it('ignores the keys before Start', () => {
    const { i, win, calls } = input({ started: false });
    fire(win, 'keydown', { code: 'KeyW' });
    fire(win, 'keydown', { code: 'KeyE' });
    expect(i.keys.up).toBeUndefined();
    expect(calls).toEqual([]);
  });

  it('jumps on a fresh Space press only, and E, F or Enter act once per press', () => {
    const { win, calls } = input();
    const e = fire(win, 'keydown', { code: 'Space' });
    fire(win, 'keydown', { code: 'Space', repeat: true });
    fire(win, 'keydown', { code: 'KeyE' });
    fire(win, 'keydown', { code: 'KeyE', repeat: true });
    fire(win, 'keydown', { code: 'Enter' });
    fire(win, 'keydown', { code: 'KeyR' });
    fire(win, 'keydown', { code: 'KeyL' });
    fire(win, 'keydown', { code: 'KeyL', repeat: true });
    fire(win, 'keydown', { code: 'KeyV' });
    fire(win, 'keydown', { code: 'KeyV', repeat: true });
    expect(calls).toEqual(['jump', 'action', 'action', 'respawn', 'rain', 'view']);
    expect(e.defaultPrevented).toBe(true); // Space doesn't scroll the page
  });

  it('lets a menu take a key first', () => {
    const { i, win, calls } = input({ menuKey: e => e.code === 'KeyE' || e.code === 'KeyW' });
    fire(win, 'keydown', { code: 'KeyE' });
    fire(win, 'keydown', { code: 'KeyW' });
    expect(calls).toEqual([]);
    expect(i.keys.up).toBeUndefined();
  });

  it('turns the camera by the drag, and only for the pointer that started it', () => {
    const { i, canvas, looks } = input();
    fire(canvas, 'pointerdown', { pointerId: 1, clientX: 10, clientY: 10, pointerType: 'touch' });
    expect(i.dragging).toBe(true);
    fire(canvas, 'pointermove', { pointerId: 2, clientX: 99, clientY: 99, pointerType: 'touch' });
    fire(canvas, 'pointermove', { pointerId: 1, clientX: 15, clientY: 7, pointerType: 'touch' });
    fire(canvas, 'pointerup', { pointerId: 1 });
    expect(looks).toEqual([[5, -3]]);
    expect(i.dragging).toBe(false);
    expect(canvas.captured).toEqual([1]); // the canvas keeps getting the drag's moves when the finger leaves it
    expect(canvas.locks).toBe(0); // a touch never asks for the pointer lock
  });

  it('turns a locked mouse slower per pixel, and caps the jump some browsers report right after locking', () => {
    const { canvas, doc, looks } = input();
    doc.pointerLockElement = canvas;
    fire(canvas, 'pointermove', { pointerId: 1, movementX: 10, movementY: -500, pointerType: 'mouse' });
    expect(looks).toEqual([[4, -48]]);
  });

  it('locks the mouse on a click unless a menu is open, and says so when the lock ends', () => {
    const { canvas, doc, calls, game } = input();
    fire(canvas, 'pointerdown', { pointerId: 1, pointerType: 'mouse' });
    expect(canvas.locks).toBe(1);
    game.menuOpen = true;
    fire(canvas, 'pointerdown', { pointerId: 1, pointerType: 'mouse' });
    expect(canvas.locks).toBe(1);
    fire(doc, 'pointerlockchange');
    game.menuOpen = false;
    fire(doc, 'pointerlockchange');
    expect(calls).toEqual(['lockLost']);
  });

  it('neither locks the mouse nor says it lost the lock before Start', () => {
    const { canvas, doc, calls } = input({ started: false });
    fire(canvas, 'pointerdown', { pointerId: 1, pointerType: 'mouse' });
    fire(doc, 'pointerlockchange');
    expect(canvas.locks).toBe(0);
    expect(calls).toEqual([]);
  });

  it('reads the joystick as -1..1, up positive, capped at the knob travel, and centres it on release', () => {
    const { i, els } = input();
    fire(els.joy, 'pointerdown', { pointerId: 3, clientX: 72, clientY: 50 }); // 22 px right of centre: half travel
    expect(i.joy.x).toBeCloseTo(0.5);
    expect(i.joy.y).toBeCloseTo(0);
    expect(i.joy.on).toBe(true);
    expect(els.joy.captured).toEqual([3]);
    fire(els.joy, 'pointermove', { pointerId: 3, clientX: 50, clientY: -50 }); // 100 px up: capped at full
    expect(i.joy.x).toBeCloseTo(0);
    expect(i.joy.y).toBe(1);
    fire(els.joy, 'pointerup', { pointerId: 3 });
    expect(i.joy).toEqual({ x: 0, y: 0, on: false });
    expect(els.knob.style.transform).toBe('');
  });

  it('holds Brake while the touch button is down, which also asks for a jump, and the action button acts', () => {
    const { i, els, calls } = input();
    fire(els['p-brake'], 'pointerdown');
    expect(i.keys.brake).toBe(true);
    fire(els['p-brake'], 'pointerleave');
    expect(i.keys.brake).toBe(false);
    fire(els['p-act'], 'click');
    fire(els['p-view'], 'click');
    expect(calls).toEqual(['jump', 'action', 'view']);
  });

  it('zooms out with the wheel on the game, and blocks the browser zoom anywhere', () => {
    const { win, canvas, zooms } = input();
    const out = fire(canvas, 'wheel', { deltaY: 100, deltaMode: 0, ctrlKey: false });
    expect(zooms[0]).toBeCloseTo(Math.exp(0.15));
    expect(out.defaultPrevented).toBe(true);
    expect(fire(win, 'wheel', { ctrlKey: false }).defaultPrevented).toBe(false); // the intro still scrolls
    expect(fire(win, 'wheel', { ctrlKey: true }).defaultPrevented).toBe(true); // a trackpad pinch
    expect(fire(win, 'keydown', { code: 'Equal', key: '=', metaKey: true }).defaultPrevented).toBe(true);
    expect(zooms).toHaveLength(1);
  });

  it('blocks ctrl + − on every layout, and lets ctrl + 0 reset the page zoom', () => {
    const { win } = input();
    expect(fire(win, 'keydown', { code: 'Slash', key: '-', ctrlKey: true }).defaultPrevented).toBe(true); // Swedish −
    expect(fire(win, 'keydown', { code: 'NumpadAdd', key: '+', ctrlKey: true }).defaultPrevented).toBe(true);
    expect(fire(win, 'keydown', { code: 'Digit0', key: '0', ctrlKey: true }).defaultPrevented).toBe(false);
    expect(fire(win, 'keydown', { code: 'Slash', key: '-' }).defaultPrevented).toBe(false); // no ctrl: just a key
  });

  it('zooms a mouse wheel turned with ctrl held at the wheel rate, and a trackpad pinch faster', () => {
    const { canvas, zooms } = input();
    fire(canvas, 'wheel', { deltaY: 100, deltaMode: 0, ctrlKey: true }); // a mouse notch
    fire(canvas, 'wheel', { deltaY: 3, deltaMode: 1, ctrlKey: true }); // a notch reported in lines
    fire(canvas, 'wheel', { deltaY: 4, deltaMode: 0, ctrlKey: true }); // a pinch step
    expect(zooms[0]).toBeCloseTo(Math.exp(0.15));
    expect(zooms[1]).toBeCloseTo(Math.exp(48 * 0.0015));
    expect(zooms[2]).toBeCloseTo(Math.exp(0.04));
  });

  it('pinches with two fingers on the game, which also ends the drag', () => {
    const { i, canvas, zooms, looks } = input();
    fire(canvas, 'pointerdown', { pointerId: 1, pointerType: 'touch', clientX: 0, clientY: 0 });
    fire(canvas, 'pointerdown', { pointerId: 2, pointerType: 'touch', clientX: 100, clientY: 0 });
    expect(i.dragging).toBe(false);
    fire(canvas, 'pointermove', { pointerId: 2, pointerType: 'touch', clientX: 200, clientY: 0 }); // fingers apart: closer in
    expect(zooms).toEqual([0.5]);
    fire(canvas, 'pointermove', { pointerId: 1, pointerType: 'touch', clientX: 10, clientY: 0 });
    expect(looks).toEqual([]);
    fire(canvas, 'pointerup', { pointerId: 2 });
    expect(i.dragging).toBe(true); // the finger left turns the camera again, from where it is now
    fire(canvas, 'pointermove', { pointerId: 1, pointerType: 'touch', clientX: 50, clientY: 0 });
    expect(zooms).toHaveLength(2);
    expect(looks).toEqual([[40, 0]]);
  });

  it('keeps a third finger from turning the camera during a pinch', () => {
    const { i, canvas, looks } = input();
    fire(canvas, 'pointerdown', { pointerId: 1, pointerType: 'touch', clientX: 0, clientY: 0 });
    fire(canvas, 'pointerdown', { pointerId: 2, pointerType: 'touch', clientX: 100, clientY: 0 });
    fire(canvas, 'pointerdown', { pointerId: 3, pointerType: 'touch', clientX: 50, clientY: 50 });
    expect(i.dragging).toBe(false);
    fire(canvas, 'pointermove', { pointerId: 3, pointerType: 'touch', clientX: 80, clientY: 50 });
    expect(looks).toEqual([]);
  });

  it('shows the touch controls on a touchscreen, or at the first touch', () => {
    expect(input({ coarse: true }).els.pad.hidden).toBe(false);
    const { win, els } = input();
    fire(win, 'touchstart');
    expect([els.joy.hidden, els.pad.hidden]).toEqual([false, false]);
  });
});

describe('Input.addControl', () => {
  // a control that writes down each press and release
  function fireControl(over: Parameters<Input['addControl']>[0] = {}) {
    const t = input(),
      log: string[] = [];
    const control = t.i.addControl({
      codes: ['KeyX'],
      mouseButton: MouseButton.LEFT,
      press: () => log.push('press'),
      release: () => log.push('release'),
      ...over,
    });
    return { ...t, control, log };
  }
  const mouse = (canvas: EventTarget, type: string, buttons: number) =>
    fire(canvas, type, { pointerId: 1, pointerType: 'mouse', buttons, movementX: 0, movementY: 0 });

  it('is held while its key is down, and pressed once however long the key repeats', () => {
    const { win, control, log } = fireControl();
    fire(win, 'keydown', { code: 'KeyX' });
    fire(win, 'keydown', { code: 'KeyX', repeat: true });
    expect(control.held).toBe(true);
    fire(win, 'keyup', { code: 'KeyX' });
    expect(control.held).toBe(false);
    expect(log).toEqual(['press', 'release']);
  });

  it('leaves its key alone before Start, when a menu takes it, and with ctrl, alt or ⌘ held', () => {
    const before = input({ started: false }),
      menu = input({ menuKey: () => true }),
      plain = input();
    for (const t of [before, menu, plain]) {
      const control = t.i.addControl({ codes: ['KeyC'] });
      fire(t.win, 'keydown', { code: 'KeyC', metaKey: t === plain }); // ⌘C copies
      expect(control.held).toBe(false);
    }
    const control = plain.i.addControl({ codes: ['KeyG'] });
    fire(plain.win, 'keydown', { code: 'KeyG', ctrlKey: true });
    fire(plain.win, 'keydown', { code: 'KeyG', altKey: true });
    expect(control.held).toBe(false);
    plain.game.menuOpen = true; // open, though it left the key alone
    fire(plain.win, 'keydown', { code: 'KeyG' });
    expect(control.held).toBe(false);
  });

  it('is let go by its key after a menu opened or the game stopped, though it can not be pressed then', () => {
    const { win, game, control } = fireControl();
    fire(win, 'keydown', { code: 'KeyX' });
    game.menuOpen = true;
    expect(control.held).toBe(true);
    fire(win, 'keyup', { code: 'KeyX' });
    expect(control.held).toBe(false);
  });

  it('is not pressed by the mouse or a touch button before Start or with a menu open', () => {
    const { canvas, doc, game, control, log } = fireControl(),
      button = stub();
    control.hold(button);
    doc.pointerLockElement = canvas;
    game.menuOpen = true;
    mouse(canvas, 'pointerdown', 1);
    mouse(canvas, 'pointerup', 0);
    fire(button, 'pointerdown');
    fire(button, 'pointerup');
    game.menuOpen = false;
    game.started = false;
    mouse(canvas, 'pointerdown', 1);
    fire(button, 'pointerdown');
    expect(log).toEqual([]);
  });

  it('is not pressed by a finger or a pen on the game', () => {
    const { canvas, doc, control } = fireControl();
    doc.pointerLockElement = canvas;
    fire(canvas, 'pointerdown', { pointerId: 2, pointerType: 'touch', buttons: 1, clientX: 0, clientY: 0 });
    fire(canvas, 'pointerdown', { pointerId: 3, pointerType: 'pen', buttons: 1, clientX: 0, clientY: 0 });
    expect(control.held).toBe(false);
  });

  it('is let go when the mouse loses its lock, and pressed again by the next click that has it', () => {
    const { canvas, doc, control, log } = fireControl();
    doc.pointerLockElement = canvas;
    mouse(canvas, 'pointerdown', 1);
    doc.pointerLockElement = null; // a menu or Esc; the button is then let go over the menu, so no pointerup comes
    fire(doc, 'pointerlockchange');
    expect(control.held).toBe(false);
    doc.pointerLockElement = canvas;
    fire(canvas, 'pointerdown', { pointerId: 1, pointerType: 'mouse', button: 0, buttons: 1 });
    expect(log).toEqual(['press', 'release', 'press']);
  });

  it('counts a click as a press when the last let-go was never seen', () => {
    const { i, win, canvas, doc, log } = fireControl();
    doc.pointerLockElement = canvas;
    mouse(canvas, 'pointerdown', 1);
    fire(win, 'blur'); // the button is let go in another window
    i.releaseKeys();
    mouse(canvas, 'pointermove', 1); // still down when the focus is back: held, but not pressed again
    expect(log).toEqual(['press', 'release']);
    fire(canvas, 'pointerdown', { pointerId: 1, pointerType: 'mouse', button: 0, buttons: 1 });
    expect(log).toEqual(['press', 'release', 'press']);
  });

  it('is pressed by its mouse button only while the mouse is locked, so the click that locks it never fires', () => {
    const { canvas, doc, control, log } = fireControl();
    mouse(canvas, 'pointerdown', 1);
    doc.pointerLockElement = canvas; // the lock arrives while the button is still down
    mouse(canvas, 'pointermove', 1);
    mouse(canvas, 'pointerup', 0);
    expect(log).toEqual([]);
    mouse(canvas, 'pointerdown', 1);
    expect(control.held).toBe(true);
    mouse(canvas, 'pointerup', 0);
    expect(log).toEqual(['press', 'release']);
  });

  it('reads a second mouse button pressed while the first is held, and either let go first', () => {
    const { i, canvas, doc, control: fireHeld } = fireControl();
    const aim = i.addControl({ mouseButton: MouseButton.RIGHT });
    doc.pointerLockElement = canvas;
    mouse(canvas, 'pointerdown', 2); // the right button
    mouse(canvas, 'pointermove', 3); // the left one joins it: browsers send a move, not a pointerdown
    expect([fireHeld.held, aim.held]).toEqual([true, true]);
    mouse(canvas, 'pointermove', 1); // the right one is let go first: a move again
    expect([fireHeld.held, aim.held]).toEqual([true, false]);
    mouse(canvas, 'pointerup', 0);
    expect(fireHeld.held).toBe(false);
  });

  it('keeps the right click from opening the browser menu only when a control took that button', () => {
    const { i, canvas } = fireControl();
    expect(fire(canvas, 'contextmenu').defaultPrevented).toBe(false);
    i.addControl({ mouseButton: MouseButton.RIGHT });
    expect(fire(canvas, 'contextmenu').defaultPrevented).toBe(true);
  });

  it('is held by a touch button of the module, and by a key and a button together until both are let go', () => {
    const { win, control, log } = fireControl(),
      button = stub();
    control.hold(button);
    fire(button, 'pointerdown');
    fire(win, 'keydown', { code: 'KeyX' });
    fire(button, 'pointerleave');
    expect(control.held).toBe(true);
    fire(win, 'keyup', { code: 'KeyX' });
    expect(log).toEqual(['press', 'press', 'release']);
  });

  it('is pressed by a key held since a menu was open, when it repeats after the menu closes', () => {
    const { win, game, control, log } = fireControl();
    game.menuOpen = true;
    fire(win, 'keydown', { code: 'KeyX' });
    game.menuOpen = false;
    fire(win, 'keydown', { code: 'KeyX', repeat: true });
    fire(win, 'keydown', { code: 'KeyX', repeat: true });
    expect(control.held).toBe(true);
    expect(log).toEqual(['press']);
  });

  it('is not pressed by its touch button while the dev console is open', () => {
    const { game, control, log } = fireControl(),
      button = stub();
    control.hold(button);
    game.consoleOpen = true;
    fire(button, 'pointerdown');
    expect(control.held).toBe(false);
    expect(log).toEqual([]);
  });

  it('holds each touch button on its own, and one button made twice as one', () => {
    const { control, log } = fireControl(),
      a = stub(),
      b = stub();
    control.hold(a);
    control.hold(a);
    control.hold(b);
    fire(a, 'pointerdown');
    fire(b, 'pointerdown');
    fire(a, 'pointerup');
    expect(control.held).toBe(true);
    fire(b, 'pointerup');
    expect(log).toEqual(['press', 'press', 'release']);
  });

  it('lets go of every control when one release throws, and throws after', () => {
    const { i, win, control } = fireControl({
      release: () => {
        throw new Error('boom');
      },
    });
    const other = i.addControl({ codes: ['KeyZ'] });
    fire(win, 'keydown', { code: 'KeyX' });
    fire(win, 'keydown', { code: 'KeyZ' });
    expect(() => i.releaseKeys()).toThrow('boom');
    expect([control.held, other.held]).toEqual([false, false]);
  });

  it('keeps the keys and button it was added with, though the spec changes after', () => {
    const { i } = fireControl();
    const spec = { codes: ['KeyZ'] as string[] };
    i.addControl(spec);
    spec.codes.push('KeyC');
    Object.assign(spec, { mouseButton: MouseButton.LEFT });
    expect(() => i.addControl({ codes: ['KeyC'] })).not.toThrow();
    expect(() => i.addControl({ mouseButton: MouseButton.LEFT })).toThrow('mouse button 1');
  });

  it('is let go with the keys when the window loses focus', () => {
    const { i, win, control, log } = fireControl();
    fire(win, 'keydown', { code: 'KeyX' });
    fire(win, 'blur');
    expect(control.held).toBe(false);
    i.releaseKeys(); // nothing held: no second release
    expect(log).toEqual(['press', 'release']);
  });

  it('refuses a key or a mouse button that the game or another control has', () => {
    const { i } = fireControl();
    expect(() => i.addControl({ codes: ['KeyE'] })).toThrow('KeyE');
    expect(() => i.addControl({ codes: ['Space'] })).toThrow('Space');
    expect(() => i.addControl({ codes: ['KeyX'] })).toThrow('KeyX');
    expect(() => i.addControl({ mouseButton: MouseButton.LEFT })).toThrow('mouse button 1');
    // a refused control adds nothing: its other key is still free
    expect(() => i.addControl({ codes: ['KeyZ', 'KeyE'] })).toThrow('KeyE');
    expect(() => i.addControl({ codes: ['KeyZ'] })).not.toThrow();
  });

  it('refuses a key that the menus or the console say is theirs', () => {
    const { i } = input({ keyTaken: code => code === 'Digit1' || code === 'KeyP' });
    expect(() => i.addControl({ codes: ['Digit1'] })).toThrow('Digit1 is already taken');
    expect(() => i.addControl({ codes: ['KeyZ', 'KeyP'] })).toThrow('KeyP');
    expect(() => i.addControl({ codes: ['KeyZ', 'Digit2'] })).not.toThrow();
  });

  it('keeps the touch from the browser before the press runs, so a press that throws leaves it kept', () => {
    const t = input(),
      button = stub();
    let e: Event | undefined, keptAtPress: boolean | undefined;
    t.i
      .addControl({
        press: () => {
          keptAtPress = e?.defaultPrevented;
        },
      })
      .hold(button);
    e = new Event('pointerdown', { cancelable: true });
    button.dispatchEvent(e);
    expect(keptAtPress).toBe(true);
  });

  it('refuses ctrl, alt and ⌘ as keys: their own keydown says a modifier is held, so they can’t be relied on', () => {
    const { i } = fireControl();
    for (const code of ['ControlLeft', 'ControlRight', 'AltLeft', 'AltRight', 'MetaLeft', 'MetaRight', 'OSLeft'])
      expect(() => i.addControl({ codes: [code] })).toThrow(`${code} is a modifier`);
    expect(() => i.addControl({ codes: ['KeyZ', 'AltLeft'] })).toThrow('AltLeft');
    expect(() => i.addControl({ codes: ['KeyZ'] })).not.toThrow(); // nothing was added
  });
});
