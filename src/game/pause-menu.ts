// The pause menu (part of #78): Esc, or the Menu button, stops the game and shows the settings. DOM over the canvas.
// The settings themselves are the store's (src/game/settings.svelte.ts), shown by a Svelte panel the page mounts in it.
import type { Input } from './input';
import type { GameState } from './state';

/** What the pause menu reads from the rest of the game. */
export interface PauseMenuDeps {
  root: HTMLElement; // #pause, with #resume inside
  canvas: Pick<HTMLElement, 'focus'>;
  behind: Pick<HTMLElement, 'inert'>[]; // the HUD and menus under the panel: Tab and clicks can't reach them while it's open
  game: Pick<GameState, 'started' | 'paused'>;
  readonly input: Pick<Input, 'lockMouse' | 'releaseKeys'>;
}

export class PauseMenu {
  private relock = false; // the mouse was locked when the menu opened: lock it again on Resume
  private readonly g: PauseMenuDeps;

  constructor(g: PauseMenuDeps) {
    this.g = g;
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
}
