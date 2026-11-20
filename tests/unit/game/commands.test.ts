import { describe, expect, it } from 'vitest';
import { Commands, parseKr, UsageError } from '../../../src/game/commands';

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
    expect(echo().run('help')).toBe('echo <words>: say the words back\nhelp: list the commands');
  });

  it('shows the usage line for bad arguments, and passes other errors on', () => {
    const c = echo();
    c.register('kr', { usage: '<amount>', help: 'money', run: a => String(parseKr(a[0])) });
    c.register('boom', { help: 'breaks', run: () => { throw new Error('broken'); } });
    expect(c.run('kr lots')).toBe('Usage: kr <amount>');
    expect(c.run('kr')).toBe('Usage: kr <amount>');
    expect(c.run('kr -50')).toBe('-50');
    expect(() => c.run('boom')).toThrow('broken');
  });

  it('refuses a name twice, or a name that is not a lower-case word', () => {
    const c = echo();
    expect(() => c.register('echo', { help: '', run: () => '' })).toThrow();
    expect(() => c.register('Tp torget', { help: '', run: () => '' })).toThrow();
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
