// Where a place is, in words a player can use: how far from Torget and which way, not the game's coordinates.

const ON_TORGET_M = 60; // nearer the origin than this is on the square itself
const WINDS = ['north', 'north-east', 'east', 'south-east', 'south', 'south-west', 'west', 'north-west'];

/** A place's position ([x, z] in metres from Torget, x east, z south) as "940 m north-west of Torget". */
export function whereabouts([x, z]: readonly [number, number]): string {
  const metres = Math.hypot(x, z);
  if (metres < ON_TORGET_M) return 'On Torget';
  // north is −z; eight winds of 45° each, the first centred on north
  const wind = WINDS[Math.round(Math.atan2(x, -z) / (Math.PI / 4) + 8) % 8];
  // rounded first, so 995 m is 1.0 km and never "1000 m"
  const tens = Math.round(metres / 10) * 10;
  const far = tens < 1000 ? `${tens} m` : `${(tens / 1000).toFixed(1)} km`;
  return `${far} ${wind} of Torget`;
}
