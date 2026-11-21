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
  return arg(name, w => inRange(name, /^[+-]?\d{1,15}$/.test(w) ? Number(w) : Number.NaN, range, 'a whole number'));
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
      const found = list().find(o => o.toLowerCase() === w.toLowerCase());
      if (found === undefined) throw new UsageError(`No ${name} called ${w}.`);
      return found;
    },
    list,
  );
}

/** The rest of the line, as one string: `say <words>`. Only the last argument can be one. */
export function rest<N extends string>(name: N): Arg<N, string> {
  return { ...arg(name, w => w), rest: true };
}

/** The same argument, left out allowed: its value is then undefined. Only the arguments at the end can be optional. */
export function optional<N extends string, T>(a: Arg<N, T>): Arg<N, T> & { readonly optional: true } {
  return { ...a, optional: true };
}

function inRange(name: string, v: number, { min, max }: { min?: number; max?: number }, kind: string) {
  if (!Number.isFinite(v)) throw new UsageError(`${name} is ${kind}.`);
  if ((min !== undefined && v < min) || (max !== undefined && v > max))
    throw new UsageError(`${name} is from ${min ?? '…'} to ${max ?? '…'}.`);
  return v;
}

export interface TypedCommand<A extends readonly AnyArg[]> {
  help: string;
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
  const usage = args
    .map(a => {
      const shown = a.rest ? a.name + '…' : a.name;
      return a.optional ? `[${shown}]` : `<${shown}>`;
    })
    .join(' ');
  return {
    help: spec.help,
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
