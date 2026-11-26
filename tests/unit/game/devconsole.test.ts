import { describe, expect, it } from 'vitest';
import { Commands } from '../../../src/game/commands';
import { registerUrlCommand, withParams } from '../../../src/game/devconsole';

describe('withParams', () => {
  it('sets, replaces and removes parameters, keeping the rest and their commas', () => {
    expect(withParams('?dev&lab=toon&at=1,2', ['lab=toon,cockpit', 'grain=on'])).toBe(
      '?dev&lab=toon,cockpit&at=1,2&grain=on',
    );
    expect(withParams('?grain=on', ['grain='])).toBe('');
  });

  it('refuses a word that is not key=value', () => {
    expect(() => withParams('', ['toon'])).toThrow('not key=value: toon');
    expect(() => withParams('', ['=on'])).toThrow();
  });
});

describe('url command', () => {
  it('lists the parameters alone, and with words sets them on the location', () => {
    const commands = new Commands();
    const loc = { search: '?lab=toon%2Ccockpit' };
    registerUrlCommand(commands, loc);
    expect(commands.run('url')).toBe('?lab=toon,cockpit');
    expect(commands.run('url grain=on')).toBe('Reloading with ?lab=toon,cockpit&grain=on …');
    expect(loc.search).toBe('?lab=toon,cockpit&grain=on');
  });
});
