// Typed arguments for console commands (#218): a command lists its arguments once, and gets their parsing, its usage
// line and Tab completion from that list. Pure: no DOM, no three.js. docs/console.md has the contract.
import { type Access, type Call, type Command, type Outcome, UsageError } from './commands';

/** One argument: its name, how to read it from a word, and the words that fit it, for Tab. */
export interface Arg<N extends string, T> {
  readonly name: N;
  readonly optional: boolean;
  /** takes every word left, joined by spaces */
  readonly rest: boolean;
  parse(word: string): T;
  /** the words Tab offers; never throws: a list that isn't ready yet gives none */
  choices?(): readonly string[];
  /** what it is, for `help <command>`: `km/h`, `a place on the map` */
  readonly help?: string;
  /** what the usage line shows in place of the name: an either() lists its few words, `hour|dawn|noon|dusk|night` */
  readonly usage?: string;
}

// biome-ignore lint/suspicious/noExplicitAny: the value type varies by argument; ArgValues reads each one back
type AnyArg = Arg<string, any>;

/** The values a command's run gets: one field per argument, by name. */
export type ArgValues<A extends readonly AnyArg[]> = {
  [K in A[number] as K['name']]: K extends Arg<string, infer T>
    ? K['optional'] extends true
      ? T | undefined
      : T
    : never;
};

/**
 * An argument of a type of your own, beside the code that owns the value: `arg('hour', w => …)` reads `16:30`. `parse`
 * throws a UsageError, starting with the name, for a word it can't use; `choices` are the words Tab offers.
 */
export const arg = <N extends string, T>(name: N, parse: (word: string) => T, choices?: () => readonly string[]) => ({
  name,
  optional: false as const,
  rest: false,
  parse,
  choices,
});

/** A whole number, within [min, max] when given. */
export function int<N extends string>(name: N, range: { min?: number; max?: number } = {}): Arg<N, number> {
  return arg(name, w => {
    if (!/^[+-]?\d+$/.test(w)) throw new UsageError(`${name} is a whole number.`);
    const v = Number(w);
    // From 2^53 on a number can't be told from its neighbours, so it's out of range, whatever range was asked for. Name
    // the range only when the number is past a bound it sets: past an open end, "from 0 to …" would be untrue.
    if (!Number.isSafeInteger(v))
      throw outside(v, range) ? rangeError(name, range) : new UsageError(`${name} is out of range.`);
    return inRange(name, v, range, 'a whole number');
  });
}

/** A number, decimals allowed (a comma works as the decimal mark too), within [min, max] when given. */
export function num<N extends string>(name: N, range: { min?: number; max?: number } = {}): Arg<N, number> {
  return arg(name, w =>
    inRange(name, /^[+-]?(\d+[.,]?\d*|[.,]\d+)$/.test(w) ? Number(w.replace(',', '.')) : Number.NaN, range, 'a number'),
  );
}

/** Any one word. */
export function word<N extends string>(name: N): Arg<N, string> {
  return arg(name, w => w);
}

/** On or off: on, off, true, false, 1, 0, yes, no, ja, nej. */
export function toggle<N extends string>(name: N): Arg<N, boolean> {
  const ON = ['on', 'true', '1', 'yes', 'ja'],
    OFF = ['off', 'false', '0', 'no', 'nej'];
  return arg(
    name,
    w => {
      const l = w.toLowerCase();
      if (ON.includes(l)) return true;
      if (OFF.includes(l)) return false;
      throw new UsageError(`${name} is on or off.`);
    },
    () => ['on', 'off'],
  );
}

// a choice with this many options or fewer lists them when a word doesn't match: the console on a phone has no Tab
const CHOICES_LISTED = 8;
const sorted = (all: readonly string[]) => [...all].sort((a, b) => a.localeCompare(b, 'sv'));
const fewEnough = (all: readonly string[]) => all.length > 0 && all.length <= CHOICES_LISTED;
const pickOneOf = (all: readonly string[]) => (fewEnough(all) ? ` Pick one of: ${sorted(all).join(', ')}.` : '');

/**
 * One of a set of words, in any case: `choice('place', () => [...places.keys()])`. A function is read on every use, so
 * the set can change while the game runs (a new car model, a place unlocked).
 */
export function choice<N extends string, C extends string>(
  name: N,
  options: readonly C[] | (() => readonly C[]),
): Arg<N, C> {
  const list = typeof options === 'function' ? options : () => options;
  return arg(
    name,
    w => {
      const all = list(),
        found = all.find(o => o.toLowerCase() === w.toLowerCase());
      if (found === undefined) throw new UsageError(`No ${name} called ${w}.${pickOneOf(all)}`);
      return found;
    },
    list,
  );
}

