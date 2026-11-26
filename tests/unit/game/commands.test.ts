import { describe, expect, it } from 'vitest';
import { type Call, Commands, HELP_MAX, type Outcome, parseKr, refuse, UsageError } from '../../../src/game/commands';

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
      const full = 'fly <height>: fly up (also f)\n  <height>: metres\nLands where it took off.\nExamples:\n  fly 30';
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
        const outcome = next();
        return { ...outcome, text: '[' + outcome.text + ']' };
      });
      c.use((call, next) => {
        seen.push('inner ' + call.args.join(','));
        const outcome = next();
        return { ...outcome, text: outcome.text.toUpperCase() };
      });
      expect(c.run('echo a b', 'test')).toBe('[A B]');
      expect(seen).toEqual(['outer echo test', 'inner a,b']);
      expect(c.execute('echo a b', 'test')).toEqual({ ok: true, text: '[A B]' });
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
        results.push(r.text);
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

  describe('execute', () => {
    /** A registry with a car to get into only once one is parked near, and how many times `enter` ran. */
    const garage = (allowed?: (access: string) => boolean) => {
      const c = new Commands({ allowed });
      let near = false,
        runs = 0;
      c.register('enter', {
        help: 'get into the car in reach',
        access: 'player',
        run: () => {
          runs++;
          return near ? 'You are in the Volvo 240.' : refuse('No car in reach.');
        },
      });
      c.register('kr', { usage: '<amount>', help: 'money', run: a => String(parseKr(a[0])) });
      return {
        c,
        park: () => {
          near = true;
        },
        runs: () => runs,
      };
    };

    it('says a run was done, with its line, for a command that returns a string', () => {
      const { c, park } = garage();
      park();
      expect(c.execute('enter')).toEqual({ ok: true, text: 'You are in the Volvo 240.' });
      expect(c.run('enter')).toBe('You are in the Volvo 240.');
    });

    it('says a run was refused, with the reason, for a command that returns refuse()', () => {
      const { c } = garage();
      expect(refuse('No car in reach.')).toEqual({ ok: false, text: 'No car in reach.' });
      expect(c.execute('enter')).toEqual({ ok: false, text: 'No car in reach.' });
      expect(c.run('enter')).toBe('No car in reach.');
    });

    it('counts bad arguments as not done, with the usage line as before', () => {
      const { c } = garage();
      expect(c.execute('kr lots')).toEqual({ ok: false, text: 'Usage: kr <amount>' });
      expect(c.execute('help fly')).toEqual({ ok: false, text: 'No command called fly. Usage: help [command]' });
      expect(c.run('kr lots')).toBe('Usage: kr <amount>');
    });

    it('counts an unknown command, and one that is not allowed here, as not done', () => {
      const { c } = garage(a => a === 'player');
      expect(c.execute('fly 3')).toEqual({ ok: false, text: 'Unknown command: fly. Type help for the list.' });
      expect(c.execute('kr 5')).toEqual({ ok: false, text: 'kr works in dev mode only (?dev).' });
      expect(c.run('fly 3')).toBe('Unknown command: fly. Type help for the list.');
      expect(c.run('kr 5')).toBe('kr works in dev mode only (?dev).');
    });

    it('counts an empty line, --help and help as done', () => {
      const { c, runs } = garage();
      expect(c.execute('   ')).toEqual({ ok: true, text: '' });
      expect(c.execute('enter --help')).toEqual({ ok: true, text: 'enter: get into the car in reach' });
      expect(c.execute('enter -h').ok).toBe(true);
      expect(c.execute('help enter')).toEqual({ ok: true, text: 'enter: get into the car in reach' });
      expect(c.execute('help').ok).toBe(true);
      expect(runs()).toBe(0);
      expect(c.run('   ')).toBe('');
      expect(c.run('enter --help')).toBe('enter: get into the car in reach');
    });

    it('takes the source, as run does', () => {
      const c = new Commands();
      c.register('from', { help: 'where the line came from', run: (_a, call) => call.source });
      expect(c.execute('from').text).toBe('console');
      expect(c.execute('from', 'script').text).toBe('script');
    });

    it('passes on an error that is not a UsageError', () => {
      const c = new Commands();
      c.register('boom', {
        help: 'breaks',
        run: () => {
          throw new Error('broken');
        },
      });
      expect(() => c.execute('boom')).toThrow('broken');
    });

    it('lets a hook keep only the runs that were done, by reading next().ok', () => {
      const { c, park } = garage();
      const kept: string[] = [];
      c.use((call, next) => {
        const outcome = next();
        if (outcome.ok) kept.push(call.name);
        return outcome;
      });
      c.execute('enter'); // refused: no car in reach
      c.execute('kr lots'); // bad arguments
      c.execute('kr 5');
      park();
      c.execute('enter');
      expect(kept).toEqual(['kr', 'enter']);
    });

    it('counts a line a hook returns instead of calling next as a refusal', () => {
      const { c, park, runs } = garage();
      park();
      c.use((call, next) => {
        if (call.source === 'url' && call.name === 'enter') return 'Not from a link.';
        return next();
      });
      expect(c.execute('enter', 'url')).toEqual({ ok: false, text: 'Not from a link.' });
      expect(c.run('enter', 'url')).toBe('Not from a link.');
      expect(runs()).toBe(0);
      expect(c.execute('enter')).toEqual({ ok: true, text: 'You are in the Volvo 240.' });
    });

    it('shows an outer hook the refusal of an inner one', () => {
      const { c, park } = garage();
      park();
      const seen: Outcome[] = [];
      c.use((_call, next) => {
        const outcome = next();
        seen.push(outcome);
        return outcome;
      });
      c.use(() => 'Not now.');
      expect(c.execute('enter')).toEqual({ ok: false, text: 'Not now.' });
      expect(seen).toEqual([{ ok: false, text: 'Not now.' }]);
    });

    it('hands on the outcome a hook passes through unchanged, done or refused', () => {
      const { c, park } = garage();
      c.use((_call, next) => {
        const answer = next();
        return answer;
      });
      expect(c.execute('enter')).toEqual({ ok: false, text: 'No car in reach.' });
      park();
      expect(c.execute('enter')).toEqual({ ok: true, text: 'You are in the Volvo 240.' });
    });

    it('lets a hook change the line of a run and keep whether it was done', () => {
      const { c, park } = garage();
      c.use((_call, next) => {
        const outcome = next();
        return { ...outcome, text: outcome.text.toUpperCase() };
      });
      expect(c.execute('enter')).toEqual({ ok: false, text: 'NO CAR IN REACH.' });
      park();
      expect(c.execute('enter')).toEqual({ ok: true, text: 'YOU ARE IN THE VOLVO 240.' });
    });

    it('gives a hook that calls next twice the same outcome, from one run', () => {
      const { c, runs } = garage();
      const seen: Outcome[] = [];
      c.use((_call, next) => {
        seen.push(next());
        seen.push(next());
        return next();
      });
      expect(c.execute('enter')).toEqual({ ok: false, text: 'No car in reach.' });
      expect(seen[1]).toBe(seen[0]);
      expect(runs()).toBe(1);
      expect(c.execute('kr lots')).toEqual({ ok: false, text: 'Usage: kr <amount>' });
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

  it('refuses a name twice, or a name that is not kebab-case', () => {
    const c = echo();
    expect(() => c.register('echo', { help: 'x', run: () => '' })).toThrow();
    expect(() => c.register('Tp torget', { help: 'x', run: () => '' })).toThrow();
    for (const bad of ['tp-', 'tp--torget', 'tpTorget'])
      expect(() => c.register(bad, { help: 'x', run: () => '' })).toThrow('kebab-case');
    expect(() => c.register('tp-torget', { help: 'x', run: () => '' })).not.toThrow();
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
