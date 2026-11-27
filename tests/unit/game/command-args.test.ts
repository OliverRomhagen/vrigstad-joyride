import { describe, expect, expectTypeOf, it } from 'vitest';
import {
  arg,
  choice,
  command,
  described,
  either,
  group,
  int,
  num,
  optional,
  rest,
  toggle,
  word,
} from '../../../src/game/command-args';
import { Commands, UsageError } from '../../../src/game/commands';

const PLACES = ['torget', 'Slättsjön', 'skroten'] as const;

/** A registry with one typed command that shows the values it got. */
function withCommand(cmd: Parameters<Commands['register']>[1]) {
  const c = new Commands();
  c.register('t', cmd);
  return c;
}

describe('command', () => {
  it('reads each argument by its type and hands run the values by name', () => {
    const c = withCommand(
      command({
        help: 'go somewhere',
        args: [choice('place', PLACES), optional(int('speed', { min: 0, max: 200 }))],
        run: ({ place, speed }) => `${place} ${speed ?? 'walking'}`,
      }),
    );
    expect(c.run('t SLÄTTSJÖN 90')).toBe('Slättsjön 90');
    expect(c.run('t torget')).toBe('torget walking');
  });

  it('types each value from its argument: a choice as its words, an optional one or undefined', () => {
    command({
      help: 'x',
      args: [choice('place', PLACES), toggle('fast'), optional(int('speed')), optional(rest('note'))],
      run: v => {
        expectTypeOf(v).toEqualTypeOf<{
          place: 'torget' | 'Slättsjön' | 'skroten';
          speed: number | undefined;
          fast: boolean;
          note: string | undefined;
        }>();
        return '';
      },
    });
  });

  it('builds the usage line from the arguments: <needed>, [optional] and rest…', () => {
    const cmd = command({ help: 'x', args: [word('who'), optional(int('n')), optional(rest('words'))], run: () => '' });
    expect(cmd.usage).toBe('<who> [n] [words…]');
    expect(command({ help: 'x', args: [], run: () => '' }).usage).toBeUndefined();
  });

  it('shows the usage line for a missing argument, a bad word and extra words', () => {
    const c = withCommand(command({ help: 'x', args: [choice('place', PLACES)], run: ({ place }) => place }));
    expect(c.run('t')).toBe('place is missing. Usage: t <place>');
    expect(c.run('t gnosjö')).toBe('No place called gnosjö. Pick one of: skroten, Slättsjön, torget. Usage: t <place>');
    expect(c.run('t torget skroten')).toBe('Too many words. Usage: t <place>');
  });

  it('lists a choice of up to 8 words when a word matches none, so the console works without Tab', () => {
    const nine = ['a', 'b', 'c', 'd', 'e', 'f', 'g', 'h', 'i'];
    const c = withCommand(command({ help: 'x', args: [choice('letter', () => nine)], run: ({ letter }) => letter }));
    expect(c.run('t z')).toBe('No letter called z. Usage: t <letter>');
    nine.pop();
    expect(c.run('t z')).toBe('No letter called z. Pick one of: a, b, c, d, e, f, g, h. Usage: t <letter>');
  });

  it('gives a rest argument the rest of the line', () => {
    const c = withCommand(
      command({ help: 'x', args: [word('to'), rest('words')], run: ({ to, words }) => `${to}: ${words}` }),
    );
    expect(c.run('t polisen  hej   på dig')).toBe('polisen: hej på dig');
  });

  it('refuses an argument list it could not read: rest before the end, needed after optional, a name twice', () => {
    expect(() => command({ help: 'x', args: [rest('a'), word('b')], run: () => '' })).toThrow();
    expect(() => command({ help: 'x', args: [optional(word('a')), word('b')], run: () => '' })).toThrow();
    expect(() => command({ help: 'x', args: [word('x'), int('x')], run: () => '' })).toThrow();
  });

  it('completes from the argument at the cursor, a rest argument for every word after', () => {
    const c = withCommand(
      command({ help: 'x', args: [choice('place', PLACES), toggle('fast'), rest('who')], run: () => '' }),
    );
    expect(c.complete('t sk')).toEqual(['skroten']);
    expect(c.complete('t torget ')).toEqual(['off', 'on']);
    expect(c.complete('t torget on ')).toEqual([]);
  });

  it('reads a choice list on each use, so it can change while the game runs', () => {
    const models = ['volvo'];
    const c = withCommand(command({ help: 'x', args: [choice('car', () => models)], run: ({ car }) => car }));
    expect(c.run('t saab')).toBe('No car called saab. Pick one of: volvo. Usage: t <car>');
    models.push('saab');
    expect(c.run('t saab')).toBe('saab');
    expect(c.complete('t s')).toEqual(['saab']);
  });

  it('passes access and aliases through to the registry', () => {
    const c = new Commands({ allowed: a => a === 'player' });
    c.register('stars', command({ help: 'x', aliases: ['wanted'], args: [int('n')], run: ({ n }) => String(n) }));
    c.register('say', command({ help: 'x', access: 'player', args: [rest('words')], run: ({ words }) => words }));
    expect(c.run('wanted 2')).toBe('stars works in dev mode only (?dev).');
    expect(c.run('say hej')).toBe('hej');
  });

  it("shows each described argument, the details and the examples in the command's help", () => {
    const c = withCommand(
      command({
        help: 'go somewhere',
        details: 'In the car if you are in one.',
        examples: ['t torget', 't skroten 40'],
        args: [described(choice('place', PLACES), 'a place on the map'), optional(described(int('speed'), 'km/h'))],
        run: () => '',
      }),
    );
    expect(c.run('t --help')).toBe(
      't <place> [speed]: go somewhere\n  <place>: a place on the map\n  [speed]: km/h\n' +
        'In the car if you are in one.\nExamples:\n  t torget\n  t skroten 40',
    );
    expect(command({ help: 'x', args: [word('who')], run: () => '' }).params).toBeUndefined();
  });

  it('keeps an optional argument optional whichever way round described() is used', () => {
    command({
      help: 'x',
      args: [optional(described(int('a'), 'a')), described(optional(int('b')), 'b')],
      run: v => {
        expectTypeOf(v).toEqualTypeOf<{ a: number | undefined; b: number | undefined }>();
        return '';
      },
    });
  });
});

