// The pause menu (part of #78): Esc, or the Menu button, stops the game and shows the settings. DOM over the canvas.
// The settings are kept in localStorage until saving has a home of its own (#77); graphics settings wait for #402.
import type { Input } from './input';
import type { GameState } from './state';

const STORE_KEY = 'joyride.settings';
const LOOK_SPEED_MIN = 0.25,
  LOOK_SPEED_MAX = 3; // × the default mouse and drag look speed

export interface Settings {
  lookSpeed: number; // × the default look speed
  invertY: boolean; // moving the mouse up looks down
}

/** Settings from what was saved, each value checked: anything missing or broken gets its default. */
export function readSettings(raw: string | null): Settings {
  let s: Partial<Record<keyof Settings, unknown>> = {};
  try {
    s = JSON.parse(raw ?? '{}') ?? {};
  } catch {}
  const speed = s.lookSpeed; // a number only: Number() would make null, '' or false a 0, held up to the slowest speed
  return {
    lookSpeed:
      typeof speed === 'number' && Number.isFinite(speed)
        ? Math.min(LOOK_SPEED_MAX, Math.max(LOOK_SPEED_MIN, speed))
        : 1,
    invertY: s.invertY === true,
  };
}

/** What the pause menu reads from the rest of the game. */
export interface PauseMenuDeps {
  root: HTMLElement; // #pause, with #look-speed, #invert-y and #resume inside
  canvas: Pick<HTMLElement, 'focus'>;
  behind: Pick<HTMLElement, 'inert'>[]; // the HUD and menus under the panel: Tab and clicks can't reach them while it's open
  game: Pick<GameState, 'started' | 'paused'>;
  readonly input: Pick<Input, 'lockMouse' | 'releaseKeys'>;
  readonly storage: Pick<Storage, 'getItem' | 'setItem'>;
}

export class PauseMenu {
  readonly settings: Settings;
  private relock = false; // the mouse was locked when the menu opened: lock it again on Resume
  private readonly g: PauseMenuDeps;

  constructor(g: PauseMenuDeps) {
    this.g = g;
    let saved: string | null = null;
    try {
      saved = g.storage.getItem(STORE_KEY);
    } catch {} // storage can be blocked (private modes, embeds): the defaults still work
    this.settings = readSettings(saved);
    const speed = g.root.querySelector<HTMLInputElement>('#look-speed')!,
      invert = g.root.querySelector<HTMLInputElement>('#invert-y')!;
    speed.min = String(LOOK_SPEED_MIN);
    speed.max = String(LOOK_SPEED_MAX);
    speed.value = String(this.settings.lookSpeed);
    invert.checked = this.settings.invertY;
    speed.addEventListener('input', () => {
      this.settings.lookSpeed = +speed.value;
    });
    speed.addEventListener('change', () => this.save()); // once when the slider is let go, not on every step of a drag
    invert.addEventListener('change', () => {
      this.settings.invertY = invert.checked;
      this.save();
    });
    g.root.querySelector('#resume')!.addEventListener('click', this.resume);
  }

  get isOpen() {
    return !this.g.root.hidden;
  }

  /** relock: Esc freed a locked mouse (the browser keeps that Esc), so Resume takes the lock back. */
  open(relock = false) {
    const { root, game, input } = this.g;
    if (this.isOpen) this.relock ||= relock; // a browser that also sends the Esc that freed the lock
    if (!game.started || this.isOpen) return;
    this.relock = relock;
    game.paused = true;
    input.releaseKeys();
    root.hidden = false;
    for (const el of this.g.behind) el.inert = true;
    root.querySelector<HTMLElement>('#resume')!.focus();
  }

  resume = () => {
    const { root, game, canvas, input } = this.g;
    root.hidden = true;
    for (const el of this.g.behind) el.inert = false;
    game.paused = false;
    canvas.focus();
    if (this.relock) input.lockMouse(); // can be refused right after Esc: a click on the game locks it then
  };

  /** Sees each key first while open: Esc resumes, the game keys wait. True when the menu took the key. */
  key = (e: KeyboardEvent) => {
    if (!this.isOpen) return false;
    if (e.code === 'Escape' && !e.repeat) {
      e.preventDefault();
      this.resume();
    }
    return true;
  };

  private save() {
    try {
      this.g.storage.setItem(STORE_KEY, JSON.stringify(this.settings));
    } catch {}
  }
}
