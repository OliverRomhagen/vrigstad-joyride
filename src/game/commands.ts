// Dev console commands (#218): one registry that each module adds its own commands to. Pure: no DOM, no three.js.
// The console in devconsole.ts reads a line, runs it here and shows what comes back. docs/console.md has the contract:
// commands, typed arguments (command-args.ts), access, hooks and completion.

/** Who may run a command: `dev` only in dev mode (the default), `player` always. */
export type Access = 'dev' | 'player';

/** Where a line came from, so a hook can tell a typed line from a script or a test; `input` is a key, a touch or a gamepad button. */
export type CallSource = 'console' | 'input' | 'url' | 'script' | 'panel' | 'test';

/** One run of a command, as the command and the hooks see it. */
export interface Call {
  /** the name it is registered under, whichever alias was typed */
  readonly name: string;
  readonly args: readonly string[];
  readonly source: CallSource;
}

/** One argument as help shows it: `<place>`, and what it is. */
export interface ParamHelp {
  readonly shown: string;
  readonly help: string;
}

export interface Command {
  /** the arguments, for help: `<amount>` */
  usage?: string;
  /** one line for help, what the command does: required, at most HELP_MAX characters */
  help: string;
  /** more about it, a few lines, for `help <command>` and `<command> --help` */
  details?: string;
  /** whole lines that show it in use (`go torget 40`), each starting with its name or an alias */
  examples?: readonly string[];
  /** what each argument is; command() fills it from the arguments' own help */
  params?: readonly ParamHelp[];
  /** who may run it; `dev` when left out */
  access?: Access;
  /** other names that run it: `tp` for `teleport` */
  aliases?: readonly string[];
  /**
   * Commands under this one, by name: `tune set …` runs `set` with the words after it. A word that names none runs this
   * command's own `run` (a group() without one refuses it). They share its access; help, `--help`, Tab and the usage line reach them.
   */
  subcommands?: Readonly<Record<string, Command>>;
  /** The words that fit at argument `index` (0 is the first after the name), given the arguments before it. */
  complete?(index: number, before: readonly string[]): readonly string[];
  /**
   * Runs the command with the words after its name; returns the line to show, which means it was done, or `refuse(…)`
   * when the game's rules said no. Throw a UsageError for bad arguments.
   */
  run(args: string[], call: Call): string | Outcome;
}

/** What a run came to: `ok` with the line to show, or not `ok` with which refusal it was and the reason to show. */
export interface Outcome {
  readonly ok: boolean;
  readonly text: string;
  /**
   * Which refusal it was, when not `ok`: a kebab-case name that code matches on (`too-fast`), so a tutorial, a sound
   * or a test never compares the sentence, which stays free to be reworded.
   */
  readonly code?: string;
}

/** The refusals the registry gives itself; a command names its own (`no-car-in-reach`). */
export const REFUSAL = {
  /** no command by that name */
  UNKNOWN_COMMAND: 'unknown-command',
  /** the command needs dev mode */
  NOT_ALLOWED: 'not-allowed',
  /** arguments the command can't use: the text is its usage line */
  USAGE: 'usage',
  /** a hook answered with a line of its own without running the command */
  HOOK: 'hook',
} as const;

/**
 * The outcome of a command that understood its line but didn't do it: `return refuse('no-car-in-reach', 'No car in
 * reach.')`, the refusal's name and the reason to show. Returned, not thrown: the rule that says no is a plain
 * function that other code calls too.
 */
export function refuse(code: string, reason: string): Outcome {
  if (!NAME.test(code)) throw new Error('refusal codes are kebab-case: ' + code);
  return { ok: false, text: reason, code };
}

/**
 * Wraps every run, for logging, recording or refusing: return `next()` to run the command (and the hooks inside this
 * one), or a line of your own to stop it, which counts as a refusal (`hook`). `next()` gives the Outcome, so a hook
 * can keep only the runs that were done. A hook that ran the command and returns a line, or an Outcome, changes only
 * what is shown: whether it was done, and its refusal's name, stay what `next()` said. The first hook added is the
 * outermost.
 */
export type Hook = (call: Call, next: () => Outcome) => Outcome | string;

/** Thrown by a command for arguments it can't use; the console shows its usage line. */
export class UsageError extends Error {}

export interface CommandsOptions {
  /** Whether commands with this access can run and show in help; everything can when left out. */
  allowed?(access: Access): boolean;
}

