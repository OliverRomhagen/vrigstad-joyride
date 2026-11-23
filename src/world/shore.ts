// The shore along every lake and river, cut into stretches with a type (stony, reedy, sandy, grassy), and where its
// reeds and stones stand (#263). Pure: no three.js. Every choice hashes the body's key and the stretch's index, never
// the game's rnd() or data order, so the shore shifts no other roll.
import { fnv1a, hash01 } from './random';
import { type WaterBodies, wander } from './water-shapes';

export type ShoreType = 'stony' | 'reedy' | 'sandy' | 'grassy';

export interface ShoreStretch {
  /** the body's key */
  body: string;
  /** the middle of the stretch on the waterline */
  x: number;
  z: number;
  /** unit vector from the water onto the land */
  nx: number;
  nz: number;
  /** along the waterline, unit */
  tx: number;
  tz: number;
  type: ShoreType;
  lake: boolean;
}

export interface ShoreLayout {
  stretches: ShoreStretch[];
  /** reed clumps, four numbers each: x, z, scale, turn (radians) */
  reeds: number[];
  /** stones, four numbers each: x, z, scale, turn */
  stones: number[];
}

/** the shore is cut into stretches this long (m) */
export const STRETCH_M = 8;
/** how far up the bank its steepness is measured (m) */
const SLOPE_PROBE_M = 3;
/** steeper than this (rise per metre), a bank is stony; gentler than the next two, it may be sandy or reedy */
const STONY_SLOPE = 0.42;
const SANDY_SLOPE = 0.22;
const REEDY_SLOPE = 0.32;
/** the shares of gentle shore that are sand (lakes only) and reeds, in runs that wander along the shore over these spans (m) */
const SAND_SHARE = 0.35;
const SAND_RUN_M = 60;
const REED_SHARE = 0.5;
const REED_RUN_M = 45;
/** reed clumps per reedy stretch, and stones per stony one: at least the first, up to the first plus the second */
const REEDS = [1, 3] as const;
const STONES = [1, 3] as const;
/** how far a prop stands from the waterline, into the water (negative) to up the bank (m) */
const REED_ACROSS_M = [-1.4, 0.5] as const;
const STONE_ACROSS_M = [-0.6, 1.1] as const;

/**
 * Lays out the shores of the bodies. `base` is the uncut ground the bodies were built on; the bank's steepness is
 * read from the cut. Roads and buildings near the water make a shore stony, as their embankments are.
 */
export function layoutShore(
  bodies: WaterBodies,
  base: { heightAt(x: number, z: number): number },
  /** where no prop may stand: under a bridge deck (#238), whose structure a reed would grow through */
  keepOut: (x: number, z: number) => boolean = () => false,
): ShoreLayout {
  const stretches: ShoreStretch[] = [];
  const ground = (x: number, z: number) => bodies.cutAt(x, z, base.heightAt(x, z));
  const classify = (
    body: string,
    i: number,
    x: number,
    z: number,
    nx: number,
    nz: number,
    level: number,
    lake: boolean,
  ) => {
    const slope = (ground(x + nx * SLOPE_PROBE_M, z + nz * SLOPE_PROBE_M) - level) / SLOPE_PROBE_M;
    const seed = fnv1a(body);
    const along = i * STRETCH_M;
    if (slope > STONY_SLOPE || bodies.keepWeight(x + nx * 2, z + nz * 2) < 1) return 'stony';
    if (lake && slope < SANDY_SLOPE && wander(seed ^ 0x5a, along / SAND_RUN_M) < SAND_SHARE) return 'sandy';
    if (slope < REEDY_SLOPE && wander(seed ^ 0xa5, along / REED_RUN_M) < REED_SHARE) return 'reedy';
    return 'grassy';
  };

  // lakes: along each ring, past the world's edge
  for (const lake of bodies.lakes)
    for (const r of lake.rings) {
      const run: ShoreStretch[] = [];
      for (let v = 0; v < r.length; v += 2) {
        const w = (v + 2) % r.length;
        const [ax, az, bx, bz] = [r[v], r[v + 1], r[w], r[w + 1]];
        const len = Math.hypot(bx - ax, bz - az);
        if (!len || bodies.onWorldEdge(ax, az, bx, bz)) continue;
        const tx = (bx - ax) / len;
        const tz = (bz - az) / len;
        for (let t = STRETCH_M / 2; t < len; t += STRETCH_M) {
          const px = ax + tx * t;
          const pz = az + tz * t;
          // onto the land is whichever side isn't this lake
          const side = bodies.lakeAt(px - tz, pz + tx) === bodies.lakes.indexOf(lake) ? -1 : 1;
          const nx = -tz * side;
          const nz = tx * side;
          const i = run.length;
          run.push({
            body: lake.key,
            x: px,
            z: pz,
            nx,
            nz,
            tx,
            tz,
            type: classify(lake.key, i, px, pz, nx, nz, lake.level, true),
            lake: true,
          });
        }
      }
      stretches.push(...smooth(run));
    }

  // rivers and streams: both banks, outside lakes
  for (const c of bodies.courses) {
    const step = Math.max(1, Math.round(STRETCH_M / (c.s[1] - c.s[0] || STRETCH_M)));
    for (const side of [-1, 1]) {
      const run: ShoreStretch[] = [];
      for (let k = step; k < c.x.length - 1; k += step) {
        if (c.lake[k] >= 0) {
          stretches.push(...smooth(run.splice(0)));
          continue;
        }
        const tx0 = c.x[k + 1] - c.x[k - 1];
        const tz0 = c.z[k + 1] - c.z[k - 1];
        const tl = Math.hypot(tx0, tz0) || 1;
        const tx = tx0 / tl;
        const tz = tz0 / tl;
        // right of the flow is (-tz, tx)
        const nx = -tz * side;
        const nz = tx * side;
        const x = c.x[k] + nx * c.half[k];
        const z = c.z[k] + nz * c.half[k];
        const key = `${c.key}:${side}`;
        run.push({
          body: key,
          x,
          z,
          nx,
          nz,
          tx,
          tz,
          type: classify(key, k, x, z, nx, nz, c.level[k], false),
          lake: false,
        });
      }
      stretches.push(...smooth(run));
    }
  }

  const reeds: number[] = [];
  const stones: number[] = [];
  stretches.forEach((st, i) => {
    const props = st.type === 'reedy' ? reeds : st.type === 'stony' ? stones : null;
    if (!props) return;
    const [min, extra] = st.type === 'reedy' ? REEDS : STONES;
    const [lo, hi] = st.type === 'reedy' ? REED_ACROSS_M : STONE_ACROSS_M;
    const count = min + Math.floor(hash01(st.body, i, 'n') * (extra + 1));
    for (let j = 0; j < count; j++) {
      const along = (hash01(st.body, i, j, 'a') - 0.5) * STRETCH_M;
      const across = lo + (hi - lo) * hash01(st.body, i, j, 'c');
      const x = st.x + st.tx * along + st.nx * across;
      const z = st.z + st.tz * along + st.nz * across;
      if (keepOut(x, z)) continue;
      props.push(x, z, 0.7 + hash01(st.body, i, j, 's') * 0.6, hash01(st.body, i, j, 'r') * Math.PI * 2);
    }
  });
  return { stretches, reeds, stones };
}

/** A run of stretches with no single stretch of a type between two of another: it takes its neighbours' type. */
function smooth(run: ShoreStretch[]) {
  for (let i = 1; i < run.length - 1; i++)
    if (run[i - 1].type === run[i + 1].type && run[i].type !== run[i - 1].type) run[i].type = run[i - 1].type;
  return run;
}
