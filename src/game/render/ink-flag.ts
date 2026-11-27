// In a module of its own: the modules that build meshes set it with the flag on or off, and the toon style, which
// reads it, only loads behind ?lab=toon (src/game/render/toon-style.ts).
/** Set on an object's userData to give every opaque mesh under it ink lines in the toon style. */
export const INK_FLAG = 'toonInk';
/**
 * Set on a mesh's userData, beside INK_FLAG on it or above it, when the mesh stands in the ground with no floor (the
 * house shells): its open bottom edges, its feet, get no ink line. The ground buries them, on a slope unevenly.
 */
export const INK_NO_FEET_FLAG = 'toonInkNoFeet';
