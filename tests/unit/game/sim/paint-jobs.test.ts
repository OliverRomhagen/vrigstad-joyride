import { describe, expect, it } from 'vitest';
import { WORKSHOP_PAINTS } from '../../../../src/game/sim/paint-jobs';
import { VEHICLE_SPECS } from '../../../../src/game/sim/vehicle-spec';
import { FRESH_COLOURS, WRECK_COLOURS } from '../../../../src/game/skroten-yard';

describe('paint jobs', () => {
  it("keeps Plåt-Pelle's special paints out of every car type's colours and his lot's, so only his workshop has them", () => {
    const stock = new Set([...Object.values(VEHICLE_SPECS).flatMap(s => s.cols), ...FRESH_COLOURS, ...WRECK_COLOURS]);
    for (const { paint } of WORKSHOP_PAINTS) expect(stock.has(paint)).toBe(false);
  });
});
