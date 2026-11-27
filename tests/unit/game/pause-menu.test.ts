import { describe, expect, it } from 'vitest';
import { readSettings } from '../../../src/game/pause-menu';

describe('readSettings', () => {
  it('gives the defaults when nothing was saved, or what was saved is broken', () => {
    const defaults = { lookSpeed: 1, invertY: false };
    expect(readSettings(null)).toEqual(defaults);
    expect(readSettings('{not json')).toEqual(defaults);
    expect(readSettings('null')).toEqual(defaults);
    expect(readSettings('{"lookSpeed":"fast","invertY":"yes"}')).toEqual(defaults);
    for (const v of ['null', '""', 'false', '[]', '"2"']) expect(readSettings(`{"lookSpeed":${v}}`)).toEqual(defaults);
  });

  it('keeps saved values, with the look speed held inside its range', () => {
    expect(readSettings('{"lookSpeed":1.5,"invertY":true}')).toEqual({ lookSpeed: 1.5, invertY: true });
    expect(readSettings('{"lookSpeed":99}').lookSpeed).toBe(3);
    expect(readSettings('{"lookSpeed":0}').lookSpeed).toBe(0.25);
  });
});
