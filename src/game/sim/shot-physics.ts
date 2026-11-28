// Shots through Rapier (#54 step 4, with ?lab=rapier and ?lab=pickadoll): the weapons ask the physics world's ray
// casts what a shot meets, in place of their own checks along its path. Pure: no three.js, no DOM.
import type { CarBody } from './car-body';
import { newSegmentHit, type PhysicsWorld } from './physics-world';
import type { ShotHit, ShotWorld } from './shots';

/**
 * A ray cast for `world` (ShotWorld.cast), through `physics`. A car or a person it meets is given as its index in
 * world.cars or world.people, as the weapons' own checks give it; one that isn't in those lists, such as a car that
 * was taken out of them this frame, is passed through. `firedFrom` is the car the shots leave, which they pass through.
 */
export function physicsCast(
  physics: Pick<PhysicsWorld, 'castSegment'>,
  world: Pick<ShotWorld, 'people' | 'cars'>,
  firedFrom: () => CarBody | null,
): NonNullable<ShotWorld['cast']> {
  const seg = newSegmentHit();
  return (x0, y0, z0, x1, y1, z1, out: ShotHit) => {
    if (!physics.castSegment(x0, y0, z0, x1, y1, z1, firedFrom(), seg)) return null;
    let target = -1;
    if (seg.car) target = world.cars.indexOf(seg.car);
    else if (seg.person) target = world.people.indexOf(seg.person);
    else if (seg.prop >= 0) target = seg.prop;
    if ((seg.car || seg.person) && target < 0) return null;
    const dx = x1 - x0,
      dz = z1 - z0,
      flat = Math.hypot(dx, dz);
    out.kind = seg.kind;
    out.target = target;
    out.x = seg.x;
    out.y = seg.y;
    out.z = seg.z;
    out.nx = seg.nx;
    out.ny = seg.ny;
    out.nz = seg.nz;
    // straight down, the way along the ground is any: north, as a burst's
    out.dx = flat > 1e-6 ? dx / flat : 0;
    out.dz = flat > 1e-6 ? dz / flat : -1;
    return out;
  };
}
