import { describe, expect, it } from 'vitest';
import { LAB_EXPERIMENTS, LabFlags, parseLabFlags, withLabFlag, withParam } from '../../../src/lab/flags';

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

describe('withLabFlag', () => {
  it('adds the parameter to a query string without one', () => {
    expect(withLabFlag('', 'cockpit', true)).toBe('?lab=cockpit');
    expect(withLabFlag('?dev', 'cockpit', true)).toBe('?dev&lab=cockpit');
    expect(withLabFlag('?lab=', 'cockpit', true)).toBe('?lab=cockpit');
  });

  it('adds a second id, in the order of LAB_EXPERIMENTS', () => {
    expect(withLabFlag('?lab=cockpit', 'hello', true)).toBe('?lab=hello,cockpit');
    expect(withLabFlag('?lab=hello', 'hello', true)).toBe('?lab=hello');
  });

  it('removes one id and keeps the rest', () => {
    expect(withLabFlag('?lab=hello,cockpit', 'hello', false)).toBe('?lab=cockpit');
    expect(withLabFlag('?lab=cockpit', 'hello', false)).toBe('?lab=cockpit');
  });

  it('drops the parameter with the last id', () => {
    expect(withLabFlag('?lab=cockpit', 'cockpit', false)).toBe('');
    expect(withLabFlag('?dev&lab=cockpit&time=16', 'cockpit', false)).toBe('?dev&time=16');
  });

  it('leaves the other parameters exactly as written, where they were', () => {
    const search = '?dev&at=12.5,-3,1.2&lab=hello&tune=driving.grip:8,vehicle.volvo.top-speed:45&wind=250%2C7';
    expect(withLabFlag(search, 'cockpit', true)).toBe(search.replace('lab=hello', 'lab=hello,cockpit'));
    expect(withLabFlag(search, 'hello', false)).toBe(search.replace('&lab=hello', ''));
    expect(withLabFlag('?label=x&lab=cockpit', 'cockpit', false)).toBe('?label=x');
  });

  it('gathers repeated lab parameters into the first, without the ids that are not experiments', () => {
    expect(withLabFlag('?lab=nope,cockpit&dev&lab=hello', 'cockpit', true)).toBe('?lab=hello,cockpit&dev');
    expect(withLabFlag('?lab=nope&dev', 'hello', false)).toBe('?dev');
  });

  it('reads back as the flags it wrote', () => {
    expect(parseLabFlags(withLabFlag('?dev', 'cockpit', true))).toEqual(['cockpit']);
  });
});

describe('withParam', () => {
  it('sets a parameter where it was, adds a new one last, and takes one out with null', () => {
    expect(withParam('?dev&at=1,2&time=16', 'at', '3,4')).toBe('?dev&at=3,4&time=16');
    expect(withParam('?dev', 'at', '3,4')).toBe('?dev&at=3,4');
    expect(withParam('', 'at', '3,4')).toBe('?at=3,4');
    expect(withParam('?dev&at=1,2', 'at', null)).toBe('?dev');
    expect(withParam('?at=1,2', 'at', null)).toBe('');
  });

  it('leaves a parameter whose name only starts the same', () => {
    expect(withParam('?attic=1&at=1,2', 'at', '3,4')).toBe('?attic=1&at=3,4');
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
