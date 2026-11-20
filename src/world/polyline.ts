// Polylines as the road meshes sample them: cut every few metres, with a tangent and side offsets at each sample.
// Pure: no three.js. RoadRibbons and the streetscape share it, so a curb sits exactly on its road's edge.
import type { Point } from './roads';

/** ribbons and streetscape strips are cut every this many metres, so they follow the terrain (m) */
export const STEP_M = 6;
/** the longest a mitred offset gets, in multiples of the plain offset; sharper bends are split instead */
export const MITRE_LIMIT = 2;

/** The polyline cut into pieces of at most `stepM`, keeping every original vertex (in order, first one included). */
export function resample(points: readonly Point[], stepM = STEP_M): Point[] {
  const q: Point[] = [points[0]];
  for (let i = 1; i < points.length; i++) {
    const a = points[i - 1];
    const b = points[i];
    const steps = Math.max(1, Math.ceil(Math.hypot(b[0] - a[0], b[1] - a[1]) / stepM));
    for (let s = 1; s <= steps; s++) q.push([a[0] + ((b[0] - a[0]) * s) / steps, a[1] + ((b[1] - a[1]) * s) / steps]);
  }
  return q;
}

/**
 * The unit tangent at sample i, from its two neighbours (one at the ends), written into `out`. A zero-length span
 * gives (0, 0), as RoadRibbons always did.
 */
function tangentAt(q: readonly Point[], i: number, out: [number, number] = [0, 0]) {
  const a = q[Math.max(0, i - 1)];
  const b = q[Math.min(q.length - 1, i + 1)];
  let dx = b[0] - a[0];
  let dz = b[1] - a[1];
  const length = Math.hypot(dx, dz) || 1;
  dx /= length;
  dz /= length;
  out[0] = dx;
  out[1] = dz;
  return out;
}

/**
 * Left and right edge of a ribbon `width` wide at sample i, with no mitre: the road ribbon's own vertices, bit for
 * bit. Left is the left of the polyline's direction, the side OSM tags call left: in this frame (x east, z south) the
 * left of a way heading north is west.
 */
export function ribbonEdges(q: readonly Point[], i: number, width: number) {
  const [dx, dz] = tangentAt(q, i);
  const nx = (-dz * width) / 2;
  const nz = (dx * width) / 2;
  return { lx: q[i][0] - nx, lz: q[i][1] - nz, rx: q[i][0] + nx, rz: q[i][1] + nz };
}

/**
 * The mitred unit normal to the right at sample i, and how far to scale an offset along it so a strip keeps its
 * width through the bend: 1 on a straight, 1 / cos(half the turn) in a bend. `scale` is NaN past MITRE_LIMIT, where
 * the strip should be split rather than spiked.
 */
export function mitreAt(q: readonly Point[], i: number) {
  const a = q[Math.max(0, i - 1)];
  const p = q[i];
  const b = q[Math.min(q.length - 1, i + 1)];
  const la = Math.hypot(p[0] - a[0], p[1] - a[1]);
  const lb = Math.hypot(b[0] - p[0], b[1] - p[1]);
  // unit directions of the segments either side; at an end, the one segment there is
  const ax = la ? (p[0] - a[0]) / la : (b[0] - p[0]) / (lb || 1);
  const az = la ? (p[1] - a[1]) / la : (b[1] - p[1]) / (lb || 1);
  const bx = lb ? (b[0] - p[0]) / lb : ax;
  const bz = lb ? (b[1] - p[1]) / lb : az;
  let tx = ax + bx;
  let tz = az + bz;
  const tl = Math.hypot(tx, tz);
  if (tl < 1e-9) return { nx: -az, nz: ax, scale: Number.NaN }; // a full U-turn
  tx /= tl;
  tz /= tl;
  // right of the direction (dx, dz) is (-dz, dx), matching ribbonEdges' r side
  const nx = -tz;
  const nz = tx;
  const cos = nx * -az + nz * ax;
  const scale = 1 / cos;
  return { nx, nz, scale: scale > MITRE_LIMIT ? Number.NaN : scale };
}

/** Length of the polyline (m). */
export function polylineLength(q: readonly Point[]) {
  let length = 0;
  for (let i = 1; i < q.length; i++) length += Math.hypot(q[i][0] - q[i - 1][0], q[i][1] - q[i - 1][1]);
  return length;
}
