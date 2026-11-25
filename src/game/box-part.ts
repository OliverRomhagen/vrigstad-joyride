// The people, cats and street things the game builds from boxes rather than loads from a model file are lists of these.
// Plain data, so rules can describe a model and the wiki can read one; render/models.ts's boxGeo turns a list into geometry.

/** One box of a model: its size and its centre, in metres, and its colour (sRGB). */
export type BoxPart = [sx: number, sy: number, sz: number, x: number, y: number, z: number, colour: string];
