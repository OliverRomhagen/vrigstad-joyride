// The dev console (#218): a line to type commands into, over the canvas. DOM only; the commands live in commands.ts, and
// each module registers its own. Keys typed into it stop here, so they never reach the game's keydown handler and never
// drive the player.
import { CLOUD_COVERS } from '../world/clouds';
import { clamp } from '../world/math';
import { type Commands, UsageError } from './commands';
import { tabComplete } from './console-complete';
import { DAWN_H, DUSK_H } from './day-cycle';
import type { Input } from './input';
import { VEHICLES } from './render/vehicle-registry';

const MAX_LINES = 60; // older output lines are dropped
const MAX_HISTORY = 30; // typed lines that ArrowUp brings back

/** Whether a keydown is the console's key: § (top left on a Swedish keyboard) or ` (the same key on US layouts). */
const isConsoleKey = (e: KeyboardEvent) => (e.key === '§' || e.key === '`') && !e.ctrlKey && !e.metaKey && !e.altKey; // Cmd+` cycles windows on macOS

export interface DevConsoleDeps {
  root: HTMLElement; // #devcon: holds an output list, an input and a .hint under it
  commands: Commands;
  canvas: HTMLElement; // a click on the game closes the console, and closing gives the game focus back
  doc: Pick<Document, 'exitPointerLock'>;
  readonly input: Pick<Input, 'releaseKeys' | 'locked' | 'lockMouse'>; // a getter: Input sees keys through takeKey, so it's made after the console
  readonly enabled: boolean; // dev mode (the dev server, or ?dev): § opens the console only then
  readonly menuOpen: boolean; // an open menu keeps the cursor, and § doesn't open the console over it
}

/** The console box: opens and closes, runs typed lines through the commands and shows the result. */
export class DevConsole {
  private readonly d: DevConsoleDeps;
  private readonly out: HTMLElement;
  private readonly input: HTMLInputElement;
  private readonly hint: HTMLElement;
  private readonly history: string[] = [];
  private back = 0; // how far ArrowUp has gone into history; 0 is the line being typed
  private draft = ''; // the line being typed, kept while ArrowUp shows older ones
  private tabbed: string | undefined; // the line a Tab couldn't get further with: a second Tab on it lists the choices
  private listed: string | undefined; // the line whose choices are already listed, so more Tabs don't list them again
  private relock = false; // the mouse was locked when the console opened, so closing it locks it again

