// In a module of its own: the modules that build meshes set it with the flag on or off, and the toon style, which
// reads it, only loads behind ?lab=toon (src/game/render/toon-style.ts).
/** Set on an object's userData to give every opaque mesh under it ink lines in the toon style. */
export const INK_FLAG = 'toonInk';
/**
 * Set on the userData of a mesh that gets ink (the mesh itself: it isn't inherited, as INK_FLAG is) when it is built
 * with no floor (the house shells): its open bottom edges, its feet, get no ink line. The ground buries the walls'
 * and the plinths', on a slope unevenly; the corner boards' stand on the plinth and the chimneys' are inside the roof.
 */
export const INK_NO_FEET_FLAG = 'toonInkNoFeet';
