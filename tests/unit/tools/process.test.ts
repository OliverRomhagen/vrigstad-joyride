import { execFileSync } from 'node:child_process';
import { copyFileSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import {
  CrossingKind,
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
const node = (id: number, x: number, z: number, tags: Record<string, string>) => ({ type: 'node', id, ...ll(x, z), tags });
const way = (id: number, pts: [number, number][], tags: Record<string, string>, nodes = pts.map((_, k) => id * 100 + k)) => ({
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

const street = way(1, [[1000, 0], [1200, 0], [1200, 10], [1000, 10]], {
  highway: 'residential',
  name: 'Kantgatan',
  sidewalk: 'left',
  'sidewalk:left:width': '2.5',
  'parking:right': 'lane',
  'parking:right:orientation': 'parallel',
  surface: 'asphalt',
});
const elements = [
  way(48762655, church, { building: 'church' }),
  street,
  street, // a duplicate, as a union of selectors can return
  { type: 'way', id: 2, nodes: [1, 2], tags: { highway: 'residential' } }, // no geometry: skipped, not a crash
  way(3, [[0, 6], [50, 6]], { highway: 'footway', footway: 'sidewalk' }),
  way(4, [[20, 0], [20, -15]], { highway: 'service', service: 'driveway' }),
  way(5, [[0, 0], [50, 0]], { highway: 'residential', 'parking:lane:left': 'perpendicular', 'parking:lane:left:perpendicular': 'on_kerb' }, [7, 8]),
  node(7, 0, 0, { highway: 'crossing', crossing: 'zebra', kerb: 'lowered' }),
  node(9, 300, 300, { crossing: 'unmarked' }),
  node(10, 40, 40, { kerb: 'raised' }),
  node(11, 5000, 0, { natural: 'tree' }), // outside the world
  node(12, 60, 60, { natural: 'tree' }),
  way(13, [[100, 100], [116, 100]], { natural: 'tree_row' }),
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
];

let dir = '';
let out: WorldData;
let log = '';

beforeAll(() => {
  dir = mkdtempSync(join(tmpdir(), 'process-'));
  copyFileSync('data/raw/tile.png', join(dir, 'tile.png'));
  writeFileSync(join(dir, 'osm.json'), JSON.stringify({ elements }));
  log = execFileSync('python3', ['tools/process.py', dir, join(dir, 'out.json')], { encoding: 'utf8' });
  out = JSON.parse(readFileSync(join(dir, 'out.json'), 'utf8'));
});

afterAll(() => rmSync(dir, { recursive: true, force: true }));

describe('tools/process.py streetscape data', () => {
  it('de-duplicates by type and id, and skips incomplete elements', () => {
    expect(out.r.filter((r) => r.i === 1)).toHaveLength(2); // two pieces of one way, not four
    expect(out.r.some((r) => r.i === 2)).toBe(false);
    expect(log).toContain("skipped, incomplete geometry: {'way': 1}");
  });

  it('keeps OSM ids, piece numbers and the way direction through clipping', () => {
    const pieces = out.r.filter((r) => r.i === 1);
    expect(pieces.map((r) => r.j)).toEqual([0, 1]);
    expect(pieces[0].p).toEqual([1000, 0, 1100, 0]); // eastward, as mapped
    expect(pieces[1].p).toEqual([1100, 10, 1000, 10]); // westward, as mapped
    // so the sidewalk stays on the way's own left in both pieces
    for (const r of pieces) expect(r.sw).toEqual([SideState.PRESENT, SideState.ABSENT]);
    expect(out.r.find((r) => r.i === 5)?.j).toBeUndefined();
  });

  it('reduces tags to codes', () => {
    const r = out.r.find((r) => r.i === 1)!;
    expect(r.sww).toEqual([2.5, 0]);
    expect(r.sf).toBe(Surface.ASPHALT);
    expect(r.pk).toEqual([StreetParking.UNKNOWN, StreetParking.LANE]);
    expect(r.po).toEqual([ParkingOrientation.UNKNOWN, ParkingOrientation.PARALLEL]);
    const old = out.r.find((r) => r.i === 5)!;
    expect(old.pk).toEqual([StreetParking.ON_KERB, StreetParking.UNKNOWN]);
    expect(old.po).toEqual([ParkingOrientation.PERPENDICULAR, ParkingOrientation.UNKNOWN]);
    expect(old.sw).toBeUndefined(); // no tag is unknown, and unknown is not written
    expect(out.r.find((r) => r.i === 3)?.s).toBe(RoadUse.SIDEWALK);
    expect(out.r.find((r) => r.i === 4)?.s).toBe(RoadUse.DRIVEWAY);
  });

  it('ties crossing nodes to road vertices and keeps the rest free-standing', () => {
    const r5 = out.r.findIndex((r) => r.i === 5);
    expect(out.x).toEqual([
      { i: 7, x: 0, z: 0, k: CrossingKind.MARKED, kb: Kerb.LOWERED, r: r5, v: 0 },
      { i: 9, x: 300, z: 300, k: CrossingKind.UNMARKED },
    ]);
    expect(out.kb).toEqual([{ i: 10, x: 40, z: 40, kb: Kerb.RAISED }]);
  });

  it('keeps ground parking with its hole, drops underground parking, and keeps spaces apart', () => {
    expect(out.pa?.map((a) => a.i)).toEqual([14, 16]);
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