describe('argument types', () => {
  const read = <T>(a: { parse(w: string): T }, w: string) => a.parse(w);

  it('int: whole numbers within the range', () => {
    const n = int('stars', { min: 0, max: 3 });
    expect(read(n, '2')).toBe(2);
    expect(() => read(n, '4')).toThrow('stars is from 0 to 3.');
    expect(() => read(n, '1.5')).toThrow('stars is a whole number.');
    expect(() => read(n, 'tre')).toThrow('stars is a whole number.');
  });

  it('int: -0 comes through as 0', () => {
    expect(Object.is(read(int('stars', { min: 0 }), '-0'), 0)).toBe(true);
    expect(Object.is(read(int('n'), '-000'), 0)).toBe(true);
  });

  it('int: a number too long to hold exactly is out of range, not "not a whole number"', () => {
    expect(read(int('n'), '9007199254740991')).toBe(9007199254740991);
    expect(() => read(int('n'), '9007199254740992')).toThrow('n is out of range.');
    expect(() => read(int('n'), '-12345678901234567890')).toThrow('n is out of range.');
    expect(read(int('n'), '1234567890123456')).toBe(1234567890123456);
    expect(() => read(int('stars', { min: 0, max: 3 }), '99999999999999999999')).toThrow('stars is from 0 to 3.');
    // Past an open end the range isn't broken, so it isn't named.
    expect(() => read(int('n', { min: 0 }), '99999999999999999999')).toThrow('n is out of range.');
    expect(() => read(int('n', { max: 3 }), '-99999999999999999999')).toThrow('n is out of range.');
    expect(() => read(int('n', { min: 0 }), '-99999999999999999999')).toThrow('n is from 0 to ….');
  });

  it('num: decimals, with a point or a Swedish comma', () => {
    const g = num('gravity', { min: 0 });
    expect(read(g, '9.8')).toBe(9.8);
    expect(read(g, '9,8')).toBe(9.8);
    expect(read(g, '.5')).toBe(0.5);
    expect(() => read(g, '-1')).toThrow('gravity is from 0 to ….');
    expect(() => read(g, '1e3')).toThrow('gravity is a number.');
  });

  it('num: -0 comes through as 0', () => {
    const g = num('gravity', { min: 0 });
    for (const w of ['-0', '-0.0', '-0,0']) expect(Object.is(read(g, w), 0)).toBe(true);
  });

  it('toggle: on and off in English or Swedish', () => {
    const t = toggle('god');
    for (const w of ['on', 'TRUE', '1', 'ja']) expect(read(t, w)).toBe(true);
    for (const w of ['off', 'false', '0', 'nej']) expect(read(t, w)).toBe(false);
    expect(() => read(t, 'kanske')).toThrow('god is on or off.');
  });
});

