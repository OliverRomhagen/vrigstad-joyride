// Benches (#144): round Torget, at bus stops, in the parks near Torget and round the church, with how many each place
// takes. Pure: no three.js.
import { FurnitureCode, LandUse, ROAD_WIDTH_M, RoadClass } from '../data';
import { vertexCentre } from '../polygon';
import { fnv1a, hash01 } from '../random';
import { FURNITURE } from './definitions';
import { byOrder, type Candidate, heading, insideOutlineSpots, jitterRad, osmKey, type Placer } from './placer';

/** Torget's benches: how many, set back from the outline, apart, and away from a building wall (m) */
export const TORGET_BENCHES = { min: 4, max: 6 };
const TORGET_SETBACK_M = 1.5;
const TORGET_BENCH_GAP_M = 6;
const TORGET_WALL_M = 3;
/** Torget's candidates along its outline every this far (m) */
const TORGET_STEP_M = 3;
/** bus stops: the bench this far back from the kerb, the bin this far along from the bench's end (m) */
const BUS_BENCH_BACK_M = 2;
const BUS_BIN_M = 1;
/** a bus stop finds its road within this (m) */
const BUS_ROAD_REACH_M = 30;
/** parks within this of Torget get benches (m), at most this many each, set back this far from the edge (m) */
const PARK_REACH_M = 300;
const PARK_BENCHES = 2;
const PARK_SETBACK_M = 1.5;
const PARK_STEP_M = 6;
/** a park bench faces a road or path within this, else the park's middle (m) */
const PARK_FACE_REACH_M = 40;
/** benches round the church: on these rings round its label, so many spots per ring, at most this many benches */
const CHURCH_RINGS_M = [16, 22];
const CHURCH_SPOTS_PER_RING = 12;
const CHURCH_BENCHES = 2;
/** rotation jitter (rad) */
const BENCH_JITTER_RAD = (5 * Math.PI) / 180;

/** A bench candidate: only what differs between places. */
function benchCandidate(
  id: string,
  x: number,
  z: number,
  rotationY: number,
  origin: string,
  rank: number,
  ri = -1,
): Candidate {
  return {
    id,
    kind: 'bench',
    modelId: FURNITURE.bench.modelId,
    x,
    z,
    rotationY,
    scale: 1,
    source: 'procedural',
    rank,
    origin,
    ri,
  };
}

/** Torget: benches along the inside of the outline, facing its middle, in a hash order so they spread round it. */
function torgetBenchCandidates(placer: Placer): Candidate[] {
  const { torget } = placer;
  if (!torget) return [];
  const out: Candidate[] = [];
  for (const spot of insideOutlineSpots(torget.ring, TORGET_STEP_M, TORGET_STEP_M / 2, TORGET_SETBACK_M)) {
    if (placer.inp.buildings.collide({ x: spot.ex, z: spot.ez }, TORGET_WALL_M)) continue; // a building's front: no bench before its door
    const id = `gen:bench:torget:${spot.count}`;
    const fx = torget.cx - spot.x;
    const fz = torget.cz - spot.z;
    const length = Math.hypot(fx, fz) || 1;
    out.push(
      benchCandidate(
        id,
        spot.x,
        spot.z,
        heading(fx / length, fz / length) + jitterRad(id, BENCH_JITTER_RAD),
        'torget',
        1 + hash01(id, 'order'),
      ),
    );
  }
  return out;
}

/**
 * Bus stops: a bench back from the kerb facing the road, and its bin beside it, by the bench's id (for bins.ts to place
 * once the bench stands). A stop
 * mapped on the road itself, as highway=bus_stop often is, goes on a side chosen by hash, across the road's direction.
 */
function busStopCandidates(placer: Placer) {
  const benches: Candidate[] = [];
  const binByBench = new Map<string, Candidate>();
  for (const f of placer.data.fu ?? []) {
    if (f.k !== FurnitureCode.BUS_STOP) continue;
    const key = osmKey(f);
    const nearest = placer.nearestRoadPoint(f.x, f.z, RoadClass.STREET, BUS_ROAD_REACH_M);
    if (!nearest) continue;
    const road = placer.inp.roads.lines[nearest.ri];
    const side = hash01(key, 'bus side') < 0.5 ? -1 : 1;
    const [ux, uz] =
      nearest.d > 0.01
        ? [(f.x - nearest.px) / nearest.d, (f.z - nearest.pz) / nearest.d]
        : [-nearest.tz * side, nearest.tx * side]; // on the road: its normal, not a fixed compass direction
    const back = ROAD_WIDTH_M[road.c] / 2 + BUS_BENCH_BACK_M + FURNITURE.bench.depthM / 2;
    const bench = benchCandidate(
      `gen:bench:bus:${key}`,
      nearest.px + ux * back,
      nearest.pz + uz * back,
      heading(-ux, -uz),
      'bus stop',
      0,
      nearest.ri,
    );
    benches.push(bench);
    const along = FURNITURE.bench.widthM / 2 + BUS_BIN_M; // along the kerb, past the bench's end
    binByBench.set(bench.id, {
      ...bench,
      id: `gen:waste-bin:bus:${key}`,
      kind: 'waste-bin',
      modelId: FURNITURE['waste-bin'].modelId,
      x: bench.x + uz * along,
      z: bench.z - ux * along,
    });
  }
  return { benches, binByBench };
}

