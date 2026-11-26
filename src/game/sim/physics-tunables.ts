// The Rapier trial's numbers (#54, ?lab=rapier) in the tunables registry (#217), so the console's `tune` and `?tune=`
// change them while you play: the first of the numbers a sandbox mode would hand to players. The physics world reads
// this object every time it needs one, so a change applies at once. Pure: no DOM, no three.js.
import type { Tunables } from './tunables';

// Each number's unit, range and meaning are in registerPhysicsTunables below, and only there, so they can't drift apart;
// the comments here keep the reasons.
export const PHYSICS = {
  GRAVITY: 9.81, // the Earth's
  // only data until a car comes near, so the world holds the props near the cars, not every one in the village
  PROP_JOIN_M: 12,
  // traffic knocks props over all round the village, and each one down is a draw call of its own
  PROP_RESPAWN_S: 90,
  // a 6.5 m lamp popping back up on an open street isn't seen; walls and the camera's view aren't asked
  PROP_RESPAWN_M: 100,
  // long enough to see it lie, short enough to shoot it again (the shooting range's, #545)
  TARGET_RESET_S: 4,
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
      min: 5, // nearer, a prop could come back inside the player or a parked car, and be thrown out of it
      max: 2200,
      help: 'how far you must be from a knocked prop before it goes back on its stand',
    },
    TARGET_RESET_S: {
      name: 'target-reset-time',
      unit: 's',
      min: 1,
      max: 600,
      help: 'how long a target at the shooting range lies before it stands up again',
    },
  });
}
