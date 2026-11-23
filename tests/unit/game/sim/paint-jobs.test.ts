import { describe, expect, it } from 'vitest';
import { WORKSHOP_PAINTS, workshopPaintName } from '../../../../src/game/sim/paint-jobs';
import { VEHICLE_SPECS } from '../../../../src/game/sim/vehicle-spec';

describe('paint jobs', () => {
  it("keeps Plåt-Pelle's special paints out of every car type's colours, so only his workshop has them", () => {
    const stock = new Set(Object.values(VEHICLE_SPECS).flatMap(s => s.cols));
    for (const { paint } of WORKSHOP_PAINTS) expect(stock.has(paint)).toBe(false);
  });

  it('names his paints, and no other', () => {
    expect(workshopPaintName(WORKSHOP_PAINTS[0]!.paint)).toBe('Guldmetallic');
    expect(workshopPaintName(VEHICLE_SPECS.volvo.cols[0]!)).toBeUndefined();
  });
});
