export const clamp = (v: number, lo: number, hi: number) => Math.min(Math.max(v, lo), hi);
/** An angle into -π..π (rad). */
export const wrap = (a: number) => {
  while (a > Math.PI) a -= 2 * Math.PI;
  while (a < -Math.PI) a += 2 * Math.PI;
  return a;
};
