import { describe, expect, it } from 'vitest';
import { VEHICLE_SPECS } from '../../../src/game/sim/vehicle-spec';
import { colourName } from '../../../wiki/src/lib/colour-name';
import { whereabouts } from '../../../wiki/src/lib/whereabouts';

describe('colourName', () => {
  it('names a colour as anyone would', () => {
    expect(colourName('#27406b')).toBe('dark blue');
    expect(colourName('#c8372d')).toBe('red');
    expect(colourName('#2f5a41')).toBe('dark green');
    expect(colourName('#e8a020')).toBe('orange');
    expect(colourName('#c9bd9c')).toBe('beige');
    expect(colourName('#e6e4dc')).toBe('white');
    expect(colourName('#8a8f93')).toBe('grey');
    expect(colourName('#1d1d1f')).toBe('black');
    expect(colourName('#808080')).toBe('grey'); // no hue at all
  });

  it("has a name for every paint the game's cars come in", () => {
    for (const spec of Object.values(VEHICLE_SPECS))
      for (const paint of spec.cols) expect(colourName(paint), paint).toMatch(/^[a-z]+( [a-z]+)?$/);
  });
});

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
