import { describe, expect, it } from 'vitest';
import { type Call, Commands, HELP_MAX, parseKr, UsageError } from '../../../src/game/commands';

describe('commands', () => {
  const echo = () => {
    const c = new Commands();
    c.register('echo', { usage: '<words>', help: 'say the words back', run: a => a.join(' ') });
    return c;
  };

  it('runs a command with the words after its name, whatever the spacing and case of the name', () => {
    expect(echo().run('  ECHO   hej   Vrigstad ')).toBe('hej Vrigstad');
  });

  it('shows nothing for an empty line and points to help for an unknown command', () => {
    const c = echo();
    expect(c.run('   ')).toBe('');
    expect(c.run('fly 3')).toBe('Unknown command: fly. Type help for the list.');
  });

  it('lists every command in help, sorted, with its usage', () => {
    expect(echo().run('help')).toBe(
      'echo <words>: say the words back\nhelp [command]: list the commands, or show how to use one',
    );
  });

  it('shows the usage line for bad arguments, and passes other errors on', () => {
    const c = echo();
    c.register('kr', { usage: '<amount>', help: 'money', run: a => String(parseKr(a[0])) });
    c.register('boom', {
      help: 'breaks',
      run: () => {
        throw new Error('broken');
      },
    });
    expect(c.run('kr lots')).toBe('Usage: kr <amount>');
    expect(c.run('kr')).toBe('Usage: kr <amount>');
    expect(c.run('kr -50')).toBe('-50');
    expect(() => c.run('boom')).toThrow('broken');
  });

  it('shows how to use one command with help <command>', () => {
    const c = echo();
    expect(c.run('help echo')).toBe('echo <words>: say the words back');
    expect(c.run('help fly')).toBe('No command called fly. Usage: help [command]');
  });

  it('runs a command by any of its aliases, and refuses an alias that is taken', () => {
    const c = echo();
    c.register('teleport', { aliases: ['tp'], help: 'go', run: (a, call) => call.name + ' ' + a.join(' ') });
    expect(c.run('TP torget')).toBe('teleport torget');
    expect(c.run('help tp')).toBe('teleport: go (also tp)');
    expect(() => c.register('tp', { help: 'x', run: () => '' })).toThrow();
    expect(() => c.register('jump', { aliases: ['echo'], help: 'x', run: () => '' })).toThrow();
  });

  it('takes a command out again with the function register returns', () => {
    const c = echo();
    const drop = c.register('fly', { aliases: ['f'], help: 'fly', run: () => 'flying' });
    expect(c.run('f')).toBe('flying');
    drop();
    expect(c.run('fly')).toBe('Unknown command: fly. Type help for the list.');
    expect(c.run('f')).toBe('Unknown command: f. Type help for the list.');
    c.register('fly', { help: 'fly again', run: () => 'again' });
    drop(); // a stale remover leaves the new command alone
    expect(c.run('fly')).toBe('again');
  });

  it('leaves a later registration of the same command alone when an old remover runs again', () => {
    const c = echo();
    const fly = { help: 'fly', run: () => 'flying' };
    const drop = c.register('fly', fly);
    drop();
    c.register('fly', fly);
    drop();
    expect(c.run('fly')).toBe('flying');
  });

  it('hides dev commands outside dev mode, and says why when one is typed', () => {
    let dev = false;
    const c = new Commands({ allowed: a => a === 'player' || dev });
    c.register('god', { help: 'no damage', run: () => 'god on' });
    c.register('wave', { help: 'wave', access: 'player', run: () => 'hej' });
    expect(c.names()).toEqual(['help', 'wave']);
    expect(c.run('god')).toBe('god works in dev mode only (?dev).');
    expect(c.complete('g')).toEqual([]);
    dev = true;
    expect(c.names()).toEqual(['god', 'help', 'wave']);
    expect(c.run('god')).toBe('god on');
  });

  describe('help', () => {
    it('refuses a command without one line of help, or with an example that runs something else', () => {
      const c = new Commands();
      const run = () => '';
      expect(() => c.register('fly', { help: '  ', run })).toThrow('help is one line');
      expect(() => c.register('fly', { help: 'fly\nhigh', run })).toThrow('help is one line');
      expect(() => c.register('fly', { help: 'f'.repeat(HELP_MAX + 1), run })).toThrow('help is one line');
      expect(() => c.register('fly', { help: 'fly', examples: ['jump 3'], run })).toThrow("doesn't run it");
      expect(() => c.register('fly', { help: 'fly', aliases: ['f'], examples: ['fly', ' f 3'], run })).not.toThrow();
    });

    it('answers --help and -h for every command, before it runs and outside the hooks', () => {
      const c = new Commands();
      let runs = 0,
        hooked = 0;
      c.register('fly', {
        usage: '<height>',
        help: 'fly up',
        aliases: ['f'],
        params: [{ shown: '<height>', help: 'metres' }],
        details: 'Lands where it took off.',
        examples: ['fly 30'],
        run: () => String(++runs),
      });
      c.use((_call, next) => {
        hooked++;
        return next();
      });
      const full = 'fly <height>: fly up (also f)\n  <height>: metres\nLands where it took off.\nExamples: fly 30';
      expect(c.run('fly --help')).toBe(full);
      expect(c.run('f -h')).toBe(full);
      expect(c.run('help fly')).toBe(full);
      expect([runs, hooked]).toEqual([0, 1]); // only `help fly` ran a command: help itself
      expect(c.run('fly 3 --help')).toBe('1'); // only on its own after the name
    });

    it('keeps --help for a dev command behind dev mode, like the command', () => {
      const c = new Commands({ allowed: a => a === 'player' });
      c.register('god', { help: 'never get hurt', run: () => 'on' });
      expect(c.run('god --help')).toBe('god works in dev mode only (?dev).');
    });
  });

  describe('hooks', () => {
    it('wrap every run, the first added outermost, and see the call and its result', () => {
      const c = echo();
      const seen: string[] = [];
      c.use((call, next) => {
        seen.push('outer ' + call.name + ' ' + call.source);
        return '[' + next() + ']';
      });
      c.use((call, next) => {
        seen.push('inner ' + call.args.join(','));
        return next().toUpperCase();
      });
      expect(c.run('echo a b', 'test')).toBe('[A B]');
      expect(seen).toEqual(['outer echo test', 'inner a,b']);
    });

    it('run the command once when a hook calls next twice', () => {
      const c = new Commands();
      let runs = 0;
      c.register('count', { help: 'count', run: () => String(++runs) });
      c.use((_call, next) => {
        next();
        return next();
      });
      expect(c.run('count')).toBe('1');
      expect(runs).toBe(1);
    });

    it('run a command that throws once too, when a hook catches the error and calls next again', () => {
      const c = new Commands();
      let runs = 0;
      c.register('boom', {
        help: 'boom',
        run: () => {
          runs++;
          throw new Error('half done');
        },
      });
      c.use((_call, next) => {
        try {
          return next();
        } catch {
          return next(); // a retry: gets the same error, not a second run
        }
      });
      expect(() => c.run('boom')).toThrow('half done');
      expect(runs).toBe(1);
    });

    it('can stop a command by not calling next, and see its usage line', () => {
      const c = echo();
      let ran = false;
      c.register('stars', {
        usage: '<n>',
        help: 'stars',
        run: () => {
          ran = true;
          return 'ok';
        },
      });
      const drop = c.use((call, next) => (call.source === 'url' ? 'Not from the URL.' : next()));
      expect(c.run('stars 3', 'url')).toBe('Not from the URL.');
      expect(ran).toBe(false);
      c.register('bad', {
        usage: '<n>',
        help: 'bad',
        run: () => {
          throw new UsageError();
        },
      });
      const results: string[] = [];
      c.use((_call, next) => {
        const r = next();
        results.push(r);
        return r;
      });
      c.run('bad');
      expect(results).toEqual(['Usage: bad <n>']);
      drop();
      expect(c.run('stars 3', 'url')).toBe('ok');
    });

    it('get the registered name and the source on the call the command sees', () => {
      const c = new Commands();
      let got: Call | undefined;
      c.register('teleport', {
        aliases: ['tp'],
        help: 'x',
        run: (_a, call) => {
          got = call;
          return '';
        },
      });
      c.run('tp torget', 'script');
      expect(got).toEqual({ name: 'teleport', args: ['torget'], source: 'script' });
    });
  });

  describe('complete', () => {
    const places = () => {
      const c = echo();
      c.register('go', {
        help: 'go',
        complete: i => (i === 0 ? ['torget', 'Slättsjön', 'skroten'] : []),
        run: () => '',
      });
      return c;
    };

    it('offers command names while the name is typed', () => {
      expect(places().complete('')).toEqual(['echo', 'go', 'help']);
      expect(places().complete('  e')).toEqual(['echo']);
    });

    it("offers the command's words for the argument being typed, in any case", () => {
      expect(places().complete('go ')).toEqual(['Slättsjön', 'skroten', 'torget']);
      expect(places().complete('go s')).toEqual(['Slättsjön', 'skroten']);
      expect(places().complete('GO T')).toEqual(['torget']);
      expect(places().complete('go torget ')).toEqual([]);
      expect(places().complete('echo ')).toEqual([]);
      expect(places().complete('fly ')).toEqual([]);
    });

    it('offers command names for help', () => {
      expect(places().complete('help e')).toEqual(['echo']);
      expect(places().complete('help echo ')).toEqual([]);
    });
  });

  it('refuses a name twice, or a name that is not a lower-case word', () => {
    const c = echo();
    expect(() => c.register('echo', { help: 'x', run: () => '' })).toThrow();
    expect(() => c.register('Tp torget', { help: 'x', run: () => '' })).toThrow();
    expect(() => c.register('go', { aliases: ['go'], help: 'x', run: () => '' })).toThrow();
    expect(() => c.register('go', { aliases: ['tp', 'tp'], help: 'x', run: () => '' })).toThrow();
    expect(c.run('go')).toBe('Unknown command: go. Type help for the list.');
  });
});

describe('parseKr', () => {
  it('reads whole kronor, signed or not', () => {
    expect(parseKr('1000')).toBe(1000);
    expect(parseKr('+5')).toBe(5);
    expect(parseKr('-30')).toBe(-30);
  });

  it('refuses decimals, words, a missing amount and absurd sizes', () => {
    for (const s of ['1.5', 'tusen', '', undefined, '1e6', '1234567890']) expect(() => parseKr(s)).toThrow(UsageError);
  });
});
