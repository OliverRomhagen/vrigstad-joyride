// What a house has at its street (#305): a mailbox at the property line, wheelie bins against the wall facing the
// street, a shared mailbox stand in the outskirts, and a street cabinet in the verge now and then. Pure: no three.js.
// Artistic values, not a survey of Vrigstad. houses.ts works out which street each house fronts.
import { ROAD_WIDTH_M, RoadClass } from '../data';
import { pointAtArc } from '../polyline';
import { hash01 } from '../random';
import { FURNITURE, type FurnitureModelId } from './definitions';
import { type HouseFront, houseFronts } from './houses';
import { byOrder, type Candidate, heading, jitterRad, type Placer } from './placer';

/** the property line, where the mailbox stands: this far past a sidewalk's outer edge (m) */
export const HOUSE_PAST_SIDEWALK_M = 0.3;
/** ... or, without a sidewalk, this far past the carriageway's edge (m) */
export const HOUSE_LINE_M = 1.4;
/** without a mapped driveway, the mailbox stands this far along the street from the point opposite the house (m) */
const HOUSE_SPLIT_M = 1.2;
/** a driveway opening this close along the street to a house's front is that house's (m) */
const DRIVEWAY_MATCH_M = 6;
/** a mapped driveway's half width (m), which the wheelie bins keep clear of where it meets the house */
const DRIVEWAY_HALF_M = ROAD_WIDTH_M[RoadClass.SERVICE] / 2;
/** ... with this much to spare past the bin's own clearance from a carriageway (m) */
const BIN_DRIVEWAY_SPARE_M = 0.15;
/** the wheelie bins stand this far out from the house's wall (m) */
const BIN_WALL_GAP_M = 0.25;
/** the first wheelie bin stands this far along the wall from the point nearest the street (m) */
const BIN_ALONG_WALL_M = 1.2;
/** the wheelie bins keep this far in from the wall's ends (m) */
const BIN_WALL_END_M = 0.4;
/** a second wheelie bin with this chance */
const SECOND_BIN_SHARE = 0.6;
/**
 * the second wheelie bin stands this far along from the first (m): two bins' width and clearance, turned their
 * WHEELIE_JITTER_RAD either way, need about 0.87 m, or the placer turns the second one down
 */
const BIN_GAP_M = 0.9;
/** a wheelie bin turns at most this much either way from facing the street (rad) */
const WHEELIE_JITTER_RAD = (10 * Math.PI) / 180;
/** a street cabinet after every this many houses along a street, from MIN to MIN + SPREAD - 1, by hash */
const CABINET_EVERY_MIN = 4;
const CABINET_EVERY_SPREAD = 3;
/** in the outskirts, houses this close along a road share one mailbox stand (m) */
const STAND_REACH_M = 150;
/** the mailbox stand for each number of houses it serves; fewer than the smallest get a mailbox each */
const STAND_MODELS = {
  3: 'mailbox-stand-3',
  4: 'mailbox-stand-4',
  5: 'mailbox-stand-5',
  6: 'mailbox-stand-6',
} as const satisfies Record<number, FurnitureModelId>;
const STAND_SIZES = Object.keys(STAND_MODELS).map(Number);
const STAND_MIN = Math.min(...STAND_SIZES);
const STAND_MAX = Math.max(...STAND_SIZES);
/** wheelie bins: green or black, by hash */
const WHEELIE_MODELS = ['wheelie-bin-green', 'wheelie-bin-black'] as const;
/** mailboxes: green, grey or black, by hash */
const MAILBOX_MODELS = ['mailbox-green', 'mailbox-grey', 'mailbox-black'] as const;
// The order the candidates are tried in, lowest first (placer.ts' byOrder): the mailboxes and stands, which a house
// can't do without, then the bins, and the cabinets last, in whatever room is left.
const BIN_RANK = 1;
const CABINET_RANK = 2;

/** A wall of a house's outline: its start, unit tangent, length, outward normal, and a point on it, `u` m along. */
interface Wall {
  ax: number;
  az: number;
  tx: number;
  tz: number;
  nx: number;
  nz: number;
  len: number;
  u: number;
  /** how far the point is from the one the wall was looked for from (m) */
  d: number;
}

/** The outline's edge nearest (x, z), with its normal towards (x, z) and the nearest point on it; null when degenerate. */
function nearestWall(p: readonly number[], x: number, z: number): Wall | null {
  let best: Wall | null = null;
  for (let i = 0, j = p.length - 2; i < p.length; j = i, i += 2) {
    const ax = p[j];
    const az = p[j + 1];
    const len = Math.hypot(p[i] - ax, p[i + 1] - az);
    if (len < 1) continue;
    const tx = (p[i] - ax) / len;
    const tz = (p[i + 1] - az) / len;
    const u = Math.max(0, Math.min(len, (x - ax) * tx + (z - az) * tz));
    const d = Math.hypot(ax + tx * u - x, az + tz * u - z);
    if (best && d >= best.d) continue;
    const toward = (x - ax) * -tz + (z - az) * tx > 0 ? 1 : -1; // the normal on the side of (x, z)
    best = { ax, az, tx, tz, nx: -tz * toward, nz: tx * toward, len, u, d };
  }
  return best;
}

