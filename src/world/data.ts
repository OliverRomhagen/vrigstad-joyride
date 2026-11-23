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
  /** OSM way id (absent only in hand-made test fixtures) */
  i?: number;
  /** piece number when clipping at the world edge split the way, so `i:j` is unique */
  j?: number;
  /** service=* or footway=* subtype */
  s?: RoadUse;
  /** surface=* */
  sf?: Surface;
  /** width=* (m), when mapped */
  w?: number;
  /** sidewalk on the [left, right] of the way's own direction (OSM left and right, never driving direction) */
  sw?: [SideState, SideState];
  /** sidewalk widths [left, right] (m), 0 when not mapped */
  sww?: [number, number];
  /** sidewalk surfaces [left, right], 0 when not mapped */
  ssf?: [Surface, Surface];
  /** street parking [left, right]: where the parked cars stand */
  pk?: [StreetParking, StreetParking];
  /** street parking orientation [left, right] */
  po?: [ParkingOrientation, ParkingOrientation];
  /** lit=yes (1) or lit=no (2); absent when not mapped */
  lt?: 1 | 2;
  /** bridge=* other than no: the road crosses on a bridge (#238) */
  br?: BridgeTags;
}

export interface BridgeTags {
  /** layer=*: confirms grade separation, never an elevation */
  l?: number;
  /** bicycle=designated: a cycle bridge, with a wider deck and a higher railing */
  cy?: 1;
}

/** amenity=parking on the ground; underground, multi-storey and rooftop parking are dropped by tools/process.py */
export interface ParkingArea {
  /** OSM id of the way or relation */
  i: number;
  /** outer ring */
  p: number[];
  /** inner rings */
  h?: number[][];
  sf?: Surface;
  k: ParkingKind;
  /** capacity=* */
  cap?: number;
}

/** amenity=parking_space mapped as a polygon */
export interface ParkingSpace {
  i: number;
  p: number[];
}

/** a crossing node; `r` and `v` are the road index and vertex it sits on, absent when it is on no carriageway */
export interface Crossing {
  i: number;
  x: number;
  z: number;
  k: CrossingKind;
  kb?: Kerb;
  r?: number;
  v?: number;
}

/** a kerb=* or barrier=kerb node that is not a crossing */
export interface KerbPoint {
  i: number;
  x: number;
  z: number;
  kb: Kerb;
}

/** a mapped street lamp, bench, waste basket or bus stop (#144); way-mapped ones are their middle */
export interface FurniturePoint {
  /** OSM id: nodes and ways number separately, so it is unique only with `e` */
  i: number;
  /** the OSM element: 'w' for a way, left out for a node */
  e?: 'w';
  k: FurnitureCode;
  x: number;
  z: number;
  /** a bench's direction=*: the way a seated person faces, degrees clockwise from north */
  d?: number;
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
  /** parking areas */
  pa?: ParkingArea[];
  /** parking spaces mapped as polygons */
  ps?: ParkingSpace[];
  /** crossing nodes */
  x?: Crossing[];
  /** kerb nodes */
  kb?: KerbPoint[];
  /** mapped trees, flat [x, z, ...]; tree rows sampled every 8 m */
  t?: number[];
  /** mapped street furniture and bus stops, sorted by code and id */
  fu?: FurniturePoint[];
}

// Class codes, as tools/process.py assigns them
export const RoadClass = { PRIMARY: 0, SECONDARY: 1, STREET: 2, SERVICE: 3, TRACK: 4, PATH: 5 } as const;
export type RoadClass = (typeof RoadClass)[keyof typeof RoadClass];

export const LandUse = {
  RESIDENTIAL: 0,
  FARMLAND: 1,
  INDUSTRIAL: 2,
  GRASS: 3,
  CEMETERY: 4,
  FOREST: 5,
  PITCH: 6,
} as const;
export type LandUse = (typeof LandUse)[keyof typeof LandUse];

/** OTHER is every building that is not the church or the hotel: homes, shops, barns, sheds */
export const BuildingKind = { OTHER: 0, CHURCH: 1, HOTEL: 2 } as const;
export type BuildingKind = (typeof BuildingKind)[keyof typeof BuildingKind];

export const WaterwayKind = { RIVER: 0, STREAM: 1 } as const;
export type WaterwayKind = (typeof WaterwayKind)[keyof typeof WaterwayKind];

/** carriageway width of each road class (m), indexed by RoadClass */
export const ROAD_WIDTH_M = [9, 7.5, 5.5, 3.5, 2.6, 1.5] as const satisfies Record<RoadClass, number>;

// Streetscape codes (#187), as tools/process.py assigns them. 0 is always "not mapped".
export const RoadUse = {
  NONE: 0,
  DRIVEWAY: 1,
  PARKING_AISLE: 2,
  ALLEY: 3,
  SERVICE_OTHER: 4,
  SIDEWALK: 5,
  CROSSING: 6,
} as const;
export type RoadUse = (typeof RoadUse)[keyof typeof RoadUse];

/** UNKNOWN is a missing tag, never "no" */
export const SideState = { UNKNOWN: 0, PRESENT: 1, ABSENT: 2, SEPARATE: 3 } as const;
export type SideState = (typeof SideState)[keyof typeof SideState];

export const Surface = { UNKNOWN: 0, ASPHALT: 1, PAVING: 2, CONCRETE: 3, GRAVEL: 4, UNPAVED: 5, GRASS: 6 } as const;
export type Surface = (typeof Surface)[keyof typeof Surface];

export const StreetParking = {
  UNKNOWN: 0,
  NONE: 1,
  LANE: 2,
  STREET_SIDE: 3,
  ON_KERB: 4,
  HALF_ON_KERB: 5,
  SHOULDER: 6,
  SEPARATE: 7,
} as const;
export type StreetParking = (typeof StreetParking)[keyof typeof StreetParking];

export const ParkingOrientation = { UNKNOWN: 0, PARALLEL: 1, DIAGONAL: 2, PERPENDICULAR: 3 } as const;
export type ParkingOrientation = (typeof ParkingOrientation)[keyof typeof ParkingOrientation];

export const ParkingKind = { SURFACE: 0, STREET_SIDE: 1, CARPORTS: 2, GARAGE_BOXES: 3 } as const;
export type ParkingKind = (typeof ParkingKind)[keyof typeof ParkingKind];

/** MARKED: crossing=marked|zebra|uncontrolled, or crossing:markings present */
export const CrossingKind = { UNKNOWN: 0, MARKED: 1, UNMARKED: 2, TRAFFIC_SIGNALS: 3 } as const;
export type CrossingKind = (typeof CrossingKind)[keyof typeof CrossingKind];

export const Kerb = { UNKNOWN: 0, RAISED: 1, LOWERED: 2, FLUSH: 3, ROLLED: 4 } as const;
export type Kerb = (typeof Kerb)[keyof typeof Kerb];
/** street furniture codes (#144), as tools/process.py assigns them; bus stops are context for placement, never drawn */
export const FurnitureCode = { STREET_LAMP: 0, BENCH: 1, WASTE_BASKET: 2, BUS_STOP: 3 } as const;
export type FurnitureCode = (typeof FurnitureCode)[keyof typeof FurnitureCode];
