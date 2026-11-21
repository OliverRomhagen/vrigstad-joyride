import { describe, expect, it } from 'vitest';
import { BuildingIndex } from '../../../../src/world/buildings';
import {
  FurnitureCode,
  type FurniturePoint,
  LandUse,
  ParkingKind,
  ParkingOrientation,
  ROAD_WIDTH_M,
  type Road,
  RoadClass,
  RoadUse,
  StreetParking,
  Surface,
  type WorldData,
} from '../../../../src/world/data';
import { FURNITURE } from '../../../../src/world/furniture/definitions';
import type { FurnitureOverride } from '../../../../src/world/furniture/overrides';
import {
  type FurnitureInput,
  lampEmitters,
  placeFurniture,
  TORGET_TARGETS,
} from '../../../../src/world/furniture/placement';
import { Heightfield } from '../../../../src/world/heightfield';
import { segmentDistance } from '../../../../src/world/polygon';
import { RoadNetwork } from '../../../../src/world/roads';
import { sidewalkCentreM } from '../../../../src/world/streetscape';
import type { Profile, SideSpec, StreetSides } from '../../../../src/world/streetscape-rules';
import { Water } from '../../../../src/world/water';
import { makeWorld, square } from '../fixture';

// A flat 1000 m world. Roads are hand-placed so every expected position can be worked out.
const side = (sidewalk: SideSpec['sidewalk'] = 'absent', widthM = 0): SideSpec => ({
  sidewalk,
  widthM,
  surface: Surface.UNKNOWN,
  curbM: 0,
  vergeM: 0,
  parking: StreetParking.UNKNOWN,
  orientation: ParkingOrientation.UNKNOWN,
  source: 'inferred',
  separate: null,
});
const sides = (profile: Profile, left = side(), right = side()): StreetSides => ({
  profile,
  left,
  right,
  streetTrees: false,
});
let nextId = 1;
const road = (c: RoadClass, p: number[], extra: Partial<Road> = {}): Road => ({ c, n: '', p, i: nextId++, ...extra });

interface Fixture {
  world?: Partial<WorldData>;
  profiles?: StreetSides[];
  trees?: number[];
  extra?: Partial<FurnitureInput>;
  elev?: number[];
}
function place({ world = {}, profiles, trees = [], extra = {}, elev }: Fixture) {
  const data = makeWorld({ size: 1000, ...(elev ? { n: 3, elev } : {}), ...world });
  const heightfield = new Heightfield(data);
  const roads = new RoadNetwork(data, heightfield);
  const buildings = new BuildingIndex(data);
  const water = new Water(data, roads);
  const street = {
    sides: profiles ?? data.r.map(() => sides('residential')),
    openings: [],
    lots: [],
  };
  return {
    data,
    roads,
    ...placeFurniture({ data, roads, heightfield, buildings, water, trees, street, ...extra }),
  };
}
const kinds = <T extends { kind: string }>(ps: T[], k: string) => ps.filter(p => p.kind === k);
const facing = (rot: number) => [Math.sin(rot), Math.cos(rot)];

// a primary road along z = 0, west to east
const MAIN = () => road(RoadClass.PRIMARY, [-300, 0, 300, 0], { i: 1000 });
// Torget: a 30 m square pedestrian area, written as two pieces like the real one
const TORGET = (x = 100, z = 100) => [
  road(RoadClass.SERVICE, [x, z, x + 30, z, x + 30, z + 30], { n: 'Torget Vrigstad', i: 2000, j: 0 }),
  road(RoadClass.SERVICE, [x + 30, z + 30, x, z + 30, x, z], { n: 'Torget Vrigstad', i: 2000, j: 1 }),
];

