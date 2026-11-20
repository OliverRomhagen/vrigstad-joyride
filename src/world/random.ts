export type Rnd = () => number;

/** A seeded stream of numbers in [0, 1) (mulberry32). The same seed always gives the same sequence. */
export function makeRnd(seed: number): Rnd {
  return () => {
    seed |= 0;
    seed = (seed + 0x6d2b79f5) | 0;
    let t = Math.imul(seed ^ (seed >>> 15), 1 | seed);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/**
 * FNV-1a over the parts' text, as an unsigned 32-bit number. For choices that must follow a feature's identity (an
 * OSM id) rather than the order things are built in, so they don't shift when other features change.
 */
export function fnv1a(...parts: (number | string)[]) {
  const s = parts.join(':');
  let h = 0x811c9dc5;
  for (let i = 0; i < s.length; i++) {
    h ^= s.charCodeAt(i);
    h = Math.imul(h, 0x01000193);
  }
  return h >>> 0;
}

/** fnv1a scaled to [0, 1) */
export const hash01 = (...parts: (number | string)[]) => fnv1a(...parts) / 4294967296;
