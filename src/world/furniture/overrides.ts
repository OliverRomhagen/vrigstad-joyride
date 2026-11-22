// Local knowledge that isn't in OpenStreetMap yet (#144): add, remove or move street furniture. Mapping it in OSM is
// the better fix; an entry here says why it is needed. Ships empty.
import type { FurnitureKind } from './definitions';

export type FurnitureOverride =
  | { op: 'add'; key: string; kind: FurnitureKind; x: number; z: number; rotationY: number; note: string }
  /** a generated placement's id, as the hook and ?debug=furniture show it */
  | { op: 'remove'; id: string; note: string }
  | { op: 'move'; id: string; x: number; z: number; note: string };

export const FURNITURE_OVERRIDES: readonly FurnitureOverride[] = [];