describe('placeFurniture: lamps along roads', () => {
  it('lines a main road on one side, at its spacing, arms pointing across the road', () => {
    const { placements } = place({ world: { r: [MAIN()] }, profiles: [sides('residential')] });
    const lamps = kinds(placements, 'street-lamp');
    expect(lamps.length).toBeGreaterThan(12);
    expect(lamps.every(l => l.source === 'procedural')).toBe(true);
    const zs = new Set(lamps.map(l => Math.sign(l.z)));
    expect(zs.size).toBe(1); // one side only, never flipping
    const offset = Math.abs(lamps[0].z);
    expect(offset).toBeCloseTo(ROAD_WIDTH_M[RoadClass.PRIMARY] / 2 + 1.5, 6);
    const xs = lamps.map(l => l.x).sort((a, b) => a - b);
    for (let i = 1; i < xs.length; i++) {
      expect(xs[i] - xs[i - 1]).toBeGreaterThanOrEqual(35 - 2 * 4 - 1e-9);
      expect(xs[i] - xs[i - 1]).toBeLessThanOrEqual(35 + 2 * 4 + 1e-9);
    }
    for (const l of lamps) {
      const [fx, fz] = facing(l.rotationY);
      expect(Math.abs(fx)).toBeLessThan(1e-9);
      expect(Math.sign(fz)).toBe(-Math.sign(l.z)); // the arm reaches over the road
    }
  });

  it('puts lamps on the side with more houses, or on the only side with a sidewalk', () => {
    const north = [square(-50, -30, 10), square(50, -30, 10), square(120, -30, 10)]; // centres 25 m north, within 30 m
    const byHouses = place({
      world: { r: [MAIN()], b: north.map(p => ({ p, h: 5, k: 0 })) },
      profiles: [sides('residential')],
    });
    expect(kinds(byHouses.placements, 'street-lamp').every(l => l.z < 0)).toBe(true);
    const bySidewalk = place({
      world: { r: [MAIN()], b: north.map(p => ({ p, h: 5, k: 0 })) },
      profiles: [sides('residential', side(), side('present', 2))], // right of an eastbound way is south
    });
    expect(kinds(bySidewalk.placements, 'street-lamp').every(l => l.z > 0)).toBe(true);
  });

  it('stands a lamp past the sidewalk when the verge is too narrow for it, and in the verge when it is wide', () => {
    const at = (vergeM: number) => {
      const right = { ...side('present', 1.5), vergeM };
      const { placements } = place({ world: { r: [MAIN()] }, profiles: [sides('residential', side(), right)] });
      return { z: kinds(placements, 'street-lamp')[0].z, centre: sidewalkCentreM(right, RoadClass.PRIMARY)! };
    };
    const narrow = at(0.8);
    expect(narrow.z).toBeCloseTo(narrow.centre + 0.75 + 0.3, 6);
    const wide = at(1.6);
    expect(wide.z).toBeCloseTo(wide.centre - 0.75 - 0.8, 6);
  });

  it('keeps lamps on the streets round Torget, which count as the centre', () => {
    const { placements } = place({
      world: { r: [...TORGET(100, 100), road(RoadClass.PRIMARY, [80, 90, 150, 90], { i: 4000 })] },
      profiles: [sides('centre'), sides('centre'), sides('residential')],
    });
    expect(placements.some(p => p.id.startsWith('gen:street-lamp:4000'))).toBe(true);
  });

  it('staggers lamps on both sides of a primary road in the centre', () => {
    const { placements } = place({ world: { r: [MAIN()] }, profiles: [sides('centre')] });
    const lamps = kinds(placements, 'street-lamp');
    expect(lamps.some(l => l.z > 0) && lamps.some(l => l.z < 0)).toBe(true);
  });

  it('follows context: outskirts get nothing, residential streets lamps only, short ones none', () => {
    const outer = place({ world: { r: [MAIN()] }, profiles: [sides('outskirts')] });
    expect(outer.placements).toEqual([]);
    const res = place({ world: { r: [road(RoadClass.STREET, [-200, 0, 200, 0])] } });
    expect(kinds(res.placements, 'street-lamp').length).toBeGreaterThan(0);
    expect(res.placements.every(p => p.kind === 'street-lamp' && p.modelId === 'lamp-arm-short')).toBe(true);
    const short = place({ world: { r: [road(RoadClass.STREET, [0, 0, 50, 0])] } });
    expect(short.placements).toEqual([]);
  });

  it('lights lit=yes roads and footways, and leaves lit=no roads dark', () => {
    const lit = place({
      world: {
        r: [
          road(RoadClass.PATH, [-200, 0, 200, 0], { lt: 1 }),
          road(RoadClass.STREET, [-200, 300, 200, 300], { lt: 2 }),
        ],
      },
    });
    const lamps = kinds(lit.placements, 'street-lamp');
    expect(lamps.length).toBeGreaterThan(10);
    expect(lamps.every(l => Math.abs(l.z) < 10)).toBe(true);
    const outerLit = place({
      world: { r: [road(RoadClass.STREET, [-200, 0, 200, 0], { lt: 1 })] },
      profiles: [sides('outskirts')],
    });
    expect(kinds(outerLit.placements, 'street-lamp').length).toBeGreaterThan(0);
  });

  it('keeps every lamp clear of other carriageways at a junction', () => {
    const cross = road(RoadClass.STREET, [0, -200, 0, 200]);
    const { placements, roads } = place({
      world: { r: [MAIN(), cross] },
      profiles: [sides('residential'), sides('residential')],
    });
    for (const l of kinds(placements, 'street-lamp')) {
      for (const [ri, other] of roads.lines.entries()) {
        const d =
          Math.min(
            ...other.p.slice(1).map((b, i) => segmentDistance(l.x, l.z, other.p[i][0], other.p[i][1], b[0], b[1])),
          ) -
          ROAD_WIDTH_M[other.c] / 2;
        expect(d, `lamp ${l.id} to road ${ri}`).toBeGreaterThanOrEqual(
          FURNITURE['street-lamp'].carriagewayClearanceM - 1e-9,
        );
      }
    }
  });
});