const NAME = /^[a-z][a-z0-9]*(-[a-z0-9]+)*$/; // kebab-case, as every name people type is (AGENTS.md, Naming)
/** The longest a command's one line of help can be, so `help` stays a list you can read. */
export const HELP_MAX = 80;
const HELP_FLAGS = ['--help', '-h'];

/** A command reached through the words typed: `tune set` and the words after it. */
interface Found {
  /** the names that led to it, as usage and help show them: `tune set` */
  readonly path: string;
  readonly cmd: Command;
  readonly args: string[];
}

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
      details: 'Every command also answers --help, as in kr --help.',
      examples: ['help', 'help kr'],
      access: 'player',
      complete: index => (index === 0 ? this.names() : []),
      run: a => this.help(a),
    });
  }

  /** Adds a command; the function it returns takes it out again, for a module or an experiment that stops. */
  register(name: string, cmd: Command): () => void {
    const names = [name, ...(cmd.aliases ?? [])];
    if (new Set(names).size < names.length) throw new Error('command names repeat: ' + names.join(', '));
    checkCommand(name, cmd, [names]);
    for (const n of names)
      if (this.byName.has(n) || this.aliases.has(n)) throw new Error('command already registered: ' + n);
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

  /** Runs one line; returns what to show, or '' for an empty line. For whether it was done, see execute(). */
  run(line: string, source: CallSource = 'console'): string {
    return this.execute(line, source).text;
  }

  /**
   * Runs one line; returns what it came to. Not `ok`: a refusal, by the command or by a hook, arguments the command
   * can't use, an unknown command, and one that isn't allowed here. Everything else is `ok`, an empty line and an
   * answer to --help included.
   */
  execute(line: string, source: CallSource = 'console'): Outcome {
    const [typed, ...args] = line.trim().split(/\s+/).filter(Boolean);
    if (!typed) return done('');
    const name = this.resolve(typed.toLowerCase());
    const cmd = name === undefined ? undefined : this.byName.get(name);
    if (!cmd || name === undefined)
      return refuse(REFUSAL.UNKNOWN_COMMAND, `Unknown command: ${typed}. Type help for the list.`);
    if (!this.canRun(cmd)) return refuse(REFUSAL.NOT_ALLOWED, `${name} works in dev mode only (?dev).`);
    const found = descend(name, cmd, args);
    // every command answers --help the same way, before it runs, so none can forget to
    if (found.args.length === 1 && HELP_FLAGS.includes(found.args[0])) return done(this.helpFor(found));
    const call: Call = { name, args, source };
    return this.throughHooks(call, onceOnly(found, call));
  }

  /**
   * Runs `inner` inside every hook; the first hook added is the outermost. A line from a hook that never called next()
   * stopped the command, so it is a refusal. A line from one that did call it only changes what is shown: the command
   * ran, and saying it didn't would have E tell you "no" after it got you into the car.
   */
  private throughHooks(call: Call, inner: () => Outcome): Outcome {
    // fold from the last hook in, so the first is the outermost
    const chain = this.hooks.reduceRight<() => Outcome>(
      (next, hook) => () => {
        let inside: Outcome | undefined;
        const answer = hook(call, () => {
          inside = next();
          return inside;
        });
        const text = typeof answer === 'string' ? answer : answer.text;
        // whatever a hook returns, whether the command was done is what next() said, so only the text can change
        if (inside) return { ...inside, text };
        return typeof answer === 'string' ? refuse(REFUSAL.HOOK, answer) : answer;
      },
      inner,
    );
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
    if (!cmd || name === undefined || !this.canRun(cmd)) return [];
    // the words before the cursor that name a subcommand lead to it; the cursor's word may be one
    const found = descend(name, cmd, words.slice(1));
    // a group offers its subcommands for the first word, and what its own arguments offer when it runs by itself
    const before = found.args;
    const below = found.cmd.subcommands && before.length === 0 ? Object.keys(found.cmd.subcommands) : [];
    return fits([...below, ...(found.cmd.complete?.(before.length, before) ?? [])]).sort();
  }

  /** The usage line of the command a line starts with (`go <place> [speed]`), for the hint under the input. */
  usageFor(line: string): string | undefined {
    const [typed, ...args] = line.trimStart().split(/\s+/);
    const name = typed ? this.resolve(typed.toLowerCase()) : undefined;
    if (name === undefined) return undefined;
    const cmd = this.byName.get(name);
    if (!cmd || !this.canRun(cmd)) return undefined;
    return usage(descend(name, cmd, args));
  }

  private resolve(typed: string): string | undefined {
    return this.byName.has(typed) ? typed : this.aliases.get(typed);
  }

  private canRun(cmd: Command) {
    return this.allowed(cmd.access ?? 'dev');
  }

  private help(about: readonly string[]): string {
    if (about.length) {
      const name = this.resolve(about[0].toLowerCase());
      const cmd = name === undefined ? undefined : this.byName.get(name);
      const found = cmd && name !== undefined ? descend(name, cmd, about.slice(1)) : undefined;
      if (!cmd || !found || found.args.length || !this.canRun(cmd))
        throw new UsageError('No command called ' + about.join(' ') + '.');
      return this.helpFor(found);
    }
    return this.names()
      .map(n => {
        const c = this.byName.get(n) as Command;
        return `${n}${c.usage ? ' ' + c.usage : ''}: ${c.help}`;
      })
      .join('\n');
  }

  private helpFor({ path, cmd }: Found): string {
    const aka = cmd.aliases?.length ? ` (also ${cmd.aliases.join(', ')})` : '';
    const subs = Object.entries(cmd.subcommands ?? {}).sort(([a], [b]) => (a < b ? -1 : 1));
    return [
      `${usage({ path, cmd })}: ${cmd.help}${aka}`,
      ...(cmd.params ?? []).map(p => `  ${p.shown}: ${p.help}`),
      ...subs.map(([n, sub]) => `  ${usage({ path: `${path} ${n}`, cmd: sub })}: ${sub.help}`),
      ...(cmd.details ? [cmd.details] : []),
      ...(cmd.examples?.length ? ['Examples:', ...cmd.examples.map(e => `  ${e}`)] : []), // one a line: an example may hold a comma
    ].join('\n');
  }
}

