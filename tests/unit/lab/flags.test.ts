import { describe, expect, it } from 'vitest';
import { Commands } from '../../../src/game/commands';
import { LAB_EXPERIMENTS, LabFlags, parseLabFlags } from '../../../src/lab/flags';

describe('parseLabFlags', () => {
  it('is empty without a lab parameter', () => {
    expect(parseLabFlags('')).toEqual([]);
    expect(parseLabFlags('?vehicle=volvo240')).toEqual([]);
  });

  it('reads a comma-separated list, ignoring case, spaces and repeats', () => {
    expect(parseLabFlags('?lab=hello')).toEqual(['hello']);
    expect(parseLabFlags('?lab=%20Hello%20,hello')).toEqual(['hello']);
  });

  it('reads repeated lab parameters', () => {
    expect(parseLabFlags('?lab=nope&lab=hello')).toEqual(['hello']);
  });

  it('ignores ids that are not experiments', () => {
    expect(parseLabFlags('?lab=nope,,')).toEqual([]);
  });
});

describe('LabFlags', () => {
  it('has everything off by default', () => {
    const flags = new LabFlags();
    for (const e of LAB_EXPERIMENTS) expect(flags.on(e.id)).toBe(false);
    expect(flags.list()).toEqual([]);
  });

  it('switches on what the query string names', () => {
    const flags = LabFlags.fromSearch('?lab=hello');
    expect(flags.on('hello')).toBe(true);
    expect(flags.list()).toEqual(['hello']);
  });
});

describe('LAB_EXPERIMENTS', () => {
  it('has unique lower-case ids, each with a name and a cost', () => {
    const ids = LAB_EXPERIMENTS.map(e => e.id);
    expect(new Set(ids).size).toBe(ids.length);
    for (const e of LAB_EXPERIMENTS) {
      expect(e.id).toMatch(/^[a-z][a-z0-9-]*$/);
      expect(e.name).not.toBe('');
      expect(e.cost).not.toBe('');
    }
  });
});

describe('lab command', () => {
  const setUp = (search: string) => {
    const commands = new Commands();
    const loc = { search };
    LabFlags.fromSearch(search).registerCommands(commands, loc);
    return { commands, loc };
  };

  it('lists every experiment with whether it is on', () => {
    const lines = setUp('?lab=toon').commands.run('lab').split('\n');
    expect(lines).toHaveLength(LAB_EXPERIMENTS.length);
    expect(lines.find(l => l.includes('toon:'))).toMatch(/^on /);
    expect(lines.find(l => l.includes('hello:'))).toMatch(/^off/);
  });

  it('switches one experiment, keeping the others and the other parameters, and turns the last one off', () => {
    const { commands, loc } = setUp('?dev&lab=toon');
    expect(commands.run('lab hello')).toBe('Reloading with hello on …');
    expect(loc.search).toBe('?dev&lab=hello,toon');
    expect(setUp('?dev&lab=toon').commands.run('lab toon')).toBe('Reloading with toon off …');
    const off = setUp('?dev&lab=toon');
    off.commands.run('lab TOON off');
    expect(off.loc.search).toBe('?dev');
  });

  it('leaves the page alone when the experiment is already as asked', () => {
    const { commands, loc } = setUp('?lab=toon');
    expect(commands.run('lab toon on')).toBe('toon is already on.');
    expect(loc.search).toBe('?lab=toon');
  });
});
