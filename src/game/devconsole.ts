// The dev console (#218): a line to type commands into, over the canvas. DOM only; the commands live in commands.ts.
// Keys typed into it stop here, so they never reach the game's keydown handler and never drive the player.
import { clamp } from '../world/math';
import type { Commands } from './commands';

const MAX_LINES = 60; // older output lines are dropped
const MAX_HISTORY = 30; // typed lines that ArrowUp brings back

/** Whether a keydown is the console's key: § (top left on a Swedish keyboard) or ` (the same key on US layouts). */
export const isConsoleKey = (e: KeyboardEvent) =>
  (e.key === '§' || e.key === '`') && !e.ctrlKey && !e.metaKey && !e.altKey; // Cmd+` cycles windows on macOS

export interface DevConsoleDeps {
  root: HTMLElement; // #devcon: holds an output list and an input
  commands: Commands;
  onOpen(): void; // let go of held keys and the pointer lock
  onClose(): void; // give the game focus back
}

/** The console box: opens and closes, runs typed lines through the commands and shows the result. */
export class DevConsole {
  private readonly d: DevConsoleDeps;
  private readonly out: HTMLElement;
  private readonly input: HTMLInputElement;
  private readonly history: string[] = [];
  private back = 0; // how far ArrowUp has gone into history; 0 is the line being typed
  private draft = ''; // the line being typed, kept while ArrowUp shows older ones

  constructor(d: DevConsoleDeps) {
    this.d = d;
    this.out = d.root.querySelector('ol') as HTMLElement;
    this.input = d.root.querySelector('input') as HTMLInputElement;
    this.input.addEventListener('keydown', e => this.key(e));
    this.input.addEventListener('keyup', e => e.stopPropagation());
    d.commands.register('clear', {
      help: 'empty the console',
      run: () => {
        this.out.textContent = '';
        return '';
      },
    });
  }

  get isOpen() {
    return !this.d.root.hidden;
  }

  /** Gives the input focus back, after a click on the output or a Tab took it away. */
  focus() {
    this.input.focus();
  }

  open() {
    if (this.isOpen) return;
    this.d.root.hidden = false;
    this.d.onOpen();
    this.input.focus();
  }

  close() {
    if (!this.isOpen) return;
    this.d.root.hidden = true;
    this.input.value = this.draft = '';
    this.back = 0;
    this.d.onClose();
  }

  /** Runs a line as if typed, and shows it with its result. */
  run(line: string) {
    line = line.trim();
    if (!line) return;
    if (this.history[this.history.length - 1] !== line) {
      this.history.push(line);
      if (this.history.length > MAX_HISTORY) this.history.shift();
    }
    this.print('> ' + line, 'in');
    let res: string;
    try {
      res = this.d.commands.run(line);
    } catch (err) {
      res = 'Error: ' + (err instanceof Error ? err.message : String(err));
      console.error(err);
    }
    if (res) this.print(res);
  }

  private print(text: string, cls?: string) {
    const li = document.createElement('li');
    li.textContent = text; // textContent: command output is never HTML
    if (cls) {
      li.className = cls;
      li.setAttribute('aria-hidden', 'true');
    } // the echoed line: a screen reader just heard it typed
    this.out.appendChild(li);
    while (this.out.childElementCount > MAX_LINES) this.out.firstElementChild?.remove();
    this.out.scrollTop = this.out.scrollHeight;
  }

  private key(e: KeyboardEvent) {
    e.stopPropagation();
    if (e.isComposing) return;
    if (e.code === 'Escape' || isConsoleKey(e)) {
      e.preventDefault();
      if (!e.repeat) this.close();
      return;
    } // a held § doesn't open and then shut it
    if (e.code === 'Enter' || e.code === 'NumpadEnter') {
      e.preventDefault();
      this.run(this.input.value);
      this.input.value = this.draft = '';
      this.back = 0;
      return;
    }
    if (e.code === 'ArrowUp' || e.code === 'ArrowDown') {
      e.preventDefault();
      const back = clamp(this.back + (e.code === 'ArrowUp' ? 1 : -1), 0, this.history.length);
      if (back === this.back) return; // past either end: keep the line as it is
      if (this.back === 0) this.draft = this.input.value;
      this.back = back;
      this.input.value = back ? this.history[this.history.length - back] : this.draft;
    }
  }
}
