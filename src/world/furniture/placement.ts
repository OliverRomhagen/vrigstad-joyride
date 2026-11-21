// Where street lamps, benches and waste bins stand (#144). Pure: no three.js, no DOM. OpenStreetMap objects stand where
// they are mapped; overrides add local knowledge; documented rules fill in the rest, deterministically, and every
// generated object is labelled `procedural`. Placement knows each kind's footprint, never how it is modelled.
// The steps: mapped objects, override additions, lamps (lamps.ts), benches (seats.ts), bins (bins.ts), override edits.
import { FurnitureCode, RoadClass } from '../data';
import { placeBins, TORGET_BINS } from './bins';
import type { TorgetArea } from './context';
import { FURNITURE, type FurnitureKind, SHORT_LAMP_EMITTER, SHORT_LAMP_MODEL } from './definitions';
import { lampCandidates } from './lamps';
import type { FurnitureOverride } from './overrides';
import { byOrder, type FurnitureInput, type FurniturePlacement, mappedFacing, Placer, type Rejection } from './placer';
import { placeBenches, TORGET_BENCHES } from './seats';

export type { FurnitureInput, FurniturePlacement, Rejection } from './placer';

export interface FurnitureLayout {
  placements: FurniturePlacement[];
  torget: TorgetArea | null;
  /** generated candidates turned down, per check */
  rejected: Record<Rejection, number>;
  /** generated objects placed, per kind and where they came from (a road context, 'bus stop', 'church' or a park) */
  generated: Record<string, Record<FurnitureKind, number>>;
}

const MAPPED_KIND: Partial<Record<FurnitureCode, FurnitureKind>> = {
  [FurnitureCode.STREET_LAMP]: 'street-lamp',
  [FurnitureCode.BENCH]: 'bench',
  [FurnitureCode.WASTE_BASKET]: 'waste-bin',
};
/** a mapped object without a direction faces the nearest road (a lamp) or road or path (a bench or bin) within this (m) */
const MAPPED_FACE_REACH_M = 30;
/** the game's places (a safehouse door, the kiosk's lucka) keep furniture this far away, where you stand to use them (m) */
const PLACE_KEEP_M = 2.5;
const KIND_ORDER = Object.keys(FURNITURE) as FurnitureKind[];

/** The exclusion circles for the game's places, the same in the game and in the coverage report. */
export const furnitureExclusions = (places: readonly { x: number; z: number }[]) =>
  places.map(p => ({ x: p.x, z: p.z, r: PLACE_KEEP_M }));

/** Places street furniture: mapped objects first, then overrides, then the rules. The same input gives the same array. */
export function placeFurniture(inp: FurnitureInput): FurnitureLayout {
  const placer = new Placer(inp);
  placeMapped(placer);
  for (const o of inp.overrides ?? []) if (o.op === 'add') placer.placeAuthoritative(overrideAddition(o));
  for (const c of lampCandidates(placer).sort(byOrder)) placer.tryPlace(c);
  const { torgetBenches, busBins } = placeBenches(placer);
  placeBins(placer, torgetBenches, busBins);
  return {
    placements: applyOverrideEdits(placer.out, inp.overrides ?? []),
    torget: placer.torget,
    rejected: placer.rejected,
    generated: placer.generated,
  };
}

/** Mapped objects are authoritative: drawn where mapped, never moved or checked. */
function placeMapped(placer: Placer) {
  for (const f of placer.data.fu ?? []) {
    const kind = MAPPED_KIND[f.k];
    if (!kind) continue;
    placer.placeAuthoritative({
      id: `osm:${f.i}`,
      kind,
      modelId: FURNITURE[kind].modelId,
      x: f.x,
      z: f.z,
      rotationY: mappedFacing(
        placer,
        f,
        kind === 'street-lamp' ? RoadClass.TRACK : RoadClass.PATH,
        MAPPED_FACE_REACH_M,
      ),
      scale: 1,
      source: 'osm',
    });
  }
}

function overrideAddition(o: Extract<FurnitureOverride, { op: 'add' }>): FurniturePlacement {
  return {
    id: `ovr:${o.key}`,
    kind: o.kind,
    modelId: FURNITURE[o.kind].modelId,
    x: o.x,
    z: o.z,
    rotationY: o.rotationY,
    scale: 1,
    source: 'override',
  };
}

/** Override removals and moves of generated objects, then the placements as plain data, sorted by kind and id. */
function applyOverrideEdits(placed: readonly FurniturePlacement[], overrides: readonly FurnitureOverride[]) {
  let result = placed.map(
    ({ id, kind, modelId, x, z, rotationY, scale, source }): FurniturePlacement => ({
      id,
      kind,
      modelId,
      x,
      z,
      rotationY,
      scale,
      source,
    }),
  );
  for (const o of overrides) {
    if (o.op === 'remove') result = result.filter(p => p.id !== o.id);
    else if (o.op === 'move')
      result = result.map(p => (p.id === o.id ? { ...p, x: o.x, z: o.z, source: 'override' as const } : p));
  }
  return result.sort(
    (a, b) => KIND_ORDER.indexOf(a.kind) - KIND_ORDER.indexOf(b.kind) || (a.id < b.id ? -1 : a.id > b.id ? 1 : 0),
  );
}

/** How many Torget should have, for the report and tests. */
export const TORGET_TARGETS = { benches: TORGET_BENCHES, bins: TORGET_BINS } as const;

/** Where each lamp's light comes from, in world space, for the day and night cycle (#99); y is above the ground. */
export function lampEmitters(placements: readonly FurniturePlacement[]) {
  return placements
    .filter(p => p.kind === 'street-lamp')
    .map(p => {
      const e = p.modelId === SHORT_LAMP_MODEL ? SHORT_LAMP_EMITTER : FURNITURE['street-lamp'].emitter!;
      const c = Math.cos(p.rotationY);
      const s = Math.sin(p.rotationY);
      // the whole model scales, so the offset along the arm does too
      const [ox, oy, oz] = e.offset.map(v => v * p.scale);
      return {
        id: p.id,
        x: p.x + ox * c + oz * s,
        y: oy,
        z: p.z - ox * s + oz * c,
        direction: e.direction,
        coneDeg: e.coneDeg,
        rangeM: e.rangeM,
      };
    });
}
