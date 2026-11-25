// In a module of its own: the modules that build meshes set it with the flag on or off, and the toon style, which
// reads it, only loads behind ?lab=toon (src/game/render/toon-style.ts).
/** Set on an object's userData to give every opaque mesh under it ink lines in the toon style. */
export const INK_FLAG = 'toonInk';
