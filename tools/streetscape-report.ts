// The half of the streetscape coverage report (#187 §5.4) that depends on the runtime rules: what the game infers
// from data/vrigstad.json. Run with `npm run data:report`, after `npm run data`.
import data from '../data/vrigstad.json';
import { BuildingIndex } from '../src/world/buildings';
import { RoadClass, RoadUse, SideState, type WorldData } from '../src/world/data';
import { Heightfield } from '../src/world/heightfield';
import { polylineLength } from '../src/world/polyline';
import { RoadNetwork } from '../src/world/roads';
import { buildStreetscape } from '../src/world/streetscape';
import { STREETSCAPE_OVERRIDES } from '../src/world/streetscape-overrides';
import { classifyStreetscape } from '../src/world/streetscape-rules';
import { Water } from '../src/world/water';

export function report() {
  const D = data as unknown as WorldData;
  const heightfield = new Heightfield(D);
  const roads = new RoadNetwork(D, heightfield);
  const buildings = new BuildingIndex(D);
  const t0 = performance.now();
  const sides = classifyStreetscape(D, roads, buildings, STREETSCAPE_OVERRIDES);
  const layout = buildStreetscape({
    data: D,
    roads,
    heightfield,
    buildings,
    water: new Water(D, roads),
    sides,
    treeRoadClearanceM: 2.5,
  });
  const ms = performance.now() - t0;
  const km = (m: number) => (m / 1000).toFixed(2);
  let builtUp = 0;
  let notBuiltUp = 0;
  const profileM: Record<string, number> = {};
  roads.lines.forEach((r, ri) => {
    const len = polylineLength(r.p);
    if (r.c <= RoadClass.SERVICE && (D.r[ri].s ?? RoadUse.NONE) === RoadUse.NONE)
      profileM[sides[ri].profile] = (profileM[sides[ri].profile] ?? 0) + len;
    if (r.c > RoadClass.STREET || (D.r[ri].sw ?? [0, 0]).some(s => s !== SideState.UNKNOWN)) return;
    if (sides[ri].profile === 'outskirts') notBuiltUp += len;
    else builtUp += len;
  });
  const lots = layout.lots;
  const out = [
    '## Streetscape coverage (runtime rules)',
    `streets class <= STREET with no sidewalk information: ${km(builtUp)} km built-up, ${km(notBuiltUp)} km not built-up`,
    `road length by profile (class <= SERVICE, no service=*): ${Object.entries(profileM)
      .map(([k, v]) => `${k} ${km(v)} km`)
      .join(', ')}`,
    `sidewalks built: mapped ${km(layout.sidewalkM.mapped)} km, derived ${km(layout.sidewalkM.derived)} km, inferred ${km(layout.sidewalkM.inferred)} km`,
    `strips ${layout.strips.length}, junction corners ${layout.corners.length}, lowered-curb openings ${layout.openings.length} (` +
      ['driveway', 'crossing', 'kerb'].map(k => `${k} ${layout.openings.filter(o => o.kind === k).length}`).join(', ') +
      ')',
    `parking lots drawn ${lots.length}: stall layouts mapped ${lots.filter(l => l.stallSource === 'mapped').length}, inferred ${lots.filter(l => l.stallSource === 'inferred').length} (${lots.filter(l => l.stallSource === 'inferred').reduce((n, l) => n + l.stallCount, 0)} stalls)`,
    `crossings drawn ${layout.crossings}`,
    `street trees: mapped ${layout.trees.filter(t => t.source === 'mapped').length}, inferred ${layout.trees.filter(t => t.source === 'inferred').length}`,
    `triangles: surface ${layout.surface.part.length}, markings ${layout.markings.part.length + layout.lotMarkings.part.length}; layout built in ${ms.toFixed(0)} ms (Node, cold)`,
  ];
  console.log(out.join('\n'));
}
