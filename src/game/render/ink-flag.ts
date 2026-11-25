// In a module of its own: the modules that build meshes set it (and the seams use its colour) with the flag on or off, and the toon style, which
// reads it, only loads behind ?lab=toon (src/game/render/toon-style.ts).
/** Set on an object's userData to give every opaque mesh under it ink lines in the toon style. */
export const INK_FLAG = 'toonInk';
/** The ink lines' colour (sRGB), which the timber houses' board seams share. */
export const INK_COLOR = 0x10151c;
