// A car's body for collisions (#201): a capsule, the segment along the car's length (its spine) with half its width
// around it. The sides and the nose are where the body is; only the corners are rounded, by up to 0.21 of the width.
// A true box would need separating-axis tests against footprints that can be concave, for the corners alone.
import { clamp } from '../../world/math';
import type { VehicleSpec } from './vehicle-spec';

type Point = { x: number; z: number };
/** What the collisions read of a car: where it is, which way its body points (`h`, as the meshes) and its size. */
export type CarBody = Point & { h: number; T: Pick<VehicleSpec, 'lengthM' | 'widthM' | 'bodyAheadM'> };

/** How far a person on foot keeps from a car's body (m): half the gap two people keep (0.75 m, pedestrians.ts). */
export const PERSON_RADIUS_M = 0.4;

/** Half the length of the car's spine (m): half its length, less the rounded end. */
export const spineHalf = (c: CarBody) => Math.max(0, c.T.lengthM / 2 - c.T.widthM / 2);
/** How far the middle of the spine lies ahead of the car's origin (m): 0 unless a model's body is off its centre. */
const ahead = (c: CarBody) => c.T.bodyAheadM ?? 0;
/** How far the body reaches from the car's origin along its length (m), for a quick test before the exact one. */
export const bodyReach = (c: CarBody) => c.T.lengthM / 2 + Math.abs(ahead(c));
/** How far the body reaches out from its spine (m). */
export const bodyRadius = (c: CarBody) => c.T.widthM / 2;

/** The point on c's spine nearest to (x, z), written to `out`. */
export function nearestOnSpine(c: CarBody, x: number, z: number, out: Point) {
  const s = spineHalf(c),
    o = ahead(c),
    fx = Math.sin(c.h),
    fz = -Math.cos(c.h),
    t = clamp((x - c.x) * fx + (z - c.z) * fz - o, -s, s) + o;
  out.x = c.x + fx * t;
  out.z = c.z + fz * t;
  return out;
}

/** The nearest points between the spines of a and b, written to `pa` (on a) and `pb` (on b). */
export function nearestBetweenSpines(a: CarBody, b: CarBody, pa: Point, pb: Point) {
  // closest points of two segments (Ericson, Real-Time Collision Detection 5.1.9), each centred on its body, unit directions
  const sa = spineHalf(a),
    sb = spineHalf(b),
    oa = ahead(a),
    ob = ahead(b),
    ax = Math.sin(a.h),
    az = -Math.cos(a.h),
    bx = Math.sin(b.h),
    bz = -Math.cos(b.h),
    rx = a.x + ax * oa - b.x - bx * ob,
    rz = a.z + az * oa - b.z - bz * ob,
    dot = ax * bx + az * bz,
    c = ax * rx + az * rz,
    f = bx * rx + bz * rz,
    denom = 1 - dot * dot;
  let s = denom > 1e-9 ? clamp((dot * f - c) / denom, -sa, sa) : 0; // parallel: any s will do, t picks the overlap
  const t = clamp(dot * s + f, -sb, sb);
  s = clamp(dot * t - c, -sa, sa);
  pa.x = a.x + ax * (s + oa);
  pa.z = a.z + az * (s + oa);
  pb.x = b.x + bx * (t + ob);
  pb.z = b.z + bz * (t + ob);
}

const _circle = { x: 0, z: 0 };
/**
 * Pushes the body out of whatever `collide` pushes circles out of (the buildings): circles of the body's radius along
 * its spine, no further apart than that radius, so the capsule's sides dip at most 13% of it between two. The car moves
 * with every push. True on contact.
 */
export function pushBodyOut(c: CarBody, collide: (o: Point, r: number) => boolean) {
  const s = spineHalf(c),
    o = ahead(c),
    r = bodyRadius(c),
    n = Math.ceil((2 * s) / r),
    fx = Math.sin(c.h),
    fz = -Math.cos(c.h);
  let hit = false;
  for (let i = 0; i <= n; i++) {
    const t = o + (n ? -s + (2 * s * i) / n : 0);
    _circle.x = c.x + fx * t;
    _circle.z = c.z + fz * t;
    const x = _circle.x,
      z = _circle.z;
    if (collide(_circle, r)) {
      hit = true;
      c.x += _circle.x - x;
      c.z += _circle.z - z;
    }
  }
  return hit;
}