describe('placeFurniture: sources', () => {
  const lamp = (i: number, x: number, z: number): FurniturePoint => ({ i, k: FurnitureCode.STREET_LAMP, x, z });

  it('draws mapped objects exactly where they are mapped, and a bench facing its direction', () => {
    const fu: FurniturePoint[] = [{ i: 7, k: FurnitureCode.BENCH, x: 40.3, z: 60.1, d: 90 }, lamp(8, -40, 20)];
    const { placements } = place({ world: { fu } });
    expect(placements.map(p => [p.id, p.x, p.z, p.source])).toEqual([
      ['osm:n8', -40, 20, 'osm'],
      ['osm:n7', 40.3, 60.1, 'osm'],
    ]);
    const [fx, fz] = facing(placements.find(p => p.id === 'osm:n7')!.rotationY);
    expect(fx).toBeCloseTo(1, 9); // 90° from north is east, +x
    expect(fz).toBeCloseTo(0, 9);
  });

  it('never duplicates a mapped object, and leaves a road with two mapped lamps to them', () => {
    const generated = place({ world: { r: [MAIN()] }, profiles: [sides('residential')] });
    const first = kinds(generated.placements, 'street-lamp')[0];
    const near = place({
      world: { r: [MAIN()], fu: [lamp(1, first.x + 3, first.z)] },
      profiles: [sides('residential')],
    });
    expect(near.placements.some(p => p.id === first.id)).toBe(false);
    expect(near.rejected.duplicate).toBeGreaterThan(0);
    const two = place({
      world: { r: [MAIN()], fu: [lamp(1, -200, 8), lamp(2, 100, 8)] },
      profiles: [sides('residential')],
    });
    expect(kinds(two.placements, 'street-lamp').map(p => p.source)).toEqual(['osm', 'osm']); // a main road's bins still come
  });

  it('adds, removes and moves through overrides', () => {
    const base = place({ world: { r: [MAIN()] }, profiles: [sides('residential')] });
    const [a, b] = kinds(base.placements, 'street-lamp');
    const overrides: FurnitureOverride[] = [
      { op: 'add', key: 'bank', kind: 'bench', x: 10, z: 60, rotationY: 0, note: 'test' },
      { op: 'remove', id: a.id, note: 'test' },
      { op: 'move', id: b.id, x: b.x + 2, z: b.z, note: 'test' },
    ];
    const { placements } = place({ world: { r: [MAIN()] }, profiles: [sides('residential')], extra: { overrides } });
    expect(placements.find(p => p.id === 'ovr:bank')).toMatchObject({
      x: 10,
      z: 60,
      source: 'override',
      kind: 'bench',
    });
    expect(placements.some(p => p.id === a.id)).toBe(false);
    expect(placements.find(p => p.id === b.id)).toMatchObject({ x: b.x + 2, source: 'override' });
  });
});

