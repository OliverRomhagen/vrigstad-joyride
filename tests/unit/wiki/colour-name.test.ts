import { describe, expect, it } from 'vitest';
import { VEHICLE_SPECS } from '../../../src/game/sim/vehicle-spec';
import { colourName } from '../../../wiki/src/lib/colour-name';

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