/** One of `list`, picked by the hash of `parts`. */
const pickByHash = <T>(list: readonly T[], ...parts: string[]) => list[Math.floor(hash01(...parts) * list.length)];

/** Adds `item` to `key`'s list in `map`. */
function push<K, V>(map: Map<K, V[]>, key: K, item: V) {
  const list = map.get(key);
  if (list) list.push(item);
  else map.set(key, [item]);
}

/** The property line on road ri's `side`, out from its centre line to the middle of `kind`'s footprint (m). */
const houseLineM = (placer: Placer, ri: number, side: -1 | 1, kind: 'mailbox' | 'mailbox-stand' | 'street-cabinet') =>
  placer.seatOffset(ri, side, kind, HOUSE_LINE_M, HOUSE_PAST_SIDEWALK_M);

/** A house's own mailbox at the property line, beside its driveway's lowered curb when it has one. */
function mailbox(placer: Placer, f: HouseFront, origin: 'house' | 'outer'): Candidate | null {
  const split = placer.drivewayClearM(f.ri, f.side, f.alongM, DRIVEWAY_MATCH_M) ?? HOUSE_SPLIT_M;
  const c = placer.roadside({
    kind: 'mailbox',
    ri: f.ri,
    side: f.side,
    alongM: f.alongM - split - FURNITURE.mailbox.widthM / 2,
    offsetM: houseLineM(placer, f.ri, f.side, 'mailbox'),
    id: `gen:mailbox:${f.key}`,
    origin,
    maxJitterRad: 0,
  });
  return c && { ...c, modelId: pickByHash(MAILBOX_MODELS, c.id, 'colour') };
}

/** Where along `wall` each of `count` bins stands, `startM` from its nearest point and on; past an end, the other way. */
function binSpots(wall: Wall, alongSign: -1 | 1, startM: number, count: number) {
  const spots: number[] = [];
  for (let k = 0; k < count; k++) {
    const offsetM = startM + k * BIN_GAP_M;
    const fits = (u: number) => u >= BIN_WALL_END_M && u <= wall.len - BIN_WALL_END_M;
    const u = [wall.u + alongSign * offsetM, wall.u - alongSign * offsetM].find(fits);
    if (u !== undefined && !spots.includes(u)) spots.push(u);
  }
  return spots;
}

/** A house's wheelie bins, back to the wall that faces the street; they go out to the kerb only on collection day. */
function binsAt(f: HouseFront, wall: Wall): Candidate[] {
  const { widthM, depthM, carriagewayClearanceM } = FURNITURE['wheelie-bin'];
  const count = hash01(f.key, 'bins') < SECOND_BIN_SHARE ? 2 : 1;
  const alongSign = hash01(f.key, 'bin side') < 0.5 ? -1 : 1;
  // a driveway reaches the wall near its nearest point, so the bins stand past it
  const startM = f.atDriveway
    ? Math.max(BIN_ALONG_WALL_M, DRIVEWAY_HALF_M + carriagewayClearanceM + widthM / 2 + BIN_DRIVEWAY_SPARE_M)
    : BIN_ALONG_WALL_M;
  const standOffM = BIN_WALL_GAP_M + depthM / 2;
  return binSpots(wall, alongSign, startM, count).map((u, k) => {
    const id = `gen:wheelie-bin:${f.key}:${k}`;
    return {
      id,
      kind: 'wheelie-bin',
      modelId: pickByHash(WHEELIE_MODELS, id, 'colour'),
      x: wall.ax + wall.tx * u + wall.nx * standOffM,
      z: wall.az + wall.tz * u + wall.nz * standOffM,
      rotationY: heading(wall.nx, wall.nz) + jitterRad(id, WHEELIE_JITTER_RAD),
      scale: 1,
      source: 'procedural',
      rank: BIN_RANK,
      origin: 'house',
      ri: f.ri,
    };
  });
}

/** Every house's wheelie bins, against the wall nearest its front on the street. */
function wheelieBins(placer: Placer, fronts: readonly HouseFront[]) {
  return fronts.flatMap(f => {
    const at = pointAtArc(placer.input.roads.lines[f.ri].p, placer.arcLengthsByRoad[f.ri], f.alongM);
    const wall = nearestWall(f.outline, at.x, at.z);
    return wall ? binsAt(f, wall) : [];
  });
}