describe('placeFurniture: checks', () => {
  const firstLamp = (f: Fixture) => kinds(place(f).placements, 'street-lamp');

  it('rejects a spot in a building, in water, on a steep slope, by a tree, past the edge or in an exclusion', () => {
    const r = [MAIN()];
    const base = firstLamp({ world: { r }, profiles: [sides('residential')] });
    const { x, z } = base[2];
    const at = (f: Fixture) => place({ ...f, world: { r, ...f.world }, profiles: [sides('residential')] });
    expect(at({ world: { b: [{ p: square(x - 3, z - 3, 6), h: 5, k: 0 }] } }).rejected.building).toBeGreaterThan(0);
    expect(at({ world: { w: [[square(x - 3, z - 3, 6)]] } }).rejected.water).toBeGreaterThan(0);
    expect(at({ trees: [x + 0.5, z, 1] }).rejected.tree).toBeGreaterThan(0);
    expect(at({ extra: { exclusions: [{ x, z, r: 2 }] } }).rejected.exclusion).toBeGreaterThan(0);
    // 40 m up over 500 m is about 4.6°: fine for a lamp (15°), too steep nowhere; 150 m is about 17°
    expect(at({ elev: [0, 0, 0, 0, 0, 0, 1500, 1500, 1500] }).rejected.slope).toBeGreaterThan(0);
    const edge = place({
      world: { r: [road(RoadClass.PRIMARY, [-495, -300, 495, -300])] },
      profiles: [sides('residential')],
    });
    expect(edge.rejected.edge).toBeGreaterThan(0);
    expect(kinds(edge.placements, 'street-lamp').every(l => Math.abs(l.x) <= 480)).toBe(true);
  });

  it('keeps footprints apart, out of carriageways and off parking areas', () => {
    const { placements } = place({
      world: { r: [MAIN(), road(RoadClass.SERVICE, [0, 5, 0, 100])] },
      profiles: [sides('residential'), sides('residential')],
    });
    for (const p of placements)
      for (const q of placements) if (p !== q) expect(Math.hypot(p.x - q.x, p.z - q.z)).toBeGreaterThan(0.5);
    const lot = { i: 1, p: square(-60, 2, 120), k: ParkingKind.SURFACE };
    const parked = place({ world: { r: [MAIN()], pa: [lot] }, profiles: [sides('residential')], extra: {} });
    // the lot is only reserved when the streetscape drew it
    const reserved = placeFurniture({
      data: parked.data,
      roads: parked.roads,
      heightfield: new Heightfield(parked.data),
      buildings: new BuildingIndex(parked.data),
      water: new Water(parked.data, parked.roads),
      trees: [],
      street: { sides: [sides('residential')], openings: [], lots: [{ ai: 0 }] },
    });
    expect(reserved.placements.filter(p => p.z > 2 && p.z < 122 && Math.abs(p.x) < 60)).toEqual([]);
  });
});

