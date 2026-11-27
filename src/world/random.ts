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

/**
 * A hash of two integers in [0, 1), without building a string: for choices made by the thousand, such as each piece
 * of a hedge. The same integers always give the same number.
 */
export function hashInts(a: number, b: number) {
  let h = Math.imul(a | 0, 0x27d4eb2d) ^ Math.imul(b | 0, 0x165667b1);
  h = Math.imul(h ^ (h >>> 15), 0x85ebca6b);
  h = Math.imul(h ^ (h >>> 13), 0xc2b2ae35);
  return ((h ^ (h >>> 16)) >>> 0) / 4294967296;
}
