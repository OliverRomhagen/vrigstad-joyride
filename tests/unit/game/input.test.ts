import { describe, expect, it } from 'vitest';
import { Input, type InputDeps } from '../../../src/game/input';

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

function input(opts: { coarse?: boolean; started?: boolean; menuKey?: (e: KeyboardEvent) => boolean } = {}) {
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
  const game = { started: opts.started ?? true, menuOpen: false };
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
    menuKey: opts.menuKey ?? (() => false),
    action: () => {
      calls.push('action');
    },
    respawn: () => {
      calls.push('respawn');
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
    expect(calls).toEqual(['jump', 'action', 'action', 'respawn']);
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
    expect(calls).toEqual(['jump', 'action']);
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
