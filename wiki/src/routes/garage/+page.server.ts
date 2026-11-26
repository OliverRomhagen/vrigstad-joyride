import { b as buildings } from '#data/vrigstad.json'; // Vite bundles it, so no path depends on the working directory
import { SKROT_CARPORT, SKROT_HALL } from '#game/skroten-yard';
import { pointInPolygon } from '#world/polygon';

// Skroten's workshop and carport stand on two real footprints; the yard is built around them (yardLayout). Only those two leave
// the server, not the whole of data/vrigstad.json.
const footprints = (buildings as { p: number[] }[]).filter(
  b => pointInPolygon(b.p, SKROT_HALL.x, SKROT_HALL.z) || pointInPolygon(b.p, SKROT_CARPORT.x, SKROT_CARPORT.z),
);

export const load = () => ({ footprints });
