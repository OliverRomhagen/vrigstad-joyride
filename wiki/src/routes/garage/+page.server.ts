import { b as buildings } from '#data/vrigstad.json'; // Vite bundles it, so no path depends on the working directory
import { OWNER_LINES } from '#game/skroten';
import { SKROT_CARPORT, SKROT_HALL } from '#game/skroten-yard';
import { pointInPolygon } from '#world/polygon';

// Skroten's workshop and carport stand on two real footprints; the yard is built around them (yardLayout). Only those two leave
// the server, not the whole of data/vrigstad.json.
const footprints = (buildings as { p: number[] }[]).filter(
  b => pointInPolygon(b.p, SKROT_HALL.x, SKROT_HALL.z) || pointInPolygon(b.p, SKROT_CARPORT.x, SKROT_CARPORT.z),
);
// what Plåt-Pelle says in the game, without the quotation marks the game's toast puts round them
const pelleLines = OWNER_LINES.map(line => line.replace(/^”|”$/g, ''));

export const load = () => ({ footprints, pelleLines });
