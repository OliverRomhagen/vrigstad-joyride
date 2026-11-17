// Where the sun stands over Vrigstad, from the NOAA approximations for solar declination and the equation of time.
// Good to a fraction of a degree, which is plenty for lighting.

export const LAT_DEG = 57.3555;
export const LON_DEG = 14.4756;
/** Swedish summer time (CEST); the game only uses summer dates. */
export const UTC_OFFSET_H = 2;

const DEG = Math.PI / 180;

/** Unit vector toward the sun in world axes (x east, y up, z south), plus its elevation in degrees. */
export interface SunPosition {
  x: number;
  y: number;
  z: number;
  elevationDeg: number;
}

/** The sun at local clock time `hour` (0–24) on day `day` of a non-leap year (1 = 1 January). Writes into `out` so the game loop doesn't allocate. */
export function sunAt(day: number, hour: number, out: SunPosition = { x: 0, y: 1, z: 0, elevationDeg: 90 }): SunPosition {
  const g = ((2 * Math.PI) / 365) * (day - 1 + (hour - UTC_OFFSET_H - 12) / 24);   // fractional year (rad)
  const eotMin = 229.18 * (0.000075 + 0.001868 * Math.cos(g) - 0.032077 * Math.sin(g) - 0.014615 * Math.cos(2 * g) - 0.040849 * Math.sin(2 * g));
  const decl = 0.006918 - 0.399912 * Math.cos(g) + 0.070257 * Math.sin(g) - 0.006758 * Math.cos(2 * g) + 0.000907 * Math.sin(2 * g)
    - 0.002697 * Math.cos(3 * g) + 0.00148 * Math.sin(3 * g);
  const solarMin = hour * 60 + eotMin + 4 * LON_DEG - 60 * UTC_OFFSET_H;   // true solar time (minutes)
  const ha = (solarMin / 4 - 180) * DEG;                                    // hour angle: 0 at solar noon, negative in the morning
  const lat = LAT_DEG * DEG;
  const east = -Math.cos(decl) * Math.sin(ha);
  const north = Math.cos(lat) * Math.sin(decl) - Math.sin(lat) * Math.cos(decl) * Math.cos(ha);
  const up = Math.sin(lat) * Math.sin(decl) + Math.cos(lat) * Math.cos(decl) * Math.cos(ha);
  out.x = east;
  out.y = up;
  out.z = -north;
  out.elevationDeg = Math.asin(Math.max(-1, Math.min(1, up))) / DEG;
  return out;
}
