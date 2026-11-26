// The console's way into the tunables registry (#357): tune set, get, list and reset work on every entry, so no tunable
// registers a command of its own. They sit under `tune`, so `list` and `reset` stay free for other areas. Pure: no
// DOM, no three.js. docs/console.md, step 3.
import { type Arg, choice, command, described, group, num, optional } from '../command-args';
import { type Commands, UsageError } from '../commands';
import type { TunableInfo, Tunables } from './tunables';

/** Adds `tune`, with set, get, list and reset under it, over every number in `tunables`. */
export function registerTunableCommands(commands: Pick<Commands, 'register'>, tunables: Tunables): void {
  const tunableArg = () => choice('tunable', () => tunables.keys());
  const show = (k: string) => `${k} = ${fmt(tunables.get(k))} ${info(tunables, k).unit}`;

  const set = command({
    help: 'change a gameplay number while the game runs',
    details: 'The value is in the number’s unit and range: tune get <tunable> shows both. tune reset puts it back.',
    examples: ['tune set driving.grip 8', 'tune set vehicle.volvo.top-speed 45'],
    args: [tunableArg(), described(num('value'), 'in the tunable’s unit, within its range')],
    run: ({ tunable, value }) => {
      const before = tunables.get(tunable);
      try {
        tunables.set(tunable, value);
      } catch (err) {
        if (err instanceof RangeError) throw new UsageError(err.message + '.');
        throw err;
      }
      return `${show(tunable)} (was ${fmt(before)})`;
    },
  });

  const get = command({
    help: 'show a gameplay number, its unit, range and default',
    examples: ['tune get driving.grip'],
    args: [tunableArg()],
    run: ({ tunable }) => {
      const entry = info(tunables, tunable);
      return `${show(tunable)}: ${entry.help}\nDefault ${fmt(entry.defaultValue)}, from ${fmt(entry.min)} to ${fmt(entry.max)} ${entry.unit}.`;
    },
  });

  const list = command({
    help: 'list the groups of gameplay numbers, or the numbers in one',
    details:
      'On its own it lists the groups, with how many numbers each has changed. A changed number shows its default.',
    examples: ['tune list', 'tune list driving', 'tune list vehicle.volvo'],
    args: [optional(prefix(tunables))],
    run: ({ prefix: start }) => {
      if (start === undefined) {
        // a group is a key without its last part: `vehicle.volvo` for `vehicle.volvo.top-speed`
        const groups = new Map<string, string[]>();
        for (const k of tunables.keys()) {
          const groupName = k.slice(0, k.lastIndexOf('.'));
          const keys = groups.get(groupName);
          if (keys) keys.push(k);
          else groups.set(groupName, [k]);
        }
        return [...groups]
          .map(([groupName, keys]) => {
            const changedCount = keys.filter(k => tunables.isChanged(k)).length;
            const changed = changedCount ? `, ${changedCount} changed` : '';
            return `${groupName}: ${keys.length} number${keys.length > 1 ? 's' : ''}${changed}`;
          })
          .join('\n');
      }
      return tunables
        .keys()
        .filter(k => k === start || k.startsWith(start + '.'))
        .map(k => (tunables.isChanged(k) ? `${show(k)} (default ${fmt(info(tunables, k).defaultValue)})` : show(k)))
        .join('\n');
    },
  });

  const reset = command({
    help: 'put a gameplay number back to its default, or every one',
    examples: ['tune reset driving.grip', 'tune reset'],
    args: [optional(tunableArg())],
    run: ({ tunable }) => {
      if (tunable !== undefined) {
        tunables.reset(tunable);
        return show(tunable);
      }
      const changedCount = tunables.keys().filter(k => tunables.isChanged(k)).length;
      tunables.reset();
      return `Every tunable is back to its default (${changedCount} had changed).`;
    },
  });

  commands.register(
    'tune',
    group({
      help: 'set, get, list and reset gameplay numbers while the game runs',
      examples: ['tune list', 'tune set driving.grip 8'],
      subcommands: { set, get, list, reset },
    }),
  );
}

/** The start of a key, up to a dot (`vehicle`, `vehicle.volvo`), or a whole key; Tab offers every one. */
function prefix(tunables: Tunables): Arg<'prefix', string> {
  const prefixes = () => {
    const all = new Set<string>();
    for (const k of tunables.keys()) {
      const parts = k.split('.');
      for (let i = 1; i <= parts.length; i++) all.add(parts.slice(0, i).join('.'));
    }
    return [...all].sort();
  };
  return {
    ...choice('prefix', prefixes),
    parse: w => {
      const start = w.toLowerCase().replace(/\.$/, '');
      if (!prefixes().includes(start)) throw new UsageError(`No tunable starts with ${w}.`);
      return start;
    },
  };
}

function info(tunables: Tunables, key: string): TunableInfo {
  const entry = tunables.entry(key);
  if (!entry) throw new UsageError('No tunable called ' + key + '.');
  return entry;
}

// rounds away float noise (0.30000000000000004, 17 digits) without hiding a value someone typed (12.0000001)
function fmt(v: number): string {
  return String(Number(v.toPrecision(12)));
}
