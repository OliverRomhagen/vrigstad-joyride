// In a module of its own: the modules that build meshes set it (and the seams use its colour), and the toon style
// (src/game/render/toon-style.ts) reads it, without either importing the other.
/** Set on an object's userData to give every opaque mesh under it ink lines in the toon style. */
export const INK_FLAG = 'toonInk';
/** The ink lines' colour (sRGB), which the timber houses' board seams share. */
export const INK_COLOR = 0x10151c;
/**
 * Set on the userData of a mesh that gets ink (the mesh itself: it isn't inherited, as INK_FLAG is) when it is built
 * with no floor (the house shells): its open bottom edges, its feet, get no ink line. The ground buries the walls'
 * and the plinths', on a slope unevenly; the corner boards' stand on the plinth and the chimneys' are inside the roof.
 */
export const INK_NO_FEET_FLAG = 'toonInkNoFeet';
