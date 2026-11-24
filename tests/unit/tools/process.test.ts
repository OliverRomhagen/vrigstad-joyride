import { execFileSync } from 'node:child_process';
import { copyFileSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { beforeAll, describe, expect, it } from 'vitest';
import {
  CrossingKind,
  FurnitureCode,
  Kerb,
  ParkingKind,
  ParkingOrientation,
  RoadUse,
  SideState,
  StreetParking,
  Surface,
  type WorldData,
} from '../../../src/world/data';

// Runs tools/process.py on a hand-made Overpass answer. Positions are given in world metres and turned into lat/lon
// with the script's own projection, so each expected value can be worked out by hand.
const LAT0 = 57.3555;
const LON0 = 14.4756;
const MLAT = 111360;
const MLON = 111320 * Math.cos((LAT0 * Math.PI) / 180);
const ll = (x: number, z: number) => ({ lat: LAT0 - z / MLAT, lon: LON0 + x / MLON });
const node = (id: number, x: number, z: number, tags: Record<string, string>) => ({
  type: 'node',
  id,
  ...ll(x, z),
  tags,
});
const way = (
  id: number,
  pts: [number, number][],
  tags: Record<string, string>,
  nodes = pts.map((_, k) => id * 100 + k),
) => ({
  type: 'way',
  id,
  nodes,
  geometry: pts.map(([x, z]) => ll(x, z)),
  tags,
});
const ring = (x0: number, z0: number, w: number, h: number): [number, number][] => [
  [x0, z0],
  [x0 + w, z0],
  [x0 + w, z0 + h],
  [x0, z0 + h],
  [x0, z0],
];

// the church way must be there (process.py splits its tower out); 13 corners
const church = Array.from({ length: 13 }, (_, k): [number, number] => {
  const a = (k / 13) * Math.PI * 2;
  return [-300 + 10 * Math.cos(a), 10 * Math.sin(a)];
});
church.push(church[0]);

const street = way(
  1,
  [
    [1000, 0],
    [1200, 0],
    [1200, 10],
    [1000, 10],
  ],
  {
    highway: 'residential',
    name: 'Kantgatan',
    sidewalk: 'left',
    'sidewalk:left:width': '2.5',
    'parking:right': 'lane',
    'parking:right:orientation': 'parallel',
    surface: 'asphalt',
  },
);
const elements = [
  way(48762655, church, { building: 'church' }),
  // the bank museum, moved off Jönköpingsvägen; centred where BUILDING_SHIFT expects its outline
  way(48807861, ring(-80.5, -26.1, 10, 10), { building: 'yes' }),
  // the other BUILDING_SHIFT ways, which must all be there, each a 10 m square on the area centroid it expects
  ...(
    [
      [99634081, -618.3, 75.6],
      [173869280, 650.9, -988.2],
      [99634083, -584.5, 87.6],
      [48400728, -15.8, 76.2],
      [100345766, -20.6, 53.3],
      [99738592, -61.9, -132.5],
      [103000690, -90.7, 121.5],
    ] as const
  ).map(([id, cx, cz]) => way(id, ring(cx - 5, cz - 5, 10, 10), { building: 'yes' })),
  street,
  street, // a duplicate, as a union of selectors can return
  { type: 'way', id: 2, nodes: [1, 2], tags: { highway: 'residential' } }, // no geometry: skipped, not a crash
  way(
    3,
    [
      [0, 6],
      [50, 6],
    ],
    { highway: 'footway', footway: 'sidewalk' },
  ),
  way(
    4,
    [
      [20, 0],
      [20, -15],
    ],
    { highway: 'service', service: 'driveway' },
  ),
  way(
    5,
    [
      [0, 0],
      [50, 0],
    ],
    { highway: 'residential', 'parking:lane:left': 'perpendicular', 'parking:lane:left:perpendicular': 'on_kerb' },
    [7, 8],
  ),
  node(7, 0, 0, { highway: 'crossing', crossing: 'zebra', kerb: 'lowered' }),
  node(9, 300, 300, { crossing: 'unmarked' }),
  node(10, 40, 40, { kerb: 'raised' }),
  node(11, 5000, 0, { natural: 'tree' }), // outside the world
  node(12, 60, 60, { natural: 'tree' }),
  way(
    13,
    [
      [100, 100],
      [116, 100],
    ],
    { natural: 'tree_row' },
  ),
  {
    type: 'relation',
    id: 14,
    tags: { type: 'multipolygon', amenity: 'parking', surface: 'gravel', capacity: '12' },
    members: [
      { type: 'way', ref: 1, role: 'outer', geometry: ring(-100, -100, 40, 30).map(([x, z]) => ll(x, z)) },
      { type: 'way', ref: 2, role: 'inner', geometry: ring(-90, -90, 10, 10).map(([x, z]) => ll(x, z)) },
    ],
  },
  way(15, ring(200, 200, 20, 20), { amenity: 'parking', parking: 'underground' }),
  way(16, ring(-200, -200, 20, 20), { amenity: 'parking', parking: 'carports' }),
  way(17, ring(-195, -195, 2.5, 5), { amenity: 'parking_space' }),
  // street furniture (#144)
  node(20, 10, 20, { highway: 'street_lamp' }),
  node(21, 12.04, 20, { amenity: 'bench', direction: 'SW' }),
  node(22, 14, 20, { amenity: 'bench', direction: '95' }),
  node(23, 16, 20, { amenity: 'bench', direction: 'towards the lake' }), // doesn't parse: left out
  way(24, ring(30, 30, 2, 0.6), { amenity: 'bench' }), // a way-mapped bench: its middle
  node(25, 18, 20, { amenity: 'waste_basket' }),
  node(26, 22, 20, { highway: 'bus_stop', name: 'Vrigstad Torget', kerb: 'raised' }),
  node(27, 5000, 20, { amenity: 'bench' }), // outside the world: dropped
  node(28, 24, 20, { leisure: 'picnic_table' }), // counted only
  way(
    29,
    [
      [0, 50],
      [80, 50],
    ],
    { highway: 'residential', lit: 'yes' },
  ),
  way(
    30,
    [
      [0, 60],
      [80, 60],
    ],
    { highway: 'residential', lit: 'automatic' }, // neither yes nor no: left out
  ),
];

// runs tools/process.py on an Overpass answer in a temp dir; a failed assert throws with the script's stderr
const runProcess = (els: readonly unknown[]) => {
  const dir = mkdtempSync(join(tmpdir(), 'process-'));
  try {
    copyFileSync('data/raw/tile.png', join(dir, 'tile.png'));
    writeFileSync(join(dir, 'osm.json'), JSON.stringify({ elements: els }));
    const log = execFileSync('python3', ['tools/process.py', dir, join(dir, 'out.json')], {
      encoding: 'utf8',
      stdio: 'pipe',
    });
    return { log, out: JSON.parse(readFileSync(join(dir, 'out.json'), 'utf8')) as WorldData };
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
};

let out: WorldData;
let log = '';

beforeAll(() => {
  ({ out, log } = runProcess(elements));
});

describe('tools/process.py street furniture data', () => {
  it('keeps mapped lamps, benches, bins and bus stops, with a bench direction when it parses', () => {
    expect(out.fu).toEqual([
      { i: 20, k: FurnitureCode.STREET_LAMP, x: 10, z: 20 },
      { i: 21, k: FurnitureCode.BENCH, x: 12, z: 20, d: 225 },
      { i: 22, k: FurnitureCode.BENCH, x: 14, z: 20, d: 95 },
      { i: 23, k: FurnitureCode.BENCH, x: 16, z: 20 },
      { i: 24, e: 'w', k: FurnitureCode.BENCH, x: 31, z: 30.3 }, // a way: nodes and ways number separately
      { i: 25, k: FurnitureCode.WASTE_BASKET, x: 18, z: 20 },
      { i: 26, k: FurnitureCode.BUS_STOP, x: 22, z: 20 },
    ]);
    expect(log).toContain('picnic tables 1 (counted only); 1 outside the world');
  });
  it('keeps lit=yes and lit=no on roads, and nothing else', () => {
    expect(out.r.find(r => r.i === 29)?.lt).toBe(1);
    expect(out.r.find(r => r.i === 30)?.lt).toBeUndefined();
    expect(out.r.find(r => r.i === 1)?.lt).toBeUndefined();
  });
});

describe('tools/process.py buildings', () => {
  it('moves an outline listed in BUILDING_SHIFT by its offset', () => {
    expect(out.b.map(b => b.p)).toContainEqual([-82, -31.1, -72, -31.1, -72, -21.1, -82, -21.1]);
  });

  // the fixture with the bank museum's way replaced, or dropped for undefined
  const withMuseum = (museum: ReturnType<typeof way> | undefined) =>
    elements.flatMap(e => (e.type === 'way' && e.id === 48807861 ? (museum ? [museum] : []) : [e]));
  const museumRing = ring(-80.5, -26.1, 10, 10);

  it('fails the build when a listed outline was re-traced', () => {
    const retraced = way(48807861, ring(-79.5, -26.1, 10, 10), { building: 'yes' }); // 1 m east
    expect(() => runProcess(withMuseum(retraced))).toThrow(/way 48807861 was re-traced/);
  });

  it('keeps a listed outline that only gained a corner on an edge', () => {
    const [a, b, ...rest] = museumRing;
    const entrance = way(48807861, [a, [(a[0] + b[0]) / 2, a[1]], b, ...rest], { building: 'yes' });
    expect(() => runProcess(withMuseum(entrance))).not.toThrow();
  });

  it('fails the build when a listed way is no longer a building outline', () => {
    const msg = /BUILDING_SHIFT ways not found as building outlines in osm\.json: \{48807861\}/;
    expect(() => runProcess(withMuseum(undefined))).toThrow(msg);
    expect(() => runProcess(withMuseum(way(48807861, museumRing, { amenity: 'bank' })))).toThrow(msg);
  });
});

describe('tools/process.py streetscape data', () => {
  it('de-duplicates by type and id, and skips incomplete elements', () => {
    expect(out.r.filter(r => r.i === 1)).toHaveLength(2); // two pieces of one way, not four
    expect(out.r.some(r => r.i === 2)).toBe(false);
    expect(log).toContain("skipped, incomplete geometry: {'way': 1}");
  });

  it('keeps OSM ids, piece numbers and the way direction through clipping', () => {
    const pieces = out.r.filter(r => r.i === 1);
    expect(pieces.map(r => r.j)).toEqual([0, 1]);
    expect(pieces[0].p).toEqual([1000, 0, 1100, 0]); // eastward, as mapped
    expect(pieces[1].p).toEqual([1100, 10, 1000, 10]); // westward, as mapped
    // so the sidewalk stays on the way's own left in both pieces
    for (const r of pieces) expect(r.sw).toEqual([SideState.PRESENT, SideState.ABSENT]);
    expect(out.r.find(r => r.i === 5)?.j).toBeUndefined();
  });

  it('reduces tags to codes', () => {
    const r = out.r.find(r => r.i === 1)!;
    expect(r.sww).toEqual([2.5, 0]);
    expect(r.sf).toBe(Surface.ASPHALT);
    expect(r.pk).toEqual([StreetParking.UNKNOWN, StreetParking.LANE]);
    expect(r.po).toEqual([ParkingOrientation.UNKNOWN, ParkingOrientation.PARALLEL]);
    const old = out.r.find(r => r.i === 5)!;
    expect(old.pk).toEqual([StreetParking.ON_KERB, StreetParking.UNKNOWN]);
    expect(old.po).toEqual([ParkingOrientation.PERPENDICULAR, ParkingOrientation.UNKNOWN]);
    expect(old.sw).toBeUndefined(); // no tag is unknown, and unknown is not written
    expect(out.r.find(r => r.i === 3)?.s).toBe(RoadUse.SIDEWALK);
    expect(out.r.find(r => r.i === 4)?.s).toBe(RoadUse.DRIVEWAY);
  });

  it('ties crossing nodes to road vertices and keeps the rest free-standing', () => {
    const r5 = out.r.findIndex(r => r.i === 5);
    expect(out.x).toEqual([
      { i: 7, x: 0, z: 0, k: CrossingKind.MARKED, kb: Kerb.LOWERED, r: r5, v: 0 },
      { i: 9, x: 300, z: 300, k: CrossingKind.UNMARKED },
    ]);
    expect(out.kb).toEqual([
      { i: 10, x: 40, z: 40, kb: Kerb.RAISED },
      { i: 26, x: 22, z: 20, kb: Kerb.RAISED }, // the bus stop, which is street furniture too
    ]);
  });

  it('keeps ground parking with its hole, drops underground parking, and keeps spaces apart', () => {
    expect(out.pa?.map(a => a.i)).toEqual([14, 16]);
    const [lot, carports] = out.pa!;
    expect(lot.sf).toBe(Surface.GRAVEL);
    expect(lot.cap).toBe(12);
    expect(lot.k).toBe(ParkingKind.SURFACE);
    expect(lot.h).toHaveLength(1);
    expect(carports.k).toBe(ParkingKind.CARPORTS);
    expect(out.ps).toEqual([{ i: 17, p: [-195, -195, -192.5, -195, -192.5, -190, -195, -190] }]);
  });

  it('keeps trees inside the world and samples tree rows every 8 m', () => {
    expect(out.t).toEqual([60, 60, 100, 100, 108, 100, 116, 100]);
  });
});
