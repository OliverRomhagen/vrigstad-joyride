// What a house has at its street (#305): a mailbox at the property line, wheelie bins against the wall facing the
// street, a shared mailbox stand in the outskirts, and a street cabinet in the verge now and then. Pure: no three.js.
// Artistic values, not a survey of Vrigstad. houses.ts works out which street each house fronts.
import { ROAD_WIDTH_M } from '../data';
import { pointAtArc } from '../polyline';
import { hash01 } from '../random';
import { sidewalkCentreM } from '../streetscape';
import { FURNITURE, type FurnitureKind, type FurnitureModelId } from './definitions';
import { type HouseFront, houseFronts } from './houses';
import { byOrder, type Candidate, heading, jitterRad, type Placer } from './placer';

/** the property line: this far past a sidewalk's outer edge, or past the carriageway's edge without one (m) */
const HOUSE_PAST_SIDEWALK_M = 0.3;
const HOUSE_LINE_M = 1.4;
/** without a mapped driveway, the bins and the mailbox stand this far either side of the point opposite the house (m) */
const HOUSE_SPLIT_M = 1.2;
/** a driveway opening this close along the street to a house's front is that house's (m) */
const DRIVEWAY_MATCH_M = 6;
/** the wheelie bins stand this far out from the house's wall, about this far along it from the point nearest the street (m) */
const BIN_WALL_GAP_M = 0.25;
const BIN_ALONG_WALL_M = 1.2;
/** ... kept this far in from the wall's ends (m) */
const BIN_WALL_END_M = 0.4;
/** a second wheelie bin with this chance, this far along from the first (m) */
const SECOND_BIN_SHARE = 0.6;
const BIN_GAP_M = 0.75;
/** a wheelie bin turns at most this much either way from facing the street (rad) */
const WHEELIE_JITTER_RAD = (10 * Math.PI) / 180;
/** a street cabinet after every this many houses along a street, from MIN to MIN + SPREAD - 1, by hash */
const CABINET_EVERY_MIN = 4;
const CABINET_EVERY_SPREAD = 3;
/** in the outskirts, houses this close along a road share one mailbox stand when there are at least STAND_MIN (m) */
const STAND_REACH_M = 150;
const STAND_MIN = 3;
const STAND_MAX = 6;
/** wheelie bins: green or black, by hash */
const WHEELIE_MODELS = ['wheelie-bin-green', 'wheelie-bin-black'] as const;
/** mailboxes: green, grey or black, by hash */
const MAILBOX_MODELS = ['mailbox-green', 'mailbox-grey', 'mailbox-black'] as const;

/**
 * The outline's edge nearest (x, z): its start, unit tangent, length, outward normal (towards (x, z)) and how far along
 * it the nearest point is. Null for a degenerate outline.
 */
