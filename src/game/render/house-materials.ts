// In a module of its own, as the ink flag is: the module that builds the houses names their material, and the toon
// style (src/game/render/toon-style.ts) reads the name, without either importing the other.
/** The name of the house shells' material (walls, roofs and trim), which gives it the toon style's house ramp. Lower case: `finishOf` compares it so. */
export const HOUSE_SHELLS_MATERIAL = 'house shells';
/**
 * The name of the 3D window frames' material (src/game/render/window-frames.ts). Not the house ramp: the frames and
 * their glass get the paint ramp, as the painted windows under them do, so a frame appearing doesn't change the window.
 */
export const HOUSE_FRAMES_MATERIAL = 'house frames';
