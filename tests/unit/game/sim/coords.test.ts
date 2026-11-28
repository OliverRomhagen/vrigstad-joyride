import { describe, expect, it } from 'vitest';
import { Commands } from '../../../../src/game/commands';
import { atParam, heading, nearestStreet, registerCoordsCommands, spotLine } from '../../../../src/game/sim/coords';
import { ROAD_WIDTH_M, RoadClass } from '../../../../src/world/data';
import { RoadNetwork } from '../../../../src/world/roads';
import { makeWorld } from '../../world/fixture';

describe('atParam', () => {
  it('writes x and z to a decimetre and the camera to hundredths, as ?at= reads them', () => {
    expect(atParam({ x: 12.345, z: -45.66, yaw: 1.2345, pitch: 0.3 })).toBe('12.3,-45.7,1.23,0.30');
  });
});

describe('heading', () => {
  it('faces north at a yaw of 0 and east at a quarter turn, in degrees clockwise', () => {
    expect(heading(0)).toBe('N 0°');
    expect(heading(Math.PI / 2)).toBe('E 90°');
    expect(heading(Math.PI)).toBe('S 180°');
    expect(heading(Math.PI / 4)).toBe('NE 45°');
  });

  it('wraps a yaw past a turn either way', () => {
    expect(heading(-Math.PI / 2)).toBe('W 270°');
    expect(heading(2 * Math.PI + 0.001)).toBe('N 0°');
    expect(heading(-0.01)).toBe('N 359°');
  });
});

describe('spotLine', () => {
  it('shows x, z and the way you face', () => {
    expect(spotLine({ x: 3, z: -4.25, yaw: Math.PI / 2, pitch: 0.4 })).toBe('x 3.0  z -4.3  E 90°');
  });
});

describe('nearestStreet', () => {
  const HALF_M = ROAD_WIDTH_M[RoadClass.STREET] / 2;
  // a named street along z = 0 and an unnamed path along x = 30
  const roads = new RoadNetwork(
    makeWorld({
      r: [
        { c: RoadClass.STREET, n: 'Storgatan', p: [-40, 0, 40, 0] },
        { c: RoadClass.PATH, n: '', p: [30, -40, 30, 40] },
      ],
    }),
    { heightAt: () => 0 },
  );

  it('names the street within 25 m of its edge', () => {
    expect(nearestStreet(roads, 0, 0)).toBe('Storgatan');
    expect(nearestStreet(roads, 0, HALF_M + 24)).toBe('Storgatan');
  });

  it('names none farther away, nor a road without a name', () => {
    expect(nearestStreet(roads, 0, HALF_M + 26)).toBe('');
    expect(nearestStreet(roads, 31, 35)).toBe('');
  });

  it('finds a street in a lookup cell next to yours, which nearestRoad does not look in', () => {
    // a street along z = -70 is filed in the cells from z = -100 to -50; you stand 20 m from its edge, in the cell south of those
    const far = new RoadNetwork(makeWorld({ r: [{ c: RoadClass.STREET, n: 'Kvarngatan', p: [-40, -70, 40, -70] }] }), {
      heightAt: () => 0,
    });
    const z = -70 + HALF_M + 20;
    expect(far.nearestRoad(0, z).ri).toBe(-1);
    expect(nearestStreet(far, 0, z)).toBe('Kvarngatan');
  });
});

describe('the coords command', () => {
  const setup = () => {
    const view = { shown: false, link: () => 'https://example.test/?dev&at=1.0,2.0,0.00,0.40' };
    const c = new Commands();
    registerCoordsCommands(c, view);
    return { c, view };
  };

  it('gives the link on its own, and leaves the line as it was', () => {
    const { c, view } = setup();
    expect(c.run('coords')).toBe('https://example.test/?dev&at=1.0,2.0,0.00,0.40');
    expect(view.shown).toBe(false);
  });

  it('shows and hides the line', () => {
    const { c, view } = setup();
    expect(c.run('coords on')).toMatch(/^Coordinates on/);
    expect(view.shown).toBe(true);
    expect(c.run('coords off')).toBe('Coordinates off.');
    expect(view.shown).toBe(false);
    expect(c.run('coords maybe')).toBe('line is on or off. Usage: coords [line]');
  });
});
