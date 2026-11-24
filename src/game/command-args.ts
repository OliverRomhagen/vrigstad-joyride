// Typed arguments for console commands (#218): a command lists its arguments once, and gets their parsing, its usage
// line and Tab completion from that list. Pure: no DOM, no three.js. docs/console.md has the contract.
import { type Access, type Call, type Command, UsageError } from './commands';

/** One argument: its name, how to read it from a word, and the words that fit it, for Tab. */
export interface Arg<N extends string, T> {
  readonly name: N;
  readonly optional: boolean;
  /** takes every word left, joined by spaces */
  readonly rest: boolean;
  parse(word: string): T;
  choices?(): readonly string[];
  /** what it is, for `help <command>`: `km/h`, `a place on the map` */
  readonly help?: string;
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

const arg = <N extends string, T>(name: N, parse: (word: string) => T, choices?: () => readonly string[]) => ({
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
    // Past 2^53 a number can't be told from its neighbours, so it's out of range, whatever range was asked for.
    if (!Number.isSafeInteger(v))
      throw range.min === undefined && range.max === undefined
        ? new UsageError(`${name} is out of range.`)
        : rangeError(name, range);
    // -0 passes { min: 0 } but prints as 0 and divides into -Infinity: hand on 0.
    return inRange(name, v === 0 ? 0 : v, range, 'a whole number');
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
const pickOneOf = (all: readonly string[]) =>
  all.length > 0 && all.length <= CHOICES_LISTED
    ? ` Pick one of: ${[...all].sort((a, b) => a.localeCompare(b, 'sv')).join(', ')}.`
    : '';

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

function inRange(name: string, v: number, { min, max }: { min?: number; max?: number }, kind: string) {
  if (!Number.isFinite(v)) throw new UsageError(`${name} is ${kind}.`);
  if ((min !== undefined && v < min) || (max !== undefined && v > max)) throw rangeError(name, { min, max });
  return v;
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
  run(values: ArgValues<A>, call: Call): string;
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
    const n = a.rest ? a.name + '…' : a.name;
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
          if (!a.optional) throw new UsageError();
          values[a.name] = undefined;
        } else values[a.name] = a.parse(w);
      }
      const last = args[args.length - 1];
      if (words.length > args.length && !last?.rest) throw new UsageError('Too many words.');
      return spec.run(values as ArgValues<A>, call);
    },
  };
}

export interface GroupSpec {
  help: string;
  details?: string;
  examples?: readonly string[];
  access?: Access;
  aliases?: readonly string[];
  /** the commands under it, by the word that picks one: `{ set: command({ … }) }` */
  subcommands: Readonly<Record<string, Command>>;
}

/**
 * A command that only holds others: `tune set driving.grip 8` runs the `set` under `tune`. Typed on its own, or with a
 * word that names none of them, it shows its usage line, which lists them.
 */
export function group(spec: GroupSpec): Command {
  const names = Object.keys(spec.subcommands).sort();
  return {
    help: spec.help,
    details: spec.details,
    examples: spec.examples,
    access: spec.access,
    aliases: spec.aliases,
    subcommands: spec.subcommands,
    usage: `<${names.join('|')}> …`,
    run: words => {
      throw new UsageError(words[0] ? `No subcommand called ${words[0]}.` : '');
    },
  };
}
