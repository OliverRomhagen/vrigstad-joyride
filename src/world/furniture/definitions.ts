// What each kind of street furniture is, as placement sees it: its footprint, the space it keeps and where it may
// stand (#144). Pure data: no three.js. How a kind is modelled is src/world/mesh/street-furniture.ts's business.

export type FurnitureKind = 'street-lamp' | 'bench' | 'waste-bin';
/** where a road or place is, for what furniture it gets; see context.ts */
export type FurnitureContext = 'torget' | 'centre' | 'main' | 'residential' | 'outer' | 'path';
/** osm: drawn where OpenStreetMap maps it; override: local knowledge in overrides.ts; procedural: a rule placed it */
export type FurnitureSource = 'osm' | 'override' | 'procedural';

/** Where a lamp's light would come from, for the day and night cycle (#99). Model space: origin on the ground, +z along the arm. */
export interface LampEmitter {
  offset: readonly [number, number, number];
  /** unit vector the light faces */
  direction: readonly [number, number, number];
  coneDeg: number;
  rangeM: number;
}

export interface FurnitureDefinition {
  kind: FurnitureKind;
  /** default model; context-specific variants are chosen in placement.ts */
  modelId: string;
  /** footprint (m): x across, z front to back, in model space */
  widthM: number;
  depthM: number;
  heightM: number;
  /** free space kept round the footprint from other furniture and buildings (m) */
  clearanceM: number;
  /** distance kept from any carriageway's edge, from the footprint's corners (m) */
  carriagewayClearanceM: number;
  /** distance kept from tree trunks (m) */
  treeClearanceM: number;
  /** a generated object this close to a mapped or override one of the same kind is a duplicate (m) */
  dedupeRadiusM: number;
  /** steepest ground it may stand on (degrees) */
  maxSlopeDeg: number;
  allowedContexts: readonly FurnitureContext[];
  emitter?: LampEmitter;
}

export const FURNITURE: Readonly<Record<FurnitureKind, FurnitureDefinition>> = {
  'street-lamp': {
    kind: 'street-lamp',
    modelId: 'lamp-arm',
    widthM: 0.3,
    depthM: 0.3,
    heightM: 6.5,
    clearanceM: 0.5,
    carriagewayClearanceM: 0.5,
    treeClearanceM: 1.5,
    dedupeRadiusM: 12,
    maxSlopeDeg: 15,
    allowedContexts: ['torget', 'centre', 'main', 'residential', 'path'],
    emitter: { offset: [0, 6.43, 1.25], direction: [0, -1, 0], coneDeg: 120, rangeM: 18 }, // the glass under the luminaire
  },
  bench: {
    kind: 'bench',
    modelId: 'bench-wood',
    widthM: 1.8,
    depthM: 0.6,
    heightM: 0.8,
    clearanceM: 0.6,
    carriagewayClearanceM: 1.0,
    treeClearanceM: 2.5,
    dedupeRadiusM: 4,
    maxSlopeDeg: 8,
    allowedContexts: ['torget', 'centre', 'main'],
  },
  'waste-bin': {
    kind: 'waste-bin',
    modelId: 'bin-green',
    widthM: 0.45,
    depthM: 0.45,
    heightM: 0.8,
    clearanceM: 0.3,
    carriagewayClearanceM: 0.6,
    treeClearanceM: 2.5,
    dedupeRadiusM: 4,
    maxSlopeDeg: 8,
    allowedContexts: ['torget', 'centre', 'main'],
  },
};

/** the shorter lamp on residential streets and paths, with its light lower and nearer the pole */
export const SHORT_LAMP_MODEL = 'lamp-arm-short';
export const SHORT_LAMP_EMITTER: LampEmitter = {
  offset: [0, 4.88, 1],
  direction: [0, -1, 0],
  coneDeg: 110,
  rangeM: 14,
};