describe('group', () => {
  const tune = () => {
    const c = new Commands();
    const calls: string[] = [];
    c.use((call, next) => {
      calls.push(`${call.name} ${call.args.join(' ')}`);
      return next();
    });
    const set = command({
      help: 'change a number',
      examples: ['tune set grip 8'],
      args: [choice('key', ['grip', 'speed']), num('value')],
      run: ({ key, value }) => `${key} = ${value}`,
    });
    const get = command({ help: 'show a number', args: [choice('key', ['grip', 'speed'])], run: ({ key }) => key });
    c.register('tune', group({ help: 'gameplay numbers', subcommands: { set, get } }));
    return { c, calls };
  };

  it('runs the subcommand the next word names, and the hooks see the whole line under the group', () => {
    const { c, calls } = tune();
    expect(c.run('tune SET grip 8')).toBe('grip = 8');
    expect(calls).toEqual(['tune SET grip 8']);
  });

  it('shows the usage line of the subcommand, or of the group for a word that names none', () => {
    const { c } = tune();
    expect(c.run('tune set grip')).toBe('value is missing. Usage: tune set <key> <value>');
    expect(c.run('tune')).toBe('Usage: tune <get|set> …');
    expect(c.run('tune fly')).toBe('No subcommand called fly. Usage: tune <get|set> …');
    expect(c.usageFor('tune se')).toBe('tune <get|set> …');
    expect(c.usageFor('tune set g')).toBe('tune set <key> <value>');
  });

  it('answers help and --help for the group and for each subcommand', () => {
    const { c } = tune();
    const groupHelp =
      'tune <get|set> …: gameplay numbers\n  tune get <key>: show a number\n  tune set <key> <value>: change a number';
    expect(c.run('tune --help')).toBe(groupHelp);
    expect(c.run('help tune')).toBe(groupHelp);
    const setHelp = 'tune set <key> <value>: change a number\nExamples:\n  tune set grip 8';
    expect(c.run('tune set --help')).toBe(setHelp);
    expect(c.run('help tune set')).toBe(setHelp);
    expect(c.run('help tune fly')).toBe('No command called tune fly. Usage: help [command]');
  });

  it('completes the subcommands, then their arguments', () => {
    const { c } = tune();
    expect(c.complete('tune ')).toEqual(['get', 'set']);
    expect(c.complete('tune s')).toEqual(['set']);
    expect(c.complete('tune set ')).toEqual(['grip', 'speed']);
    expect(c.complete('tune fly ')).toEqual([]);
  });

  it('refuses a subcommand without help, or an example that does not run it', () => {
    const c = new Commands();
    const bare = { help: '', run: () => '' };
    expect(() => c.register('tune', group({ help: 'numbers', subcommands: { set: bare } }))).toThrow(
      'tune set: help is one line',
    );
    const set = { help: 'change', examples: ['set grip 8'], run: () => '' };
    expect(() => c.register('tune', group({ help: 'numbers', subcommands: { set } }))).toThrow(
      'tune set: the example "set grip 8" doesn\'t run it',
    );
  });
});

