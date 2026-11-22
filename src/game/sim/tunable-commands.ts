// The console's way into the tunables registry (#357): set, get, list and reset work on every entry, so no tunable
// registers a command of its own. Pure: no DOM, no three.js. docs/console.md, step 3.
import { type Arg, choice, command, described, num, optional } from '../command-args';
import { type Commands, UsageError } from '../commands';
import type { TunableInfo, Tunables } from './tunables';

/** Adds set, get, list and reset over every number in `tunables`. */
export function registerTunableCommands(commands: Pick<Commands, 'register'>, tunables: Tunables): void {
  const key = () => choice('tunable', () => tunables.keys());
  const show = (k: string) => `${k} = ${fmt(tunables.get(k))} ${info(tunables, k).unit}`;

  commands.register(
    'set',
    command({
      help: 'change a gameplay number while the game runs',
      details: 'The value is in the number’s unit and range: get <tunable> shows both. reset puts it back.',
      examples: ['set driving.grip 8', 'set vehicle.volvo.top-speed 45'],
      args: [key(), described(num('value'), 'in the tunable’s unit, within its range')],
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
    }),
  );

  commands.register(
    'get',
    command({
      help: 'show a gameplay number, its unit, range and default',
      examples: ['get driving.grip'],
      args: [key()],
      run: ({ tunable }) => {
        const t = info(tunables, tunable);
        return `${show(tunable)}: ${t.help}\nDefault ${fmt(t.defaultValue)}, from ${fmt(t.min)} to ${fmt(t.max)} ${t.unit}.`;
      },
    }),
  );

  commands.register(
    'list',
    command({
      help: 'list the gameplay numbers, or the ones under a prefix',
      details: 'A number changed from its default shows the default after it.',
      examples: ['list', 'list driving', 'list vehicle.volvo'],
      args: [optional(prefix(tunables))],
      run: ({ prefix: p }) =>
        tunables
          .keys()
          .filter(k => p === undefined || k === p || k.startsWith(p + '.'))
          .map(k => {
            const v = tunables.get(k),
              d = info(tunables, k).defaultValue;
            return v === d ? show(k) : `${show(k)} (default ${fmt(d)})`;
          })
          .join('\n'),
    }),
  );

  commands.register(
    'reset',
    command({
      help: 'put a gameplay number back to its default, or every one',
      examples: ['reset driving.grip', 'reset'],
      args: [optional(key())],
      run: ({ tunable }) => {
        tunables.reset(tunable);
        return tunable === undefined ? 'Every tunable is back to its default.' : show(tunable);
      },
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
      const p = w.toLowerCase().replace(/\.$/, '');
      if (!prefixes().includes(p)) throw new UsageError(`No tunable starts with ${w}.`);
      return p;
    },
  };
}

function info(tunables: Tunables, key: string): TunableInfo {
  const t = tunables.entry(key);
  if (!t) throw new UsageError('No tunable called ' + key + '.');
  return t;
}

// rounds away float noise (0.30000000000000004) without hiding a value someone typed
function fmt(v: number): string {
  return String(Number(v.toPrecision(6)));
}
