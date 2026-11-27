import { describe, expect, it } from 'vitest';
import { whereabouts } from '../../../wiki/src/lib/whereabouts';

describe('whereabouts', () => {
  it('says how far from Torget a place is, and which way: x is east, z is south', () => {
    expect(whereabouts([-13, 28])).toBe('On Torget');
    expect(whereabouts([0, -300])).toBe('300 m north of Torget');
    expect(whereabouts([400, 0])).toBe('400 m east of Torget');
    expect(whereabouts([-200, 200])).toBe('280 m south-west of Torget');
    expect(whereabouts([-433, -835])).toBe('940 m north-west of Torget'); // Slättsjön
    expect(whereabouts([0, 1040])).toBe('1.0 km south of Torget');
    expect(whereabouts([996, 0])).toBe('1.0 km east of Torget'); // not "1000 m"
  });
});