/**
 * One argument that is one of several kinds: `either('when', num('hour'), choice('moment', ['dawn', 'dusk']))` reads
 * `16.5` as a number and `dusk` as a word. The first that parses the word wins, so put the stricter one first. Tab offers
 * the choices of all. A word none takes gets the first one's error, then each later one's: its words in one "Or one of"
 * list when they are few enough, else its own error.
 */
export function either<N extends string, const A extends readonly [AnyArg, AnyArg, ...AnyArg[]]>(
  name: N,
  ...kinds: A
): Arg<N, ReturnType<A[number]['parse']>> {
  // optional() goes round the whole either, where command() reads it; a rest argument can't be one of its kinds
  const flagged = kinds.find(a => a.optional || a.rest);
  if (flagged)
    throw new Error(
      flagged.rest
        ? `${flagged.name}: an either's kinds can't take the rest`
        : `${flagged.name}: an either's kinds can't be optional; wrap the whole either in optional()`,
    );
  const lists = kinds.flatMap(a => (a.choices ? [a.choices.bind(a)] : []));
  // the usage line names each kind, or lists its words when they are few: the console on a phone has no Tab
  const usage = kinds.map(a => a.usage ?? listedWords(a)?.join('|') ?? a.name).join('|');
  const parsed = arg(
    name,
    w => {
      const said: string[] = [],
        listed: string[] = [];
      for (const a of kinds) {
        try {
          return a.parse(w);
        } catch (err) {
          if (!(err instanceof UsageError)) throw err;
          const all = a.choices?.() ?? [];
          // the first kind always says what it wants; a later one with few words only adds them to one list
          if (said.length > 0 && fewEnough(all)) listed.push(...all);
          else said.push(err.message);
        }
      }
      throw new UsageError([...said, ...(listed.length ? [`Or one of: ${sorted(listed).join(', ')}.`] : [])].join(' '));
    },
    lists.length ? () => lists.flatMap(list => list()) : undefined,
  );
  return { ...parsed, usage };
}

// an argument's words when there are few enough to list and they are known now; else undefined
function listedWords(a: AnyArg): readonly string[] | undefined {
  // a list that isn't ready yet is empty, and the name stands in for it
  const all = a.choices?.() ?? [];
  return fewEnough(all) ? all : undefined;
}

/** The rest of the line, as one string: `say <words>`. Only the last argument can be one. */
export function rest<N extends string>(name: N): Arg<N, string> {
  return { ...arg(name, w => w), rest: true };
}

/** The same argument with a line saying what it is, for help: `described(int('speed'), 'km/h')`. */
export function described<N extends string, T, A extends Arg<N, T>>(a: A, help: string): A {
  return { ...a, help };
}

/** The same argument, left out allowed: its value is then undefined. Only the arguments at the end can be optional. */
export function optional<N extends string, T>(a: Arg<N, T>): Arg<N, T> & { readonly optional: true } {
  return { ...a, optional: true };
}

function inRange(name: string, v: number, range: { min?: number; max?: number }, kind: string) {
  if (!Number.isFinite(v)) throw new UsageError(`${name} is ${kind}.`);
  if (outside(v, range)) throw rangeError(name, range);
  // -0 passes { min: 0 } but prints as 0 and divides into -Infinity: hand on 0.
  return v === 0 ? 0 : v;
}

function outside(v: number, { min, max }: { min?: number; max?: number }) {
  return (min !== undefined && v < min) || (max !== undefined && v > max);
}

function rangeError(name: string, { min, max }: { min?: number; max?: number }) {
  return new UsageError(`${name} is from ${min ?? '…'} to ${max ?? '…'}.`);
}

export interface TypedCommand<A extends readonly AnyArg[]> {
  help: string;
  details?: string;
  examples?: readonly string[];
  access?: Access;
  aliases?: readonly string[];
  args: A;
  /** returns the line to show, or `refuse(…)` when the game's rules said no, as Command.run does */
  run(values: ArgValues<A>, call: Call): string | Outcome;
}

/**
 * A Command from a list of typed arguments: `command({ help, args: [choice('place', …), optional(int('speed'))], run:
 * ({ place, speed }) => … })`. Words that don't parse, a missing argument and extra words all show the usage line.
 */
