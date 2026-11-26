import { describe, expect, expectTypeOf, it } from 'vitest';
import {
  choice,
  command,
  described,
  group,
  int,
  num,
  optional,
  rest,
  toggle,
  word,
} from '../../../src/game/command-args';
import { Commands, refuse } from '../../../src/game/commands';

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
    expect(c.run('t')).toBe('Usage: t <place>');
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

  it('passes a refusal from run through to the registry, and a plain line as done', () => {
    const owned = ['volvo'];
    const c = withCommand(
      command({
        help: 'buy a car',
        args: [choice('car', ['volvo', 'saab'])],
        run: ({ car }) =>
          owned.includes(car) ? refuse('already-owned', `You already own the ${car}.`) : `Bought the ${car}.`,
      }),
    );
    expect(c.execute('t volvo')).toEqual({ ok: false, text: 'You already own the volvo.', code: 'already-owned' });
    expect(c.run('t volvo')).toBe('You already own the volvo.');
    expect(c.execute('t saab')).toEqual({ ok: true, text: 'Bought the saab.' });
    expect(c.execute('t')).toEqual({ ok: false, text: 'Usage: t <car>', code: 'usage' });
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
    expect(c.run('tune set grip')).toBe('Usage: tune set <key> <value>');
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
