// The Rapier trial's numbers (#54, ?lab=rapier) in the tunables registry (#217), so the console's `tune` and `?tune=`
// change them while you play: the first of the numbers a sandbox mode would hand to players. The physics world reads
// this object every time it needs one, so a change applies at once. Pure: no DOM, no three.js.
import type { Tunables } from './tunables';

export const PHYSICS = {
  /** a body falls this fast, in m/s² (the Earth's 9.81) */
  GRAVITY: 9.81,
  /** a prop joins Rapier's world when a moving car comes this close (m): until then it is only data */
  PROP_JOIN_M: 12,
  /** a knocked prop goes back to its stand this long after it was knocked (s), once the player is far from it */
  PROP_RESPAWN_S: 90,
  /**
   * how far the player must be from where a knocked prop lies and where it stood before it goes back (m): far enough
   * that a 6.5 m lamp popping back up on an open street isn't seen. Walls and the camera's view aren't asked.
   */
  PROP_RESPAWN_M: 100,
};

/** Adds the physics numbers to the registry, as `physics.*`. */
export function registerPhysicsTunables(t: Tunables): void {
  t.addFields('physics', PHYSICS, {
    GRAVITY: { name: 'gravity', unit: 'm/s²', min: 0, max: 50, help: 'how fast things fall; 0 floats them' },
    PROP_JOIN_M: {
      name: 'prop-join-distance',
      unit: 'm',
      min: 2,
      max: 60,
      help: 'how near a moving car brings street furniture into the physics world',
    },
    PROP_RESPAWN_S: {
      name: 'prop-respawn-time',
      unit: 's',
      min: 1,
      max: 3600,
      help: 'how long a knocked prop stays down before it goes back on its stand',
    },
    PROP_RESPAWN_M: {
      name: 'prop-respawn-distance',
      unit: 'm',
      min: 0,
      max: 2200,
      help: 'how far you must be from a knocked prop before it goes back on its stand',
    },
  });
}