function done(text: string): Outcome {
  return { ok: true, text };
}

/**
 * The run of one command, as the hooks call it: it runs once, however many times they call next(). A second call gets
 * the same outcome back, or the same error, so a hook that retries can't run a command that threw halfway a second
 * time. Arguments the command can't use come back as a refusal with its usage line.
 */
function onceOnly(found: Found, call: Call): () => Outcome {
  let outcome: Outcome | undefined, failure: { err: unknown } | undefined;
  return () => {
    if (failure) throw failure.err;
    if (outcome) return outcome;
    try {
      const answer = found.cmd.run(found.args, call);
      outcome = typeof answer === 'string' ? done(answer) : answer;
    } catch (err) {
      if (!(err instanceof UsageError)) {
        failure = { err };
        throw err;
      }
      outcome = refuse(REFUSAL.USAGE, `${err.message ? err.message + ' ' : ''}Usage: ${usage(found)}`);
    }
    return outcome;
  };
}

function usage({ path, cmd }: Pick<Found, 'path' | 'cmd'>) {
  return `${path} ${cmd.usage ?? ''}`.trimEnd();
}

/** Follows the words that name subcommands, as far as they go. */
function descend(path: string, cmd: Command, args: string[]): Found {
  let found: Found = { path, cmd, args };
  for (;;) {
    // its own names only: `constructor` and `__proto__` are on every object, and are no subcommands
    const word = found.args[0]?.toLowerCase(),
      subs = found.cmd.subcommands;
    const sub = word !== undefined && subs && Object.hasOwn(subs, word) ? subs[word] : undefined;
    if (!sub) return found;
    found = { path: `${found.path} ${word}`, cmd: sub, args: found.args.slice(1) };
  }
}

/** Refuses a command, or a subcommand under it, without one line of help, or with an example that doesn't run it. */
function checkCommand(path: string, cmd: Command, starts: readonly (readonly string[])[]): void {
  const help = cmd.help.trim();
  if (!help || help.includes('\n') || help.length > HELP_MAX)
    throw new Error(`${path}: help is one line of up to ${HELP_MAX} characters`);
  for (const e of cmd.examples ?? []) {
    const words = e.trim().split(/\s+/);
    if (!starts.every((names, i) => names.includes(words[i])))
      throw new Error(`${path}: the example "${e}" doesn't run it`);
  }
  for (const n of starts[starts.length - 1]) if (!NAME.test(n)) throw new Error('command names are kebab-case: ' + n);
  for (const [n, sub] of Object.entries(cmd.subcommands ?? {})) checkCommand(`${path} ${n}`, sub, [...starts, [n]]);
}

/** A whole number of kronor, negative allowed; a UsageError for anything else. */
export function parseKr(s: string | undefined): number {
  if (s === undefined || !/^[+-]?\d{1,9}$/.test(s)) throw new UsageError();
  return Number(s);
}
