// Waste bins (#144): beside some of Torget's benches, at the bus stops, and along the centre's and main roads now and
// then. Pure: no three.js.
import { hash01 } from '../random';
import { FURNITURE, type FurnitureContext } from './definitions';
import { byOrder, type Candidate, jitterRad, type Placer } from './placer';

/** Torget's bins: how many, and each this far from its bench's end (m) */
export const TORGET_BINS = { min: 2, max: 3 };
const BIN_BESIDE_BENCH_M = 0.8;
/** roadside bins: one about every this far (m), spread by up to this share of it, kept with this chance */
const BIN_EVERY_M: Partial<Record<FurnitureContext, number>> = { centre: 150, main: 300 };
const BIN_SPREAD_SHARE = 0.3;
const BIN_DENSITY: Partial<Record<FurnitureContext, number>> = { centre: 0.7, main: 0.5 };
/** no bin closer than this to either end of a road piece (m) */
const ROAD_END_MARGIN_M = 2;
/** rotation jitter (rad) */
const BIN_JITTER_RAD = (20 * Math.PI) / 180;

/** Torget's bins: beside a few of its benches, chosen by hash rather than every bench, at whichever end fits. */
function placeTorgetBins(placer: Placer, torgetBenches: readonly Candidate[]) {
  let placed = 0;
  for (const bench of [...torgetBenches].sort((a, b) => hash01(a.id, 'bin') - hash01(b.id, 'bin'))) {
    if (placed >= TORGET_BINS.max) break;
    for (const end of [1, -1]) {
      const along = (FURNITURE.bench.widthM / 2 + BIN_BESIDE_BENCH_M) * end; // along the bench's own x axis
      const id = `gen:waste-bin:torget:${bench.id.split(':').pop()}${end < 0 ? 'l' : 'r'}`;
      const bin: Candidate = {
        ...bench,
        id,
        kind: 'waste-bin',
        modelId: FURNITURE['waste-bin'].modelId,
        x: bench.x + Math.cos(bench.rotationY) * along,
        z: bench.z - Math.sin(bench.rotationY) * along,
        rotationY: bench.rotationY + jitterRad(id, BIN_JITTER_RAD),
        rank: 0,
      };
      if (placer.tryPlace(bin)) {
        placed++;
        break;
      }
    }
  }
}

/** Roadside bins in the centre and on main roads, on the lamp side, now and then. */
function roadsideBinCandidates(placer: Placer): Candidate[] {
  const out: Candidate[] = [];
  placer.inp.roads.lines.forEach((_, ri) => {
    const context = placer.contexts[ri];
    const every = BIN_EVERY_M[context];
    if (!every) return;
    const side = placer.lampSides(ri)[0];
    const length = placer.arcs[ri][placer.arcs[ri].length - 1];
    const offset = placer.seatOffset(ri, side, 'waste-bin');
    for (let n = 0; ; n++) {
      const id = `gen:waste-bin:${placer.keys[ri]}:${n}`;
      const s = every / 2 + n * every + (hash01(id, 'at') - 0.5) * every * BIN_SPREAD_SHARE;
      if (s > length - ROAD_END_MARGIN_M) break;
      if (hash01(id) >= BIN_DENSITY[context]!) continue;
      const c = placer.roadside('waste-bin', ri, side, s, offset, id, context, BIN_JITTER_RAD);
      if (c) out.push(c);
    }
  });
  return out;
}

/** Places every bin: Torget's first, then the bus stops' and the roadside ones in order. */
export function placeBins(placer: Placer, torgetBenches: readonly Candidate[], busBins: readonly Candidate[]) {
  placeTorgetBins(placer, torgetBenches);
  for (const c of [...busBins, ...roadsideBinCandidates(placer)].sort(byOrder)) placer.tryPlace(c);
}