/**
 * A grass area's stable key, from its outline rather than its place in the data, which a refresh reorders: land areas
 * carry no OSM id. Like roadKey for hand-made roads.
 */
const parkKey = (ring: readonly number[]) =>
  'h' + fnv1a(ring.length, ring[0].toFixed(1), ring[1].toFixed(1), ring[2].toFixed(1), ring[3].toFixed(1));

/** Parks near Torget: benches along the inside of each grass area, facing a nearby road or path, else its middle. */
function parkBenchCandidates(placer: Placer): Candidate[] {
  const torgetLabel = placer.data.labels.find(l => l.t === 'Torget');
  if (!torgetLabel) return [];
  const out: Candidate[] = [];
  for (const area of placer.data.l) {
    if (area.k !== LandUse.GRASS) continue;
    const ring = area.p;
    const { x: cx, z: cz } = vertexCentre(ring);
    if (Math.hypot(cx - torgetLabel.x, cz - torgetLabel.z) > PARK_REACH_M) continue;
    const park = `park:${parkKey(ring)}`;
    for (const spot of insideOutlineSpots(ring, PARK_STEP_M, PARK_STEP_M / 2, PARK_SETBACK_M)) {
      const id = `gen:bench:${park}:${spot.count}`;
      const toCentre = Math.hypot(cx - spot.x, cz - spot.z) || 1;
      const toMiddle = heading((cx - spot.x) / toCentre, (cz - spot.z) / toCentre);
      const facing = placer.faceNearestRoad(spot.x, spot.z, RoadClass.PATH, PARK_FACE_REACH_M, toMiddle);
      out.push(
        benchCandidate(id, spot.x, spot.z, facing + jitterRad(id, BENCH_JITTER_RAD), park, 1 + hash01(id, 'order')),
      );
    }
  }
  return out;
}

/** The church: benches on rings round its label, facing it. */
function churchBenchCandidates(placer: Placer): Candidate[] {
  const church = placer.data.labels.find(l => l.t === 'Vrigstad Kyrka');
  if (!church) return [];
  const out: Candidate[] = [];
  CHURCH_RINGS_M.forEach((radius, ring) => {
    for (let k = 0; k < CHURCH_SPOTS_PER_RING; k++) {
      const a = (k / CHURCH_SPOTS_PER_RING) * Math.PI * 2;
      const id = `gen:bench:church:${ring}.${k}`;
      out.push(
        benchCandidate(
          id,
          church.x + Math.cos(a) * radius,
          church.z + Math.sin(a) * radius,
          heading(-Math.cos(a), -Math.sin(a)) + jitterRad(id, BENCH_JITTER_RAD),
          'church',
          1 + hash01(id, 'order'),
        ),
      );
    }
  });
  return out;
}

/**
 * Places the benches, each place up to its count, Torget's kept apart. Returns Torget's accepted benches, for its bins,
 * and the bin candidates of the bus stops whose bench stands: no lone bin where the bench was turned down.
 */
export function placeBenches(placer: Placer) {
  const bus = busStopCandidates(placer);
  const candidates = [
    ...torgetBenchCandidates(placer),
    ...bus.benches,
    ...parkBenchCandidates(placer),
    ...churchBenchCandidates(placer),
  ].sort(byOrder);
  const cap = (origin: string) =>
    origin === 'torget'
      ? TORGET_BENCHES.max
      : origin === 'church'
        ? CHURCH_BENCHES
        : origin.startsWith('park')
          ? PARK_BENCHES
          : Infinity;
  const count = new Map<string, number>();
  const torgetBenches: Candidate[] = [];
  const busBins: Candidate[] = [];
  for (const c of candidates) {
    if ((count.get(c.origin) ?? 0) >= cap(c.origin)) continue;
    if (c.origin === 'torget' && torgetBenches.some(b => Math.hypot(b.x - c.x, b.z - c.z) < TORGET_BENCH_GAP_M)) {
      placer.rejected.furniture++;
      continue;
    }
    if (!placer.tryPlace(c)) continue;
    count.set(c.origin, (count.get(c.origin) ?? 0) + 1);
    if (c.origin === 'torget') torgetBenches.push(c);
    const bin = bus.binByBench.get(c.id);
    if (bin) busBins.push(bin);
  }
  return { torgetBenches, busBins };
}