  constructor(d: DevConsoleDeps) {
    this.d = d;
    this.out = d.root.querySelector('ol') as HTMLElement;
    this.input = d.root.querySelector('input') as HTMLInputElement;
    this.hint = d.root.querySelector('.hint') as HTMLElement;
    this.input.addEventListener('keydown', e => this.key(e));
    this.input.addEventListener('input', () => {
      this.tabbed = this.listed = undefined; // typing starts over: only two Tabs in a row list the choices
      this.showUsage();
    });
    this.input.addEventListener('keyup', e => e.stopPropagation());
    // registered before Input's own listener (see DevConsoleDeps.input), so a click that closes the console can take the mouse back
    d.canvas.addEventListener('pointerdown', () => this.close());
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

  /** The console freed the locked mouse and takes it back on close; a menu opened over it takes that over (until #335). */
  get freedCursor() {
    return this.relock;
  }

  /** Gives the input focus back, after a click on the output or a Tab took it away. */
  focus() {
    this.input.focus();
  }

  /**
   * Sees each game key before the menus. With the console open and focus elsewhere (a click on its output, Tab), keys
   * go back to it; in dev mode § opens it. True when the console took the key.
   */
  takeKey(e: KeyboardEvent): boolean {
    if (this.isOpen) {
      e.preventDefault();
      if ((isConsoleKey(e) || e.code === 'Escape') && !e.repeat) this.close();
      else this.focus(); // the key that takes focus back isn't typed
      return true;
    }
    if (!this.d.enabled || e.repeat || this.d.menuOpen || !isConsoleKey(e)) return false;
    e.preventDefault();
    this.open();
    return true;
  }

  open() {
    if (this.isOpen) return;
    const { root, input, doc } = this.d;
    root.hidden = false;
    input.releaseKeys();
    this.relock = input.locked();
    if (this.relock) doc.exitPointerLock();
    this.input.focus();
  }

  close() {
    if (!this.isOpen) return;
    this.d.root.hidden = true;
    this.input.value = this.draft = '';
    this.back = 0;
    this.tabbed = this.listed = undefined;
    this.showUsage();
    this.d.canvas.focus();
    if (this.relock && !this.d.menuOpen) this.d.input.lockMouse(); // an open menu needs the cursor
    this.relock = false;
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

  /**
   * Completes the word before the caret, keeping what follows it; when Tab can't get further, a second Tab lists what
   * could follow, once.
   */
  private complete() {
    const caret = this.input.selectionStart ?? this.input.value.length;
    const line = this.input.value.slice(0, caret),
      rest = this.input.value.slice(caret);
    const { line: next, choices } = tabComplete(line, this.d.commands.complete(line));
    if (next !== line) {
      // a completed word's space would double one already after the caret: use that one, and put the caret past it
      const head = next.endsWith(' ') && /^\s/.test(rest) ? next.slice(0, -1) : next;
      this.input.value = head + rest;
      this.input.setSelectionRange(next.length, next.length);
    } else if (choices.length && this.listed !== this.input.value) {
      if (this.tabbed === this.input.value) {
        this.print(choices.join('  '));
        this.listed = this.input.value;
      } else this.tabbed = this.input.value;
    }
    this.showUsage();
  }

  /** Shows the usage line of the command being typed under the input, or nothing. */
  private showUsage() {
    const usage = this.d.commands.usageFor(this.input.value) ?? '';
    this.hint.textContent = usage;
    this.hint.hidden = !usage;
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
      this.tabbed = this.listed = undefined;
      this.showUsage();
      return;
    }
    if (e.code === 'Tab') {
      e.preventDefault(); // Tab completes here, and neither Tab nor Shift+Tab moves focus out of the console
      if (!e.shiftKey) this.complete();
      return;
    }
    if (e.code === 'ArrowUp' || e.code === 'ArrowDown') {
      e.preventDefault();
      const back = clamp(this.back + (e.code === 'ArrowUp' ? 1 : -1), 0, this.history.length);
      if (back === this.back) return; // past either end: keep the line as it is
      if (this.back === 0) this.draft = this.input.value;
      this.back = back;
      this.input.value = back ? this.history[this.history.length - back] : this.draft;
      this.showUsage();
    }
  }
}

/**
 * The query string with `key=value` words applied: a value replaces that parameter, an empty one (`grain=`) removes it,
 * and the rest stay. Commas stay commas and flags stay bare, so the URL reads as typed in the address bar.
 */
export function withParams(search: string, words: readonly string[]): string {
  const params = new URLSearchParams(search);
  for (const word of words) {
    const eq = word.indexOf('=');
    if (eq < 1) throw new UsageError('not key=value: ' + word);
    const key = word.slice(0, eq),
      value = word.slice(eq + 1);
    if (value) params.set(key, value);
    else params.delete(key);
  }
  const query = params
    .toString()
    .replace(/%2C/gi, ',')
    .replace(/=(?=&|$)/g, ''); // ?dev stays ?dev, not ?dev=
  return query ? '?' + query : '';
}

/** A URL parameter the game reads, for `url`'s list and Tab: the values it takes (left out when free) and what it does. */
interface UrlParam {
  key: string;
  values?: readonly string[];
  help: string;
}

/** What `?` can switch, read at page load in main.ts and the modules it names. Add one here when you add a parameter. */
const URL_PARAMS: readonly UrlParam[] = [
  { key: 'dev', values: ['1'], help: 'dev mode: this console, fps, tune' },
  { key: 'lab', help: 'lab experiments, comma-separated: the lab command lists them' },
  { key: 'grain', values: ['on', 'off'], help: 'ISO 800 film grain' },
  { key: 'clouds', values: [...CLOUD_COVERS, 'off'], help: 'cloud cover' },
  { key: 'cloudQuality', values: ['low', 'high'], help: 'cloud detail' },
  { key: 'cloudSeed', help: 'which clouds: a whole number' },
  { key: 'cloudSoft', help: 'cloud softness, 0.3 to 3' },
  { key: 'wind', help: 'wind from degrees, in m/s: 250,7' },
  { key: 'time', help: `the hour the day starts at, ${DAWN_H} to ${DUSK_H}` },
  { key: 'cycle', values: ['off'], help: 'stop the clock' },
  { key: 'sunrays', values: ['off'], help: 'no sun streaks' },
  {
    key: 'debug',
    values: ['streetscape', 'furniture'],
    help: 'tint the streetscape by evidence, or furniture by source',
  },
  { key: 'vehicle', values: VEHICLES.map(v => v.id), help: 'the car parked at Torget' },
  { key: 'tune', help: 'tunables, key:value,…: tune list has the keys' },
  { key: 'at', help: 'start at x,z[,yaw[,pitch]]' },
  { key: 'seed', help: 'the trisslott seed: a whole number' },
];

/**
 * `url lab=toon grain=on`: sets URL parameters and reloads, since the game reads them once, at page load. So the
 * console can switch what `?lab=`, `?grain=`, `?clouds=` and the rest switch, without editing the address bar.
 */
export function registerUrlCommand(commands: Pick<Commands, 'register'>, loc: Pick<Location, 'search'>) {
  commands.register('url', {
    usage: '[key=value …]',
    help: 'set URL parameters and reload (key= removes one); alone, list what they can be',
    details:
      'Parameters not named stay, dev included. A value replaces the old one: lab=toon,cockpit sets the whole list.',
    examples: ['url', 'url lab=toon,cockpit grain=on', 'url grain= clouds=clear'],
    // key=value for a parameter with set values, key= for a free one: Tab leaves no space after the =
    complete: () => URL_PARAMS.flatMap(p => (p.values ? p.values.map(v => `${p.key}=${v}`) : [`${p.key}=`])),
    run: args => {
      if (!args.length)
        return [
          loc.search ? 'Now: ' + decodeURIComponent(loc.search) : 'No URL parameters now.',
          ...URL_PARAMS.map(p => `${p.key}=${p.values?.join('|') ?? '…'}  ${p.help}`),
        ].join('\n');
      const next = withParams(loc.search, args);
      loc.search = next; // navigates: the page reloads with the new parameters
      return 'Reloading with ' + (next || 'no parameters') + ' …';
    },
  });
}
