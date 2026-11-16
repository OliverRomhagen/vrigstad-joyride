// The shape of data/vrigstad.json, written by tools/process.py. Coordinates are metres, x east and z south;
// polylines and polygons are flat [x, z, x, z, ...] arrays.

export interface Building {
  p: number[];
  /** wall height above the highest ground under the footprint (m) */
  h: number;
  k: BuildingKind;
  /** ridge of a pitched roof over the bounding rectangle: [ax, az, bx, bz, half width] */
  g?: [number, number, number, number, number];
  /** spire height above the walls (m) */
  s?: number;
}

export interface Road {
  c: RoadClass;
  /** street name, '' when unnamed */
  n: string;
  p: number[];
}

export interface Waterway {
  k: WaterwayKind;
  p: number[];
}

export interface LandArea {
  k: LandUse;
  p: number[];
}

export interface Label {
  t: string;
  x: number;
  z: number;
  /** 'p' a place, 'w' water */
  k: string;
}

export interface WorldData {
  /** side of the square world (m) */
  size: number;
  /** elevation samples per side */
  n: number;
  /** row-major heights in decimetres */
  elev: number[];
  b: Building[];
  r: Road[];
  /** lakes: each a list of rings, the first the outline and the rest islands */
  w: number[][][];
  ww: Waterway[];
  l: LandArea[];
  labels: Label[];
}

// Class codes, as tools/process.py assigns them
export const RoadClass = { PRIMARY: 0, SECONDARY: 1, STREET: 2, SERVICE: 3, TRACK: 4, PATH: 5 } as const;
export type RoadClass = (typeof RoadClass)[keyof typeof RoadClass];

export const LandUse = { RESIDENTIAL: 0, FARMLAND: 1, INDUSTRIAL: 2, GRASS: 3, CEMETERY: 4, FOREST: 5, PITCH: 6 } as const;
export type LandUse = (typeof LandUse)[keyof typeof LandUse];

/** OTHER is every building that is not the church or the hotel: homes, shops, barns, sheds */
export const BuildingKind = { OTHER: 0, CHURCH: 1, HOTEL: 2 } as const;
export type BuildingKind = (typeof BuildingKind)[keyof typeof BuildingKind];

export const WaterwayKind = { RIVER: 0, STREAM: 1 } as const;
export type WaterwayKind = (typeof WaterwayKind)[keyof typeof WaterwayKind];

/** carriageway width of each road class (m), indexed by RoadClass */
export const ROAD_WIDTH_M = [9, 7.5, 5.5, 3.5, 2.6, 1.5] as const satisfies Record<RoadClass, number>;