/** Houses along one side of a road, in order, split into groups of up to STAND_MAX within STAND_REACH_M of the first. */
function standGroups(houses: readonly HouseFront[]) {
  const sorted = [...houses].sort((a, b) => a.alongM - b.alongM);
  const groups: HouseFront[][] = [];
  for (const f of sorted) {
    const group = groups.at(-1);
    // a full stand ends the group, so the houses after it start the next one rather than going without
    if (group && group.length < STAND_MAX && f.alongM - group[0].alongM <= STAND_REACH_M) group.push(f);
    else groups.push([f]);
  }
  return groups;
}

/**
 * In the outskirts, a stand of mailboxes where a few houses share a stretch of road, and a mailbox each where they
 * don't. `fallback` holds each stand's houses' own mailboxes, for when the stand can't stand.
 */
function outskirtsMailboxes(placer: Placer, byRoadSide: ReadonlyMap<string, HouseFront[]>) {
  const stands: Candidate[] = [];
  const mailboxes: Candidate[] = [];
  const fallback = new Map<string, Candidate[]>();
  for (const houses of byRoadSide.values())
    for (const group of standGroups(houses)) {
      const own = group.flatMap(f => mailbox(placer, f, 'outer') ?? []);
      if (group.length < STAND_MIN) {
        mailboxes.push(...own);
        continue;
      }
      const [first] = group;
      const stand = placer.roadside({
        kind: 'mailbox-stand',
        ri: first.ri,
        side: first.side,
        alongM: (first.alongM + group[group.length - 1].alongM) / 2, // in the middle of the houses it serves
        offsetM: houseLineM(placer, first.ri, first.side, 'mailbox-stand'),
        id: `gen:mailbox-stand:${first.key}`,
        origin: 'outer',
        maxJitterRad: 0,
      });
      if (!stand) {
        mailboxes.push(...own);
        continue;
      }
      stands.push({ ...stand, modelId: STAND_MODELS[group.length as keyof typeof STAND_MODELS] }); // STAND_MIN..STAND_MAX
      fallback.set(stand.id, own);
    }
  return { candidates: [...stands, ...mailboxes], fallback };
}

/** A street cabinet in the verge after every few houses along a street, between two of them. */
function streetCabinets(placer: Placer, byStreet: ReadonlyMap<number, HouseFront[]>) {
  const out: Candidate[] = [];
  for (const [ri, houses] of byStreet) {
    const sorted = [...houses].sort((a, b) => a.alongM - b.alongM);
    const every = CABINET_EVERY_MIN + Math.floor(hash01(placer.roadKeys[ri], 'cabinets') * CABINET_EVERY_SPREAD);
    for (let h = every - 1; h + 1 < sorted.length; h += every) {
      const after = sorted[h];
      const c = placer.roadside({
        kind: 'street-cabinet',
        ri,
        side: after.side,
        alongM: (after.alongM + sorted[h + 1].alongM) / 2,
        offsetM: houseLineM(placer, ri, after.side, 'street-cabinet'),
        id: `gen:street-cabinet:${after.key}`, // by the house it follows, so a house mapped upstream doesn't renumber it
        origin: placer.contexts[ri],
        maxJitterRad: 0,
      });
      if (c) out.push({ ...c, rank: CABINET_RANK });
    }
  }
  return out;
}

/** Places each house's mailbox and wheelie bins, the outskirts' mailbox stands and the street cabinets. */
export function placeHomeItems(placer: Placer) {
  const { contexts } = placer;
  const fronts = houseFronts(placer.data, placer.input.roads, ri => contexts[ri] !== 'path');
  const village: HouseFront[] = [];
  const outskirts = new Map<string, HouseFront[]>(); // by road and side
  const byStreet = new Map<number, HouseFront[]>(); // the village's, by road
  for (const f of fronts)
    if (contexts[f.ri] === 'outer') push(outskirts, `${f.ri}:${f.side}`, f);
    else {
      village.push(f);
      push(byStreet, f.ri, f);
    }
  const stands = outskirtsMailboxes(placer, outskirts);
  const candidates = [
    ...village.flatMap(f => mailbox(placer, f, 'house') ?? []),
    ...wheelieBins(placer, fronts),
    ...stands.candidates,
    ...streetCabinets(placer, byStreet),
  ];
  const turnedDown: Candidate[] = [];
  for (const c of candidates.sort(byOrder)) if (!placer.tryPlace(c)) turnedDown.push(c);
  // a stand that couldn't stand (a tree, a junction, a slope): its houses get a mailbox each after all
  for (const c of turnedDown) for (const m of stands.fallback.get(c.id) ?? []) placer.tryPlace(m);
}
