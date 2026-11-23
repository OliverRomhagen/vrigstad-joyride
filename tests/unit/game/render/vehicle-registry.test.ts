import { describe, expect, it } from 'vitest';
import { CIVILIAN_CAR_TYPES, VEHICLES } from '../../../../src/game/render/vehicle-registry';

describe('CIVILIAN_CAR_TYPES', () => {
  it('gives each civilian model its archetype', () => {
    expect(CIVILIAN_CAR_TYPES.get('volvo240')).toBe('volvo');
    expect(CIVILIAN_CAR_TYPES.get('xc70')).toBe('saab');
    expect(CIVILIAN_CAR_TYPES.get('duett-epa')).toBe('epa');
  });

  it('has the tractor, which has no model of its own', () => {
    expect(CIVILIAN_CAR_TYPES.get('traktor')).toBe('traktor');
  });

  it('leaves out police cars and unknown ids', () => {
    for (const v of VEHICLES.filter(v => v.police)) expect(CIVILIAN_CAR_TYPES.has(v.id)).toBe(false);
    expect(CIVILIAN_CAR_TYPES.get('trabant')).toBeUndefined();
  });
});
