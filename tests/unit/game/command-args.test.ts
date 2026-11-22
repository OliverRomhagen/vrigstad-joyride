import { describe, expect, expectTypeOf, it } from 'vitest';
import { choice, command, described, int, num, optional, rest, toggle, word } from '../../../src/game/command-args';
import { Commands } from '../../../src/game/commands';

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
    expect(c.run('t gnosjö')).toBe('No place called gnosjö. Usage: t <place>');
    expect(c.run('t torget skroten')).toBe('Too many words. Usage: t <place>');
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
    expect(c.run('t saab')).toBe('No car called saab. Usage: t <car>');
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
        'In the car if you are in one.\nExamples: t torget, t skroten 40',
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

  it('num: decimals, with a point or a Swedish comma', () => {
    const g = num('gravity', { min: 0 });
    expect(read(g, '9.8')).toBe(9.8);
    expect(read(g, '9,8')).toBe(9.8);
    expect(read(g, '.5')).toBe(0.5);
    expect(() => read(g, '-1')).toThrow('gravity is from 0 to ….');
    expect(() => read(g, '1e3')).toThrow('gravity is a number.');
  });

  it('toggle: on and off in English or Swedish', () => {
    const t = toggle('god');
    for (const w of ['on', 'TRUE', '1', 'ja']) expect(read(t, w)).toBe(true);
    for (const w of ['off', 'false', '0', 'nej']) expect(read(t, w)).toBe(false);
    expect(() => read(t, 'kanske')).toThrow('god is on or off.');
  });
});