describe('placeFurniture: Torget, bus stops and the church', () => {
  it('furnishes Torget with benches facing in, apart, and bins beside some of them', () => {
    const { placements, torget } = place({ world: { r: TORGET() }, profiles: [sides('centre'), sides('centre')] });
    expect(torget?.fromData).toBe(true);
    const benches = placements.filter(p => p.id.startsWith('gen:bench:torget'));
    expect(benches.length).toBeGreaterThanOrEqual(TORGET_TARGETS.benches.min);
    expect(benches.length).toBeLessThanOrEqual(TORGET_TARGETS.benches.max);
    for (const b of benches) {
      expect(b.x > 100 && b.x < 130 && b.z > 100 && b.z < 130).toBe(true);
      const [fx, fz] = facing(b.rotationY);
      const tx = 115 - b.x;
      const tz = 115 - b.z;
      expect((fx * tx + fz * tz) / Math.hypot(tx, tz)).toBeGreaterThan(Math.cos((10 * Math.PI) / 180)); // ±5° jitter
      for (const o of benches) if (o !== b) expect(Math.hypot(o.x - b.x, o.z - b.z)).toBeGreaterThanOrEqual(6);
    }
    const bins = placements.filter(p => p.id.startsWith('gen:waste-bin:torget'));
    expect(bins.length).toBeGreaterThanOrEqual(TORGET_TARGETS.bins.min);
    expect(bins.length).toBeLessThanOrEqual(TORGET_TARGETS.bins.max);
    for (const bin of bins)
      expect(Math.min(...benches.map(b => Math.hypot(b.x - bin.x, b.z - bin.z)))).toBeCloseTo(1.7, 6);
  });

  it('puts a bench and a bin at a bus stop, back from the kerb and facing the road', () => {
    const fu: FurniturePoint[] = [{ i: 50, k: FurnitureCode.BUS_STOP, x: 40, z: 8 }];
    const { placements } = place({ world: { r: [road(RoadClass.STREET, [-100, 0, 100, 0])], fu } });
    const bench = placements.find(p => p.id === 'gen:bench:bus:n50')!;
    expect(bench).toMatchObject({ x: 40, kind: 'bench' });
    expect(bench.z).toBeCloseTo(ROAD_WIDTH_M[RoadClass.STREET] / 2 + 2 + 0.3, 6);
    expect(facing(bench.rotationY)[1]).toBeCloseTo(-1, 9);
    expect(placements.some(p => p.id === 'gen:waste-bin:bus:n50')).toBe(true);
    expect(placements.some(p => p.id === 'osm:n50')).toBe(false); // a bus stop is context, never drawn
  });

  it('puts at most two benches round the church, facing it', () => {
    const { placements } = place({ world: { labels: [{ t: 'Vrigstad Kyrka', x: 200, z: 200, k: 'p' }] } });
    const benches = placements.filter(p => p.id.startsWith('gen:bench:church'));
    expect(benches.length).toBe(2);
    for (const b of benches) {
      const [fx, fz] = facing(b.rotationY);
      expect((fx * (200 - b.x) + fz * (200 - b.z)) / Math.hypot(200 - b.x, 200 - b.z)).toBeGreaterThan(0.98);
    }
  });
});

describe('placeFurniture: determinism', () => {
  it('gives the same array twice, and with the roads in another order', () => {
    const r = [MAIN(), road(RoadClass.STREET, [0, -200, 0, 200], { i: 3000 }), ...TORGET(100, 100)];
    const profiles = [sides('centre'), sides('residential'), sides('centre'), sides('centre')];
    const a = place({ world: { r }, profiles }).placements;
    expect(place({ world: { r }, profiles }).placements).toEqual(a);
    const reversed = place({ world: { r: [...r].reverse() }, profiles: [...profiles].reverse() }).placements;
    expect(reversed).toEqual(a);
    expect(a.length).toBeGreaterThan(20);
  });

  it('puts each lamp emitter at the end of its arm', () => {
    const { placements } = place({ world: { r: [MAIN()] }, profiles: [sides('residential')] });
    const lamps = kinds(placements, 'street-lamp');
    const e = lampEmitters(placements);
    expect(e.length).toBe(lamps.length);
    const [, y, armM] = FURNITURE['street-lamp'].emitter!.offset;
    expect(Math.abs(e[0].z)).toBeCloseTo(Math.abs(lamps[0].z) - armM, 6); // the arm reaches over the road
    expect(e[0].y).toBeCloseTo(y, 6);
  });
});