function nearestWall(p: readonly number[], x: number, z: number) {
  let best: {
    ax: number;
    az: number;
    tx: number;
    tz: number;
    nx: number;
    nz: number;
    len: number;
    u: number;
    d: number;
  } | null = null;
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

/** Places each house's mailbox and wheelie bins, the outskirts' mailbox stands and the street cabinets. */
export function placeHomeItems(placer: Placer) {
  const { contexts, roadKeys, arcLengthsByRoad } = placer;
  const { roads, street } = placer.input;
  // the property line on road ri's `side`, to the middle of `kind`'s footprint (m)
  const houseLine = (ri: number, side: -1 | 1, kind: FurnitureKind) => {
    const c = roads.lines[ri].c;
    const halfDepth = FURNITURE[kind].depthM / 2;
    if (!placer.hasSidewalk(ri, side)) return ROAD_WIDTH_M[c] / 2 + HOUSE_LINE_M + halfDepth;
    const spec = placer.sideSpec(ri, side);
    return sidewalkCentreM(spec, c)! + spec.widthM / 2 + HOUSE_PAST_SIDEWALK_M + halfDepth;
  };
  // how far either side of the front the house's things stand: past the driveway's lowered curb when there is one
  const split = (f: HouseFront) => {
    const o = street.openings.find(
      o => o.ri === f.ri && o.side === f.side && Math.abs(o.s - f.s) < DRIVEWAY_MATCH_M && o.kind === 'driveway',
    );
    return o ? o.half + 1 : HOUSE_SPLIT_M;
  };
  const mailboxModel = (id: string): FurnitureModelId => MAILBOX_MODELS[Math.floor(hash01(id, 'colour') * 3)];
  const mailbox = (f: HouseFront, alongM: number, origin: 'house' | 'outskirts') => {
    const c = placer.roadside({
      kind: 'mailbox',
      ri: f.ri,
      side: f.side,
      alongM,
      offsetM: houseLine(f.ri, f.side, 'mailbox'),
      id: `gen:mailbox:${f.key}`,
      origin,
      maxJitterRad: 0,
    });
    return c && { ...c, modelId: mailboxModel(c.id) };
  };

  const fronts = houseFronts(placer.data, roads, ri => contexts[ri] !== 'path');
  const candidates: Candidate[] = [];
  const outskirts = new Map<string, HouseFront[]>();
  for (const f of fronts) {
    if (contexts[f.ri] === 'outer') {
      const k = `${f.ri}:${f.side}`;
      outskirts.set(k, [...(outskirts.get(k) ?? []), f]);
      continue;
    }
    const c = mailbox(f, f.s - split(f) - FURNITURE.mailbox.widthM / 2, 'house');
    if (c) candidates.push(c);
  }
  // the wheelie bins stand at the house, back to the wall that faces the street; they go out to the kerb only on collection day
  for (const f of fronts) {
    const at = pointAtArc(roads.lines[f.ri].p, arcLengthsByRoad[f.ri], f.s);
    const wall = nearestWall(f.p, at.x, at.z);
    if (!wall) continue;
    const bins = hash01(f.key, 'bins') < SECOND_BIN_SHARE ? 2 : 1;
    const way = hash01(f.key, 'bin side') < 0.5 ? -1 : 1;
    const standOff = BIN_WALL_GAP_M + FURNITURE['wheelie-bin'].depthM / 2;
    for (let n = 0; n < bins; n++) {
      const id = `gen:wheelie-bin:${f.key}:${n}`;
      const u = Math.max(
        BIN_WALL_END_M,
        Math.min(wall.len - BIN_WALL_END_M, wall.u + way * (BIN_ALONG_WALL_M + n * BIN_GAP_M)),
      );
      candidates.push({
        id,
        kind: 'wheelie-bin',
        modelId: WHEELIE_MODELS[hash01(id, 'colour') < 0.5 ? 0 : 1],
        x: wall.ax + wall.tx * u + wall.nx * standOff,
        z: wall.az + wall.tz * u + wall.nz * standOff,
        rotationY: heading(wall.nx, wall.nz) + jitterRad(id, WHEELIE_JITTER_RAD),
        scale: 1,
        source: 'procedural',
        rank: 1,
        origin: 'house',
        ri: f.ri,
      });
    }
  }
  // in the outskirts, a stand of mailboxes where a few houses share a stretch of road; one each where they don't
  for (const list of outskirts.values()) {
    list.sort((a, b) => a.s - b.s);
    for (let i = 0; i < list.length; ) {
      let j = i;
      while (j + 1 < list.length && list[j + 1].s - list[i].s <= STAND_REACH_M) j++;
      const group = list.slice(i, j + 1);
      const f = group[0];
      if (group.length >= STAND_MIN) {
        const n = Math.min(STAND_MAX, group.length) as 3 | 4 | 5 | 6;
        const c = placer.roadside({
          kind: 'mailbox-stand',
          ri: f.ri,
          side: f.side,
          alongM: f.s,
          offsetM: houseLine(f.ri, f.side, 'mailbox-stand'),
          id: `gen:mailbox-stand:${f.key}`,
          origin: 'outskirts',
          maxJitterRad: 0,
        });
        if (c) candidates.push({ ...c, modelId: `mailbox-stand-${n}` });
      } else
        for (const g of group) {
          const c = mailbox(g, g.s - split(g), 'outskirts');
          if (c) candidates.push(c);
        }
      i = j + 1;
    }
  }
  // a street cabinet in the verge after every few houses along a street, between two of them
  const byStreet = new Map<number, HouseFront[]>();
  for (const f of fronts) if (contexts[f.ri] !== 'outer') byStreet.set(f.ri, [...(byStreet.get(f.ri) ?? []), f]);
  for (const [ri, list] of byStreet) {
    list.sort((a, b) => a.s - b.s);
    const every = CABINET_EVERY_MIN + Math.floor(hash01(roadKeys[ri], 'cabinets') * CABINET_EVERY_SPREAD);
    for (let n = every - 1; n + 1 < list.length; n += every) {
      const a = list[n];
      const c = placer.roadside({
        kind: 'street-cabinet',
        ri,
        side: a.side,
        alongM: (a.s + list[n + 1].s) / 2,
        offsetM: houseLine(ri, a.side, 'street-cabinet'),
        id: `gen:street-cabinet:${roadKeys[ri]}:${n}`,
        origin: 'street',
        maxJitterRad: 0,
      });
      if (c) candidates.push({ ...c, rank: 2 });
    }
  }
  for (const c of candidates.sort(byOrder)) placer.tryPlace(c);
}
