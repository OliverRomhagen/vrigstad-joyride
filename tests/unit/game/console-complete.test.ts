import { describe, expect, it } from 'vitest';
import { Commands } from '../../../src/game/commands';
import { tabComplete } from '../../../src/game/console-complete';

describe('tabComplete', () => {
  it('fills in the only option and adds a space', () => {
    expect(tabComplete('he', ['help'])).toEqual({ line: 'help ', choices: [] });
    expect(tabComplete('go sk', ['skroten'])).toEqual({ line: 'go skroten ', choices: [] });
  });

  it('adds no space after a key=, so its value can follow', () => {
    expect(tabComplete('url cloudSe', ['cloudSeed='])).toEqual({ line: 'url cloudSeed=', choices: [] });
  });

  it('fills in what several options share, and lists them', () => {
    expect(tabComplete('go s', ['skroten', 'Slättsjön', 'skolan'])).toEqual({
      line: 'go s',
      choices: ['skroten', 'Slättsjön', 'skolan'],
    });
    expect(tabComplete('go s', ['skroten', 'skolan'])).toEqual({ line: 'go sk', choices: ['skroten', 'skolan'] });
  });

  it('spells the shared start as the options do, ignoring the case typed', () => {
    expect(tabComplete('go sl', ['Slättsjön', 'Slätta'])).toEqual({
      line: 'go Slätt',
      choices: ['Slättsjön', 'Slätta'],
    });
  });

  it('fills in nothing when the options spell their shared start differently, whatever their order', () => {
    expect(tabComplete('go s', ['slätta', 'Slättsjön']).line).toBe('go s');
    expect(tabComplete('go s', ['Slättsjön', 'slätta']).line).toBe('go s');
  });

  it('starts a new word after a space, and leaves the line alone with nothing to offer', () => {
    expect(tabComplete('go ', ['torget'])).toEqual({ line: 'go torget ', choices: [] });
    expect(tabComplete('fly', [])).toEqual({ line: 'fly', choices: [] });
  });

  it('works on what Commands.complete offers', () => {
    const c = new Commands();
    c.register('go', { help: 'go', complete: () => ['torget', 'skroten'], run: () => '' });
    expect(tabComplete('g', c.complete('g')).line).toBe('go ');
    expect(tabComplete('go t', c.complete('go t')).line).toBe('go torget ');
  });
});

describe('Commands.usageFor', () => {
  const c = new Commands({ allowed: access => access === 'player' });
  c.register('go', { usage: '<place>', help: 'go', aliases: ['tp'], access: 'player', run: () => '' });
  c.register('god', { help: 'god mode', run: () => '' });

  it('gives the usage line of the command the line starts with, by any of its names', () => {
    expect(c.usageFor('go')).toBe('go <place>');
    expect(c.usageFor('  TP tor')).toBe('go <place>');
    expect(c.usageFor('help ')).toBe('help [command]');
  });

  it('gives nothing for an empty line, an unknown command or one that is not allowed', () => {
    expect(c.usageFor('')).toBeUndefined();
    expect(c.usageFor('fly')).toBeUndefined();
    expect(c.usageFor('god')).toBeUndefined();
  });
});
