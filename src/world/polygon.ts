// Geometry on flat [x, z, x, z, ...] arrays, in metres.
import { clamp } from './math';

/** Even-odd test: true when (x, z) is inside the polygon. */
export function pointInPolygon(p: number[], x: number, z: number) {
  let inside = false;
  for (let i = 0, j = p.length - 2; i < p.length; j = i, i += 2) {
    if (p[i + 1] > z !== p[j + 1] > z && x < ((p[j] - p[i]) * (z - p[i + 1])) / (p[j + 1] - p[i + 1]) + p[i]) inside = !inside;
  }
  return inside;
}

export interface Bounds {
  x0: number;
  x1: number;
  z0: number;
  z1: number;
}

/** Grows `into` to cover the polygon, and returns it; with no `into`, the polygon's own bounding box. */
export function polygonBounds(p: number[], into: Bounds = { x0: Infinity, x1: -Infinity, z0: Infinity, z1: -Infinity }) {
  for (let i = 0; i < p.length; i += 2) {
    into.x0 = Math.min(into.x0, p[i]);
    into.x1 = Math.max(into.x1, p[i]);
    into.z0 = Math.min(into.z0, p[i + 1]);
    into.z1 = Math.max(into.z1, p[i + 1]);
  }
  return into;
}

/** Where along the segment from (ax, az) to (bx, bz) the point nearest (x, z) lies, from 0 at a to 1 at b. */
export function segmentParam(x: number, z: number, ax: number, az: number, bx: number, bz: number) {
  const dx = bx - ax;
  const dz = bz - az;
  const lengthSq = dx * dx + dz * dz;
  return lengthSq ? clamp(((x - ax) * dx + (z - az) * dz) / lengthSq, 0, 1) : 0;
}

/** Distance from (x, z) to the segment from (ax, az) to (bx, bz). */
export function segmentDistance(x: number, z: number, ax: number, az: number, bx: number, bz: number) {
  const t = segmentParam(x, z, ax, az, bx, bz);
  return Math.hypot(x - ax - (bx - ax) * t, z - az - (bz - az) * t);
}

/** Area of the polygon (m²), whichever way it winds. */
export function polygonArea(p: number[]) {
  let twice = 0;
  for (let i = 0, j = p.length - 2; i < p.length; j = i, i += 2) twice += p[j] * p[i + 1] - p[i] * p[j + 1];
  return Math.abs(twice / 2);
}
