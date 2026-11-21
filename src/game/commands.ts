// Dev console commands (#218): one registry that each module adds its own commands to. Pure: no DOM, no three.js.
// The console in devconsole.ts reads a line, runs it here and shows what comes back. docs/console.md has the contract:
// commands, typed arguments (command-args.ts), access, hooks and completion.

/** Who may run a command: `dev` only in dev mode (the default), `player` always. */
export type Access = 'dev' | 'player';

/** Where a line came from, so a hook can tell a typed line from a script or a test. */
export type CallSource = 'console' | 'url' | 'script' | 'test';

/** One run of a command, as the command and the hooks see it. */
export interface Call {
  /** the name it is registered under, whichever alias was typed */
  readonly name: string;
  readonly args: readonly string[];
  readonly source: CallSource;
}

export interface Command {
  /** the arguments, for help: `<amount>` */
  usage?: string;
  /** one line for help */
  help: string;
  /** who may run it; `dev` when left out */
  access?: Access;
  /** other names that run it: `tp` for `teleport` */
  aliases?: readonly string[];
  /** The words that fit at argument `index` (0 is the first after the name), given the arguments before it. */
  complete?(index: number, before: readonly string[]): readonly string[];
  /** Runs the command with the words after its name; returns the line to show. Throw a UsageError for bad arguments. */
  run(args: string[], call: Call): string;
}

/**
 * Wraps every run, for logging, recording or refusing: return `next()` to run the command (and the hooks inside this
 * one), or a line of your own to stop it. The first hook added is the outermost.
 */
export type Hook = (call: Call, next: () => string) => string;

/** Thrown by a command for arguments it can't use; the console shows its usage line. */
export class UsageError extends Error {}

export interface CommandsOptions {
  /** Whether commands with this access can run and show in help; everything can when left out. */
  allowed?(access: Access): boolean;
}

const NAME = /^[a-z][a-z0-9-]*$/;

/** Commands by name. `help` is built in and lists the rest. */
export class Commands {
  private readonly byName = new Map<string, Command>(); // the registered names
  private readonly aliases = new Map<string, string>(); // alias to name
  private readonly hooks: Hook[] = [];
  private readonly allowed: (access: Access) => boolean;

  constructor(opts: CommandsOptions = {}) {
    this.allowed = opts.allowed ?? (() => true);
    this.register('help', {
      usage: '[command]',
      help: 'list the commands, or show how to use one',
      access: 'player',
      complete: index => (index === 0 ? this.names() : []),
      run: a => this.help(a[0]),
    });
  }

  /** Adds a command; the function it returns takes it out again, for a module or an experiment that stops. */
  register(name: string, cmd: Command): () => void {
    const names = [name, ...(cmd.aliases ?? [])];
    if (new Set(names).size < names.length) throw new Error('command names repeat: ' + names.join(', '));
    for (const n of names) {
      if (!NAME.test(n)) throw new Error('command names are lower-case words: ' + n);
      if (this.byName.has(n) || this.aliases.has(n)) throw new Error('command already registered: ' + n);
    }
    this.byName.set(name, cmd);
    for (const a of cmd.aliases ?? []) this.aliases.set(a, name);
    let registered = true; // so a second call can't take out a later registration of the same command
    return () => {
      if (!registered) return;
      registered = false;
      this.byName.delete(name);
      for (const a of cmd.aliases ?? []) this.aliases.delete(a);
    };
  }

  /** Adds a hook around every run (see Hook); the function it returns takes it out again. */
  use(hook: Hook): () => void {
    this.hooks.push(hook);
    return () => {
      const i = this.hooks.indexOf(hook);
      if (i >= 0) this.hooks.splice(i, 1);
    };
  }

  /** The names of the commands that can run here, sorted. */
  names(): string[] {
    return [...this.byName.keys()].filter(n => this.canRun(this.byName.get(n) as Command)).sort();
  }

  /** Runs one line; returns what to show, or '' for an empty line. */
  run(line: string, source: CallSource = 'console'): string {
    const [typed, ...args] = line.trim().split(/\s+/).filter(Boolean);
    if (!typed) return '';
    const name = this.resolve(typed.toLowerCase());
    const cmd = name === undefined ? undefined : this.byName.get(name);
    if (!cmd || name === undefined) return `Unknown command: ${typed}. Type help for the list.`;
    if (!this.canRun(cmd)) return `${name} works in dev mode only (?dev).`;
    const call: Call = { name, args, source };
    const inner = () => {
      try {
        return cmd.run(args, call);
      } catch (err) {
        if (err instanceof UsageError) return `${err.message ? err.message + ' ' : ''}Usage: ${this.usage(name, cmd)}`;
        throw err;
      }
    };
    // the first hook is the outermost: fold from the last one in
    const chain = this.hooks.reduceRight<() => string>((next, hook) => () => hook(call, next), inner);
    return chain();
  }

  /**
   * The words that could finish the last word of a line, for Tab: command names while the name is being typed, then
   * what the command offers for the argument the cursor is in. A line that ends in a space starts a new word.
   */
  complete(line: string): string[] {
    const words = line.trimStart().split(/\s+/);
    const last = (words.pop() ?? '').toLowerCase();
    const fits = (options: readonly string[]) => [...new Set(options)].filter(o => o.toLowerCase().startsWith(last));
    if (words.length === 0) return fits(this.names());
    const name = this.resolve(words[0].toLowerCase());
    const cmd = name === undefined ? undefined : this.byName.get(name);
    if (!cmd?.complete || !this.canRun(cmd)) return [];
    const before = words.slice(1);
    return fits(cmd.complete(before.length, before)).sort();
  }

  private resolve(typed: string): string | undefined {
    return this.byName.has(typed) ? typed : this.aliases.get(typed);
  }

  private canRun(cmd: Command) {
    return this.allowed(cmd.access ?? 'dev');
  }

  private usage(name: string, cmd: Command) {
    return `${name} ${cmd.usage ?? ''}`.trimEnd();
  }

  private help(about?: string): string {
    if (about) {
      const name = this.resolve(about.toLowerCase());
      const cmd = name === undefined ? undefined : this.byName.get(name);
      if (!cmd || name === undefined || !this.canRun(cmd)) throw new UsageError('No command called ' + about + '.');
      const aka = cmd.aliases?.length ? ` (also ${cmd.aliases.join(', ')})` : '';
      return `${this.usage(name, cmd)}: ${cmd.help}${aka}`;
    }
    return this.names()
      .map(n => {
        const c = this.byName.get(n) as Command;
        return `${n}${c.usage ? ' ' + c.usage : ''}: ${c.help}`;
      })
      .join('\n');
  }
}

/** A whole number of kronor, negative allowed; a UsageError for anything else. */
export function parseKr(s: string | undefined): number {
  if (s === undefined || !/^[+-]?\d{1,9}$/.test(s)) throw new UsageError();
  return Number(s);
}
