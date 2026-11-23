import { describe, expect, it } from 'vitest';
import { RoadClass, WaterwayKind } from '../../../src/world/data';
import { Heightfield } from '../../../src/world/heightfield';
import { layoutShore, STRETCH_M } from '../../../src/world/shore';
import { WaterBodies } from '../../../src/world/water-shapes';
import { makeValley, square } from './fixture';

const RIVER = { k: WaterwayKind.RIVER, p: [-180, 0, 180, 0] };
const LAKE = [square(-150, -180, 100)];
const lay = (overrides = {}) => {
  const world = makeValley({ ww: [RIVER], w: [LAKE], ...overrides });
  const base = new Heightfield(world);
  const bodies = new WaterBodies(world, base);
  return { bodies, shore: layoutShore(bodies, base) };
};

describe('layoutShore', () => {
  const { bodies, shore } = lay();

  it('walks both banks of the river and the lake shore past the world edge, a stretch every few metres', () => {
    const river = shore.stretches.filter(s => !s.lake);
    const lake = shore.stretches.filter(s => s.lake);
    expect(river.length).toBeGreaterThan((2 * 340) / STRETCH_M);
    // the lake's west side is not on the world's edge, its south side is (z = -180 is inside, so all four count)
    expect(lake.length).toBeGreaterThanOrEqual((4 * 100) / STRETCH_M - 4);
  });

  it('puts each river stretch on the waterline, facing onto the land', () => {
    const c = bodies.courses[0];
    for (const s of shore.stretches.filter(st => !st.lake)) {
      expect(Math.abs(Math.abs(s.z) - c.half[0])).toBeLessThan(0.5);
      expect(Math.sign(s.nz)).toBe(Math.sign(s.z));
    }
  });

  it('is the same every time, and places reeds only on reedy stretches and stones on stony ones', () => {
    expect(lay().shore).toEqual(shore);
    expect(shore.reeds.length % 4).toBe(0);
    expect(shore.stones.length % 4).toBe(0);
    const reedy = shore.stretches.filter(s => s.type === 'reedy').length;
    expect(shore.reeds.length / 4).toBeGreaterThanOrEqual(reedy);
    expect(shore.reeds.length / 4).toBeLessThanOrEqual(reedy * 4);
  });

  it('never leaves a single stretch of one type between two of another', () => {
    const run = shore.stretches.filter(s => s.body === shore.stretches[0].body);
    for (let i = 1; i < run.length - 1; i++)
      if (run[i - 1].type === run[i + 1].type) expect(run[i].type).toBe(run[i - 1].type);
  });

  it('makes the bank stony where a road runs beside the water', () => {
    const road = { c: RoadClass.SECONDARY, n: 'Strandvägen', p: [-100, 9, 100, 9] };
    const { shore: withRoad } = lay({ r: [road] });
    const north = withRoad.stretches.filter(s => !s.lake && s.z > 0 && Math.abs(s.x) < 80);
    expect(north.length).toBeGreaterThan(0);
    for (const s of north) expect(s.type).toBe('stony');
  });

  it('keeps every reed and stone out of where it is told to, such as under a bridge deck, and moves no other', () => {
    const world = makeValley({ ww: [RIVER], w: [LAKE] });
    const base = new Heightfield(world);
    const under = (x: number) => Math.abs(x) < 30;
    const kept = layoutShore(new WaterBodies(world, base), base, x => under(x));
    const pick = (props: number[], keep: (x: number) => boolean) =>
      Array.from({ length: props.length / 4 }, (_, i) => props.slice(i * 4, i * 4 + 4)).filter(p => keep(p[0]));
    for (const k of ['reeds', 'stones'] as const) {
      expect(pick(kept[k], under)).toEqual([]);
      expect(pick(kept[k], () => true)).toEqual(pick(shore[k], x => !under(x)));
    }
  });
});