describe('a group that runs by itself', () => {
  // `fuel` shows the tank, `fuel 30` sets it, `fuel fill` fills it
  const fuel = () => {
    const c = new Commands();
    let litres = 10;
    c.register(
      'fuel',
      group({
        help: 'show or set the fuel',
        examples: ['fuel', 'fuel 30', 'fuel fill'],
        args: [
          optional(
            described(either('amount', num('litres', { min: 0, max: 60 }), choice('level', ['half'] as const)), 'L'),
          ),
        ],
        run: ({ amount }) => {
          if (amount !== undefined) litres = amount === 'half' ? 30 : amount;
          return `${litres} L`;
        },
        subcommands: {
          fill: command({
            help: 'fill the tank',
            args: [],
            run: () => {
              litres = 60;
              return 'Full.';
            },
          }),
        },
      }),
    );
    return c;
  };

  it('runs its own run for a line whose first word names no subcommand, and the subcommand for one that does', () => {
    const c = fuel();
    expect(c.run('fuel')).toBe('10 L');
    expect(c.run('fuel 25,5')).toBe('25.5 L');
    expect(c.run('fuel half')).toBe('30 L');
    expect(c.run('fuel FILL')).toBe('Full.');
    expect(c.run('fuel')).toBe('60 L');
  });

  it('shows both in its usage line and its help', () => {
    const c = fuel();
    expect(c.run('fuel 99')).toBe(
      'litres is from 0 to 60. Or one of: half. Or a subcommand: fill. Usage: fuel [litres|half] | <fill> …',
    );
    expect(c.run('fuel 1 2')).toBe('Too many words. Usage: fuel [litres|half] | <fill> …');
    expect(c.run('fuel fill 2')).toBe('Too many words. Usage: fuel fill');
    expect(c.usageFor('fuel ')).toBe('fuel [litres|half] | <fill> …');
    expect(c.run('help fuel')).toBe(
      'fuel [litres|half] | <fill> …: show or set the fuel\n  [litres|half]: L\n  fuel fill: fill the tank\nExamples:\n  fuel\n  fuel 30\n  fuel fill',
    );
  });

  it('completes the subcommands and the words of its own first argument together, then only its own', () => {
    const c = fuel();
    expect(c.complete('fuel ')).toEqual(['fill', 'half']);
    expect(c.complete('fuel h')).toEqual(['half']);
    expect(c.complete('fuel half ')).toEqual([]);
    expect(c.complete('fuel fill ')).toEqual([]);
  });

  it('refuses args without run, and a first argument whose choices hide behind a subcommand', () => {
    const fill = command({ help: 'fill the tank', args: [], run: () => '' });
    expect(() => group({ help: 'fuel', subcommands: { fill }, args: [] })).toThrow('needs both args and run');
    expect(() =>
      group({ help: 'fuel', subcommands: { fill }, args: [choice('level', ['half', 'Fill'])], run: () => '' }),
    ).toThrow('Fill names a subcommand');
    expect(() => group({ help: 'fuel', subcommands: { fill }, run: () => '' })).toThrow('needs both args and run');
  });

  it("builds with a first argument whose list isn't ready yet, and lets the subcommand win a word added later", () => {
    const levels: string[] = [];
    let ready = false;
    const level = choice('level', () => {
      if (!ready) throw new Error('not loaded');
      return levels;
    });
    const c = new Commands();
    const fill = command({ help: 'fill the tank', args: [], run: () => 'Full.' });
    c.register(
      'fuel',
      group({ help: 'fuel', subcommands: { fill }, args: [optional(level)], run: ({ level }) => level ?? 'none' }),
    );
    ready = true;
    levels.push('half', 'fill');
    expect(c.run('fuel half')).toBe('half');
    expect(c.run('fuel fill')).toBe('Full.');
    expect(c.complete('fuel ')).toEqual(['fill', 'half']);
  });

  it("takes only its own subcommands' names, not the keys every object has", () => {
    const c = fuel();
    for (const word of ['constructor', '__proto__', 'toString', 'hasOwnProperty']) {
      expect(c.run(`fuel ${word}`), word).toMatch(
        /^litres is a number\. Or one of: half\. Or a subcommand: fill\. Usage: fuel /,
      );
      expect(c.run(`help fuel ${word}`), word).toBe(`No command called fuel ${word}. Usage: help [command]`);
    }
    const tune = new Commands();
    tune.register(
      'tune',
      group({ help: 'numbers', subcommands: { get: command({ help: 'show', args: [], run: () => '' }) } }),
    );
    expect(tune.run('tune constructor')).toBe('No subcommand called constructor. Usage: tune <get> …');
  });
});