export function command<const A extends readonly AnyArg[]>(spec: TypedCommand<A>): Command {
  const { args } = spec;
  args.forEach((a, i) => {
    if (args.findIndex(b => b.name === a.name) !== i) throw new Error('argument names repeat: ' + a.name);
    if (a.rest && i !== args.length - 1) throw new Error('only the last argument can take the rest: ' + a.name);
    if (!a.optional && i > 0 && args[i - 1].optional) throw new Error('optional arguments go last: ' + a.name);
  });
  const shown = (a: AnyArg) => {
    const label = a.usage ?? a.name,
      n = a.rest ? label + '…' : label;
    return a.optional ? `[${n}]` : `<${n}>`;
  };
  const usage = args.map(shown).join(' ');
  const params = args.flatMap(a => (a.help ? [{ shown: shown(a), help: a.help }] : []));
  return {
    help: spec.help,
    details: spec.details,
    examples: spec.examples,
    params: params.length ? params : undefined,
    access: spec.access,
    aliases: spec.aliases,
    usage: usage || undefined,
    complete: index => {
      const last = args[args.length - 1];
      const a = index < args.length ? args[index] : last?.rest ? last : undefined;
      return a?.choices?.() ?? [];
    },
    run: (words, call) => {
      const values: Record<string, unknown> = {};
      for (let i = 0; i < args.length; i++) {
        const a = args[i];
        const w = a.rest ? words.slice(i).join(' ') : words[i];
        if (w === undefined || w === '') {
          // an either's usage line lists its kinds, not its name, so its name would be a word the line never shows
          if (!a.optional) throw new UsageError(a.usage ? 'An argument is missing.' : `${a.name} is missing.`);
          values[a.name] = undefined;
        } else values[a.name] = a.parse(w);
      }
      const last = args[args.length - 1];
      if (words.length > args.length && !last?.rest) throw new UsageError('Too many words.');
      return spec.run(values as ArgValues<A>, call);
    },
  };
}

export interface GroupSpec<A extends readonly AnyArg[] = readonly []> {
  help: string;
  details?: string;
  examples?: readonly string[];
  access?: Access;
  aliases?: readonly string[];
  /** the commands under it, by the word that picks one: `{ set: command({ … }) }` */
  subcommands: Readonly<Record<string, Command>>;
  /** with `run`: the group's own arguments, for a line whose first word names no subcommand */
  args?: A;
  /** with `args`: what the group does by itself, as a command()'s run: `time` and `time 16:30` beside `time hold` */
  run?(values: ArgValues<A>, call: Call): string | Outcome;
}

/**
 * A command that holds others: `tune set driving.grip 8` runs the `set` under `tune`. Typed on its own, or with a word
 * that names none of them, it shows its usage line, which lists them. Given `args` and `run`, it runs by itself then
 * instead: `time` and `time 16:30` beside `time hold`. A word that names a subcommand always picks it, so the group's
 * first argument can't have one of those names among its choices.
 */
export function group<const A extends readonly AnyArg[] = readonly []>(spec: GroupSpec<A>): Command {
  const names = Object.keys(spec.subcommands).sort();
  const below = `<${names.join('|')}> …`;
  const shared = {
    help: spec.help,
    details: spec.details,
    examples: spec.examples,
    access: spec.access,
    aliases: spec.aliases,
    subcommands: spec.subcommands,
  };
  const noSubcommand = (word: string) => new UsageError(`No subcommand called ${word}.`);
  if (!spec.args || !spec.run) {
    if (spec.args || spec.run) throw new Error('a group that runs by itself needs both args and run');
    return {
      ...shared,
      usage: below,
      run: words => {
        throw words[0] ? noSubcommand(words[0]) : new UsageError('');
      },
    };
  }
  // Catches the mistake in a list that is known now. One that isn't ready yet, or grows later, isn't checked: the
  // subcommand wins then too, which is the rule.
  const known = spec.args[0]?.choices?.() ?? [];
  const hidden = known.find(c => names.includes(c.toLowerCase()));
  if (hidden !== undefined) throw new Error(`${hidden} names a subcommand, so the group's own argument never gets it`);
  const own = command({ help: spec.help, args: spec.args, run: spec.run });
  const first = spec.args[0];
  return {
    ...shared,
    usage: own.usage ? `${own.usage} | ${below}` : below,
    params: own.params,
    complete: own.complete,
    run: (words, call) => {
      // with no arguments of its own, a first word can only have been meant for a subcommand
      if (!first && words[0] !== undefined) throw noSubcommand(words[0]);
      try {
        return own.run(words, call);
      } catch (err) {
        // a first word the group's own argument can't take may have been meant for a subcommand: name them too
        if (!(err instanceof UsageError) || !first || words[0] === undefined || takes(first, words[0])) throw err;
        throw new UsageError(`${err.message ? err.message + ' ' : ''}Or a subcommand: ${names.join(', ')}.`);
      }
    },
  };
}

function takes(a: AnyArg, w: string) {
  try {
    a.parse(w);
    return true;
  } catch {
    return false;
  }
}
