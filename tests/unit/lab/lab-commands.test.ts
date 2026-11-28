import { describe, expect, it } from 'vitest';
import { Commands } from '../../../src/game/commands';
import { LAB_EXPERIMENTS, LabFlags } from '../../../src/lab/flags';
import { registerLabCommands } from '../../../src/lab/lab-commands';

/** The console over a page that was loaded with `search`; `reloads` holds each query string it was loaded again with. */
function console_(search = '') {
  const reloads: string[] = [];
  const c = new Commands();
  registerLabCommands(c, {
    lab: LabFlags.fromSearch(search),
    search: () => search,
    at: () => '12.5,-3.0,0.60,0.34',
    reload: s => reloads.push(s),
  });
  return { c, reloads };
}

describe('lab commands', () => {
  it('lists every experiment with its state, name and cost', () => {
    const { c, reloads } = console_('?lab=hello');
    const lines = c.run('lab').split('\n');
    expect(lines).toHaveLength(LAB_EXPERIMENTS.length);
    expect(lines[0]).toBe('hello [on]: Hello lab. Cost: Nothing: logs one line, as the smallest example of a gate');
    expect(lines.find(l => l.startsWith('toon '))).toMatch(/^toon \[off\]: Cel-shaded style\. Cost: /);
    expect(reloads).toEqual([]);
  });

  it('switches one on or off by loading the page again where you stand, with the other parameters kept', () => {
    const { c, reloads } = console_('?dev&lab=hello&at=1,2');
    expect(c.run('lab on toon')).toBe('toon is on. Loading the page again…');
    expect(c.run('lab OFF Hello')).toBe('hello is off. Loading the page again…');
    expect(reloads).toEqual(['?dev&lab=hello,toon&at=12.5,-3.0,0.60,0.34', '?dev&at=12.5,-3.0,0.60,0.34']);
  });

  it('adds where you stand to an address without it', () => {
    const { c, reloads } = console_('?dev');
    c.run('lab on toon');
    expect(reloads).toEqual(['?dev&lab=toon&at=12.5,-3.0,0.60,0.34']);
  });

  it('leaves the page alone when the experiment is already there', () => {
    const { c, reloads } = console_('?lab=hello');
    expect(c.run('lab on hello')).toBe('hello is already on.');
    expect(c.run('lab off toon')).toBe('toon is already off.');
    expect(reloads).toEqual([]);
  });

  it('names the known ids for one it does not know, and shows the usage for a missing id or another word', () => {
    const { c, reloads } = console_();
    const known = LAB_EXPERIMENTS.map(e => e.id)
      .sort()
      .join(', ');
    expect(c.run('lab on warp')).toBe(`No experiment called warp. Pick one of: ${known}. Usage: lab on <experiment>`);
    expect(c.run('lab on')).toBe('experiment is missing. Usage: lab on <experiment>');
    expect(c.run('lab toon')).toBe('No subcommand called toon. Usage: lab [on|off <experiment>]');
    expect(reloads).toEqual([]);
  });

  it('completes on, off and the ids with Tab', () => {
    const { c } = console_();
    expect(c.complete('lab ')).toEqual(['off', 'on']);
    expect(c.complete('lab on t')).toEqual(['toon']);
    expect(c.complete('lab off ')).toEqual(LAB_EXPERIMENTS.map(e => e.id).sort());
  });

  it('explains itself', () => {
    const { c } = console_();
    expect(c.run('help lab')).toContain('lab on <experiment>: switch an experiment on, and load the page again');
    expect(c.usageFor('lab on ')).toBe('lab on <experiment>');
  });
});
