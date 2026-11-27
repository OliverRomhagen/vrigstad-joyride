import { describe, expect, it } from 'vitest';
import { BuildingIndex } from '../../../../src/world/buildings';
import {
  type Building,
  BuildingKind,
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

  it('follows context: outskirts get no lamps, residential streets lamps only, short ones none', () => {
    const outer = place({ world: { r: [MAIN()] }, profiles: [sides('outskirts')] });
    expect(kinds(outer.placements, 'street-lamp')).toEqual([]);
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

describe('placeFurniture: by the houses (#305)', () => {
  // an eastbound residential street along z = 0; south (+z) is its right
  const VILLAGATAN = () => road(RoadClass.STREET, [-300, 0, 300, 0], { i: 5000 });
  // n 10 m houses south of the street, their north walls at z, the first from x = `from` and then every `step` m
  const houses = (n: number, { z = 15, from = -200, step = 30 } = {}) =>
    Array.from({ length: n }, (_, k): Building => ({ p: square(from + k * step, z, 10), h: 5, k: BuildingKind.OTHER }));
  // a mapped driveway from the street's south edge to the north wall at z = 15, along x
  const driveway = (x: number) =>
    road(RoadClass.SERVICE, [x, ROAD_WIDTH_M[RoadClass.STREET] / 2, x, 15], { s: RoadUse.DRIVEWAY });

  it('gives each house a mailbox at the street and one or two wheelie bins against its wall, all facing the street', () => {
    const { placements } = place({ world: { r: [VILLAGATAN()], b: houses(6) } });
    const mailboxes = kinds(placements, 'mailbox');
    const bins = kinds(placements, 'wheelie-bin');
    expect(mailboxes.length).toBe(6);
    expect(bins.length).toBeGreaterThanOrEqual(6);
    expect(bins.length).toBeLessThanOrEqual(12);
    const edge = ROAD_WIDTH_M[RoadClass.STREET] / 2 + 1.4; // no sidewalk: the property line past the verge
    for (const m of mailboxes) expect(m.z).toBeCloseTo(edge + FURNITURE.mailbox.depthM / 2, 6);
    for (const b of bins) expect(b.z).toBeCloseTo(15 - 0.25 - FURNITURE['wheelie-bin'].depthM / 2, 6); // back to the north wall at z = 15
    for (const h of houses(6)) {
      const atHouse = bins.filter(b => b.x > h.p[0] && b.x < h.p[2]); // in front of its wall, x0 to x0 + 10
      expect(atHouse.length).toBeGreaterThanOrEqual(1);
      expect(atHouse.length).toBeLessThanOrEqual(2);
    }
    for (const p of [...mailboxes, ...bins]) expect(facing(p.rotationY)[1]).toBeLessThan(-0.9); // turned to the street, -z
  });

  it('keeps the mailboxes off the sidewalk: past its outer edge', () => {
    const right = side('present', 1.5);
    const { placements } = place({
      world: { r: [VILLAGATAN()], b: houses(3) },
      profiles: [sides('residential', side(), right)],
    });
    const outer = sidewalkCentreM(right, RoadClass.STREET)! + 0.75;
    for (const p of kinds(placements, 'mailbox'))
      expect(p.z - FURNITURE[p.kind].depthM / 2).toBeGreaterThanOrEqual(outer);
  });

  it('stands a street cabinet in the verge every few houses', () => {
    const { placements } = place({ world: { r: [VILLAGATAN()], b: houses(14, { from: -250, step: 34 }) } });
    const cabinets = kinds(placements, 'street-cabinet');
    expect(cabinets.length).toBeGreaterThanOrEqual(2); // every 4 to 6 of 14 houses
    expect(cabinets.length).toBeLessThanOrEqual(3);
    expect(cabinets.every(c => c.z > 0)).toBe(true);
  });

  it('gives houses in the outskirts a shared mailbox stand, and bins at the houses', () => {
    const { placements } = place({
      world: { r: [VILLAGATAN()], b: houses(4, { step: 40 }) },
      profiles: [sides('outskirts')],
    });
    expect(kinds(placements, 'mailbox-stand').map(p => p.modelId)).toEqual(['mailbox-stand-4']);
    expect(kinds(placements, 'mailbox')).toEqual([]);
    expect(kinds(placements, 'wheelie-bin').length).toBeGreaterThanOrEqual(4); // bins at every house, out here too
    const lone = place({ world: { r: [VILLAGATAN()], b: houses(2, { step: 40 }) }, profiles: [sides('outskirts')] });
    expect(kinds(lone.placements, 'mailbox').length).toBe(2); // too few for a stand: one each
  });

  it('leaves no house in the outskirts without a mailbox: a full stand, then the rest', () => {
    // eight houses along 140 m: one stand takes six, and the two left over are too few for another
    const { placements } = place({
      world: { r: [VILLAGATAN()], b: houses(8, { step: 20 }) },
      profiles: [sides('outskirts')],
    });
    const [stand, ...more] = kinds(placements, 'mailbox-stand');
    expect(more).toEqual([]);
    expect(stand.modelId).toBe('mailbox-stand-6');
    expect(stand.x).toBeCloseTo(-200 + 5 + (5 * 20) / 2, 0); // in the middle of the six it serves, not at the first
    expect(kinds(placements, 'mailbox').length).toBe(2);
  });

  it("keeps the bins off a mapped driveway, and inside the wall's ends, wherever the driveway meets the wall", () => {
    // six houses, each with a driveway: at the middle of its wall, then nearer and nearer its west corner
    const b = houses(6);
    const at = [5, 4, 3, 2, 1, 0.5].map((dx, k) => b[k].p[0] + dx);
    const { placements } = place({ world: { r: [VILLAGATAN(), ...at.map(driveway)], b } });
    const bins = kinds(placements, 'wheelie-bin');
    const { widthM } = FURNITURE['wheelie-bin'];
    b.forEach((h, k) => {
      const atHouse = bins.filter(p => p.x > h.p[0] && p.x < h.p[2]);
      expect(atHouse.length).toBeGreaterThanOrEqual(1); // one of them, at least, finds room
      for (const p of atHouse) {
        expect(Math.abs(p.x - at[k])).toBeGreaterThan(ROAD_WIDTH_M[RoadClass.SERVICE] / 2 + widthM / 2); // not on it
        expect(p.x - widthM / 2).toBeGreaterThanOrEqual(h.p[0]);
        expect(p.x + widthM / 2).toBeLessThanOrEqual(h.p[2]);
      }
      if (atHouse.length === 2) expect(Math.abs(atHouse[0].x - atHouse[1].x)).toBeGreaterThan(widthM); // side by side
    });
    expect(bins.length).toBeGreaterThan(6); // some house has two
  });

  it("gives each house of a stand that can't stand a mailbox of its own", () => {
    // four houses in the outskirts, their middles at x = -195 to -75: the stand would stand at -135, where a tree is
    const standZ = ROAD_WIDTH_M[RoadClass.STREET] / 2 + 1.4 + FURNITURE['mailbox-stand'].depthM / 2;
    const { placements } = place({
      world: { r: [VILLAGATAN()], b: houses(4, { step: 40 }) },
      profiles: [sides('outskirts')],
      trees: [-135, standZ, 1],
    });
    expect(kinds(placements, 'mailbox-stand')).toEqual([]);
    expect(kinds(placements, 'mailbox').length).toBe(4);
  });
});

describe('placeFurniture: along the country roads (#305)', () => {
  it('lines an outer primary road with posts on both sides, about every 50 m, facing the road', () => {
    const { placements } = place({ world: { r: [MAIN()] }, profiles: [sides('outskirts')] });
    const posts = kinds(placements, 'roadside-post');
    for (const sgn of [-1, 1]) {
      const side = posts.filter(p => Math.sign(p.z) === sgn);
      expect(side.length).toBeGreaterThanOrEqual(10); // 600 m of road
      const xs = side.map(p => p.x).sort((a, b) => a - b);
      const gaps = xs.slice(1).map((x, i) => x - xs[i]);
      for (const gap of gaps) {
        expect(gap).toBeGreaterThanOrEqual(50 - 2 * 4 - 1e-9);
        expect(gap).toBeLessThanOrEqual(50 + 2 * 4 + 1e-9);
      }
      expect(Math.max(...gaps) - Math.min(...gaps)).toBeGreaterThan(2); // jittered, not all shifted alike
    }
    for (const p of posts) {
      expect(Math.abs(p.z)).toBeCloseTo(ROAD_WIDTH_M[RoadClass.PRIMARY] / 2 + 0.6, 6); // just past the carriageway
      const [fx, fz] = facing(p.rotationY);
      expect(Math.abs(fx)).toBeLessThan(1e-9);
      expect(Math.sign(fz)).toBe(-Math.sign(p.z)); // the reflector to the road
      expect(p.source).toBe('procedural');
    }
  });

  it('puts none in the built-up area, nor along streets and tracks in the outskirts', () => {
    expect(kinds(place({ world: { r: [MAIN()] } }).placements, 'roadside-post')).toEqual([]); // residential
    for (const c of [RoadClass.STREET, RoadClass.TRACK]) {
      const { placements } = place({ world: { r: [road(c, [-300, 0, 300, 0])] }, profiles: [sides('outskirts')] });
      expect(kinds(placements, 'roadside-post')).toEqual([]);
    }
  });

  it('keeps posts out of a side road’s mouth', () => {
    const side = road(RoadClass.STREET, [0, 0, 0, 200]);
    const { placements } = place({ world: { r: [MAIN(), side] }, profiles: [sides('outskirts'), sides('outskirts')] });
    const posts = kinds(placements, 'roadside-post');
    expect(posts.length).toBeGreaterThan(0);
    for (const p of posts) expect(Math.hypot(p.x, p.z)).toBeGreaterThanOrEqual(10);
  });
});

describe('placeFurniture: bales in the fields (#305)', () => {
  // a 300 m square field, 10 ha, away from any road
  const FIELD = { k: LandUse.FARMLAND, p: [-150, -150, 150, -150, 150, 150, -150, 150] };

  it('lays short rows of bales inside a field, a row per 3 ha, each of one wrap', () => {
    const { placements } = place({ world: { l: [FIELD] } });
    const bales = kinds(placements, 'silage-bale');
    const rows = new Map<string, typeof bales>();
    for (const b of bales) {
      const row = b.id.split(':').slice(2, 4).join(':');
      rows.set(row, [...(rows.get(row) ?? []), b]);
    }
    expect(rows.size).toBe(3);
    for (const row of rows.values()) {
      expect(row.length).toBeGreaterThanOrEqual(3);
      expect(row.length).toBeLessThanOrEqual(6);
      expect(new Set(row.map(b => b.modelId)).size).toBe(1);
      for (let i = 1; i < row.length; i++)
        expect(Math.hypot(row[i].x - row[i - 1].x, row[i].z - row[i - 1].z)).toBeCloseTo(1.5, 6);
    }
    for (const b of bales) {
      expect(Math.abs(b.x)).toBeLessThanOrEqual(150 - 12);
      expect(Math.abs(b.z)).toBeLessThanOrEqual(150 - 12);
    }
  });

  it('puts none outside farmland, and the same ones every time', () => {
    expect(kinds(place({ world: { l: [{ ...FIELD, k: LandUse.GRASS }] } }).placements, 'silage-bale')).toEqual([]);
    expect(place({ world: { l: [FIELD] } }).placements).toEqual(place({ world: { l: [FIELD] } }).placements);
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
