// Silage bales in the fields (#305): a few short rows of wrapped round bales lying in each farmland area, white or green.
// Pure: no three.js.
import { LandUse } from '../data';
import { pointInPolygon, polygonArea, polygonBounds } from '../polygon';
import { fnv1a, makeRnd } from '../random';
import { BALE_MODELS } from './definitions';
import type { Candidate, Placer } from './placer';

// Artistic values, not a survey.
/** one row of bales per this much field (m²), at least one and at most ROWS_MAX a field */
const FIELD_M2_PER_ROW = 30_000;
const ROWS_MAX = 4;
/** bales in a row, and the step between their middles (m): a little gap between 1.2 m bales */
const BALES_MIN = 3,
  BALES_MAX = 6,
  BALE_STEP_M = 1.5;
/** a row's first bale keeps this far inside the field from its every edge, sampled at the row's ends (m) */
const EDGE_KEEP_M = 12;
/** tries at a spot inside a field for each row before it gives up */
const TRIES = 24;

/** Bale candidates: rows in every farmland field, laid out by hash of the field and the row. */
export function baleCandidates(placer: Placer): Candidate[] {
  const out: Candidate[] = [];
  for (const area of placer.data.l) {
    if (area.k !== LandUse.FARMLAND) continue;
    const ring = area.p;
    const field = `${Math.round(ring[0])},${Math.round(ring[1])}`;
    const { x0, x1, z0, z1 } = polygonBounds(ring);
    const inside = (x: number, z: number) =>
      pointInPolygon(ring, x, z) &&
      pointInPolygon(ring, x + EDGE_KEEP_M, z) &&
      pointInPolygon(ring, x - EDGE_KEEP_M, z) &&
      pointInPolygon(ring, x, z + EDGE_KEEP_M) &&
      pointInPolygon(ring, x, z - EDGE_KEEP_M);
    const rows = Math.min(ROWS_MAX, Math.max(1, Math.floor(polygonArea(ring) / FIELD_M2_PER_ROW)));
    for (let row = 0; row < rows; row++) {
      const key = `${field}:${row}`;
      // a stream of its own per row: hash01 of keys that differ only in their last characters comes out nearly the same
      const rnd = makeRnd(fnv1a(key));
      const n = BALES_MIN + Math.floor(rnd() * (BALES_MAX - BALES_MIN + 1)),
        h = rnd() * Math.PI,
        dx = Math.sin(h) * BALE_STEP_M,
        dz = Math.cos(h) * BALE_STEP_M,
        modelId = BALE_MODELS[rnd() < 0.7 ? 0 : 1]; // mostly white, some green
      for (let t = 0; t < TRIES; t++) {
        const x = x0 + rnd() * (x1 - x0),
          z = z0 + rnd() * (z1 - z0);
        if (!inside(x, z) || !inside(x + dx * (n - 1), z + dz * (n - 1))) continue;
        for (let i = 0; i < n; i++)
          out.push({
            id: `gen:silage-bale:${key}:${i}`,
            kind: 'silage-bale',
            modelId,
            x: x + dx * i,
            z: z + dz * i,
            rotationY: h, // lying across the row, flat ends to the neighbours
            scale: 1,
            source: 'procedural',
            rank: 0,
            origin: 'outer',
            ri: -1,
          });
        break;
      }
    }
  }
  return out;
}