describe('either', () => {
  const when = either('when', int('hour', { min: 5, max: 19 }), choice('moment', ['dawn', 'dusk'] as const));

  it('reads a word as the first argument that takes it, typed as either value', () => {
    expect(when.parse('7')).toBe(7);
    expect(when.parse('DUSK')).toBe('dusk');
    expectTypeOf(when.parse('7')).toEqualTypeOf<number | 'dawn' | 'dusk'>();
    expect(when.name).toBe('when');
  });

  it("offers both arguments' choices to Tab", () => {
    expect(when.choices?.()).toEqual(['dawn', 'dusk']);
    expect(either('x', toggle('on'), choice('mode', ['auto'])).choices?.()).toEqual(['on', 'off', 'auto']);
    expect(either('x', int('a'), word('b')).choices).toBeUndefined();
  });

  it("gives the first argument's error, then the second's choices when they are few, else its error", () => {
    expect(() => when.parse('3')).toThrow('hour is from 5 to 19. Or one of: dawn, dusk.');
    expect(() => when.parse('lunch')).toThrow('hour is a whole number. Or one of: dawn, dusk.');
    const many = choice('key', ['a', 'b', 'c', 'd', 'e', 'f', 'g', 'h', 'i']);
    expect(() => either('x', int('n'), many).parse('z')).toThrow('n is a whole number. No key called z.');
    expect(() => either('x', int('n'), toggle('on')).parse('z')).toThrow('n is a whole number. Or one of: off, on.');
  });

  it('lets an error that is no UsageError through', () => {
    const broken = arg('b', () => {
      throw new TypeError('bug');
    });
    expect(() => either('x', broken, word('w')).parse('z')).toThrow(TypeError);
    expect(() => either('x', int('n'), broken).parse('z')).toThrow(TypeError);
  });

  it('takes more than two kinds, and keeps what each says: errors in order, then the few words in one list', () => {
    const three = either(
      'x',
      int('n'),
      num('hour', { min: 5, max: 19 }),
      choice('moment', ['dusk'] as const),
      toggle('on'),
    );
    expect(three.parse('7')).toBe(7);
    expect(three.parse('7,5')).toBe(7.5);
    expect(three.parse('dusk')).toBe('dusk');
    expect(three.parse('nej')).toBe(false);
    expectTypeOf(three.parse('7')).toEqualTypeOf<number | 'dusk' | boolean>();
    expect(() => three.parse('30.5')).toThrow('n is a whole number. hour is from 5 to 19. Or one of: dusk, off, on.');
  });

  it('refuses a kind that is optional or takes the rest: those go round the whole either', () => {
    expect(() => either('x', int('n'), optional(word('w')))).toThrow(
      "w: an either's kinds can't be optional; wrap the whole either in optional()",
    );
    expect(() => either('x', rest('words'), int('n'))).toThrow(/^words: an either's kinds can't take the rest$/);
    expect(optional(either('x', int('n'), word('w'))).optional).toBe(true);
  });

  it('names no either by a word its usage line never shows when it is left out', () => {
    const c = new Commands();
    c.register(
      't',
      command({ help: 'h', args: [either('when', int('n'), choice('moment', ['dusk'] as const))], run: () => 'ok' }),
    );
    expect(c.run('t')).toBe('An argument is missing. Usage: t <n|dusk>');
  });
});

describe('arg', () => {
  it("builds an argument of a module's own type, which command() reads like the others", () => {
    const clock = arg('at', w => {
      const m = /^(\d\d):(\d\d)$/.exec(w);
      if (!m) throw new UsageError('at is a time, as 16:30.');
      return Number(m[1]) * 60 + Number(m[2]);
    });
    const c = withCommand(command({ help: 'wait until', args: [clock], run: ({ at }) => `${at} min` }));
    expect(c.run('t 16:30')).toBe('990 min');
    expect(c.run('t soon')).toBe('at is a time, as 16:30. Usage: t <at>');
  });
});
