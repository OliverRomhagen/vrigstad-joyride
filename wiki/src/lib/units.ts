// Units the wiki shows the game's numbers in: the game counts in metres and seconds, players read km/h.

/** A speed in m/s, as the game keeps it, in whole km/h. */
export const kmh = (metresPerSecond: number) => Math.round(metresPerSecond * 3.6);
