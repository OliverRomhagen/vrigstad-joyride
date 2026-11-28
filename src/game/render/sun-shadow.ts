// Where the sun's shadow box goes each frame. The shadow is drawn into a square image laid over the world; if the
// square slides with the player by a fraction of one of its pixels, every shadow edge is drawn with other pixels each
// frame, and the edges crawl and shimmer as you drive, most of all the eaves' on the walls. So the box moves only in
// whole pixels, across the sun's own view; along the sun's direction it may move freely, as that doesn't shift the
// image. It is also pushed ahead of the camera, so its edge, where shadows stop, falls further out in the view.

type Vec3 = { x: number; y: number; z: number };

/** How far ahead of the player, in the camera's direction, the shadow box is centred (m). */
export const SHADOW_AHEAD_M = 50;

/**
 * Writes into `out` where the shadow box goes from `from`, its centre now, towards `focus` without its pixels sliding:
 * across the sun's view only in whole `texelM`, along the sun freely. `out` may be `from`. `sunDir` points to the sun
 * and is normalised. The shadow camera looks along -sunDir with three's default up (0, 1, 0), so its axes are
 * right = up × sunDir and up' = sunDir × right.
 *
 * The steps are counted from the box's own centre, not from a fixed point such as the world's origin: as the time of
 * day turns the sun, a grid fixed to the origin would turn about it and slide under a player far from it, so shadows
 * would crawl with nobody moving. Counted from the box, they turn about the box, and the slide stays small near it.
 */
export function steadyShadowCentre(out: Vec3, from: Vec3, focus: Vec3, sunDir: Vec3, texelM: number): Vec3 {
  // right = (0, 1, 0) × d, normalised; the sun is never straight overhead in the game, so it has a length
  let rx = sunDir.z,
    rz = -sunDir.x;
  const rl = Math.hypot(rx, rz) || 1;
  rx /= rl;
  rz /= rl;
  // up' = d × right
  const ux = sunDir.y * rz,
    uy = sunDir.z * rx - sunDir.x * rz,
    uz = -sunDir.y * rx;
  const fx = from.x,
    fy = from.y,
    fz = from.z,
    dx = focus.x - fx,
    dy = focus.y - fy,
    dz = focus.z - fz,
    sa = Math.round((dx * rx + dz * rz) / texelM) * texelM,
    sb = Math.round((dx * ux + dy * uy + dz * uz) / texelM) * texelM,
    w = dx * sunDir.x + dy * sunDir.y + dz * sunDir.z;
  out.x = fx + rx * sa + ux * sb + sunDir.x * w;
  out.y = fy + uy * sb + sunDir.y * w;
  out.z = fz + rz * sa + uz * sb + sunDir.z * w;
  return out;
}
