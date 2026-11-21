export const clamp = (v: number, lo: number, hi: number) => Math.min(Math.max(v, lo), hi);
/** An angle into -π..π (rad). */
export const wrap = (a: number) => a - 2 * Math.PI * Math.floor((a + Math.PI) / (2 * Math.PI)); // no loop: Infinity gives NaN, not a hang