describe('placeFurniture: review fixes', () => {
  it('puts a bus stop mapped on the road itself beside the road, not along the carriageway', () => {
    const fu: FurniturePoint[] = [{ i: 60, k: FurnitureCode.BUS_STOP, x: 40, z: 0 }];
    const { placements } = place({ world: { r: [road(RoadClass.STREET, [-100, 0, 100, 0], { i: 6000 })], fu } });
    const bench = placements.find(p => p.id === 'gen:bench:bus:n60')!;
    expect(bench.x).toBeCloseTo(40, 6);
    expect(Math.abs(bench.z)).toBeCloseTo(ROAD_WIDTH_M[RoadClass.STREET] / 2 + 2 + 0.3, 6);
    expect(facing(bench.rotationY)[1]).toBeCloseTo(-Math.sign(bench.z), 6); // facing the road
  });

  it("finds a bus stop's road in the next lookup cell, past the grid's 14 m margin", () => {
    // the road runs along x = 70; the stop at x = 45 is 25 m from it, in the 0..50 cell where the road isn't filed
    const fu: FurniturePoint[] = [{ i: 61, k: FurnitureCode.BUS_STOP, x: 45, z: 0 }];
    const { placements } = place({ world: { r: [road(RoadClass.STREET, [70, -200, 70, 200], { i: 6100 })], fu } });
    const bench = placements.find(p => p.id === 'gen:bench:bus:n61');
    expect(bench).toBeDefined();
    expect(bench!.x).toBeCloseTo(70 - ROAD_WIDTH_M[RoadClass.STREET] / 2 - 2 - 0.3, 6); // on the stop's side
  });

  it('treats a street split where it carries straight on as one street, not a junction', () => {
    // over many split points some lamp lands within a few metres of the join, where the next piece would count as
    // another carriageway
    let near = 0;
    for (let length = 20; length <= 60; length++) {
      const west = road(RoadClass.PRIMARY, [-length, 0, 0, 0], { i: 6200 + length * 2 }); // a main road: no minimum length
      const east = road(RoadClass.PRIMARY, [0, 0, 200, 0], { i: 6201 + length * 2 });
      const { placements, rejected } = place({
        world: { r: [west, east] },
        profiles: [sides('residential'), sides('residential')],
      });
      expect(rejected.junction).toBe(0);
      near += placements.filter(p => p.kind === 'street-lamp' && Math.abs(p.x) < 4).length;
    }
    expect(near).toBeGreaterThan(0);
  });

  it("scales a lamp emitter's offset along the arm with the lamp", () => {
    const lamp = {
      id: 'x',
      kind: 'street-lamp',
      modelId: 'lamp-arm',
      x: 0,
      z: 0,
      rotationY: 0,
      scale: 2,
      source: 'override',
    } as const;
    const [e] = lampEmitters([lamp]);
    const [, y, z] = FURNITURE['street-lamp'].emitter!.offset;
    expect(e.z).toBeCloseTo(2 * z, 9);
    expect(e.y).toBeCloseTo(2 * y, 9);
  });
});

describe('placeFurniture: second review', () => {
  it("leaves out a bus stop's bin when its bench is turned down", () => {
    const fu: FurniturePoint[] = [{ i: 70, k: FurnitureCode.BUS_STOP, x: 40, z: 8 }];
    const world = { r: [road(RoadClass.STREET, [-100, 0, 100, 0], { i: 7000 })], fu };
    const benchZ = ROAD_WIDTH_M[RoadClass.STREET] / 2 + 2 + 0.3;
    // an exclusion over the bench's middle only: the bin, 1.9 m along the kerb, would pass on its own
    const { placements } = place({ world, extra: { exclusions: [{ x: 40, z: benchZ, r: 1 }] } });
    expect(placements.some(p => p.id === 'gen:bench:bus:n70')).toBe(false);
    expect(placements.some(p => p.id === 'gen:waste-bin:bus:n70')).toBe(false);
  });

  it('tells a mapped node from a way with the same OSM id', () => {
    const fu: FurniturePoint[] = [
      { i: 5, k: FurnitureCode.BENCH, x: 40, z: 60 },
      { i: 5, e: 'w', k: FurnitureCode.BENCH, x: -40, z: 60 },
    ];
    expect(place({ world: { fu } }).placements.map(p => p.id)).toEqual(['osm:n5', 'osm:w5']);
  });

  it("keeps a park's bench ids when a refresh adds a land area before it", () => {
    const labels = [{ t: 'Torget', x: 0, z: 0, k: 'p' }];
    const park = { k: LandUse.GRASS, p: square(100, 100, 40) };
    const ids = (l: WorldData['l']) =>
      place({ world: { labels, l } })
        .placements.filter(p => p.id.startsWith('gen:bench:park'))
        .map(p => p.id);
    const before = ids([park]);
    expect(before.length).toBe(2);
    expect(ids([{ k: LandUse.FARMLAND, p: square(-300, -300, 50) }, park])).toEqual(before);
  });

  it('gives a lit path its lamps, but not a lit sidewalk mapped beside its street', () => {
    const lamps = (extra: Partial<Road>) =>
      kinds(
        place({ world: { r: [road(RoadClass.PATH, [-100, 0, 100, 0], { lt: 1, ...extra })] } }).placements,
        'street-lamp',
      ).length;
    expect(lamps({})).toBeGreaterThan(4);
    expect(lamps({ s: RoadUse.SIDEWALK })).toBe(0);
  });
});
