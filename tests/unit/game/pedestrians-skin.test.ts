import * as THREE from 'three';
import { describe, expect, it } from 'vitest';
import { Crowd, type CrowdDeps, type PersonMesh } from '../../../src/game/pedestrians';
import { makeRnd } from '../../../src/world/random';
import { ROAD_CELL_M, type RoadLine } from '../../../src/world/roads';

// A straight street along x through the origin, with the road grid and walk grid built around it, so the crowd can spawn on it.
function fixture() {
  // the street, as a vertex every 10 m so the walk grid has segments in many cells
  const p = Array.from({ length: 81 }, (_, i) => [-400 + i * 10, 0]);
  const lines: RoadLine[] = [{ p, c: 2, n: 'Testgatan' } as unknown as RoadLine];
  const grid = new Map<string, unknown[]>();
  for (let x = -10; x <= 10; x++) for (let z = -1; z <= 0; z++) grid.set(x + ',' + z, []);
  const footprints: { x0: number; x1: number; z0: number; z1: number }[] = [];
  for (let x = -10; x <= 10; x++)
    for (let z = -1; z <= 0; z++)
      for (let k = 0; k < 16; k++)
        footprints.push({
          x0: (x + 0.5) * ROAD_CELL_M,
          x1: (x + 0.5) * ROAD_CELL_M + 1,
          z0: (z + 0.5) * ROAD_CELL_M,
          z1: (z + 0.5) * ROAD_CELL_M + 1,
        });
  const calls: [string, string, string, string][] = [];
  const deps: CrowdDeps = {
    scene: { add() {}, remove() {} } as unknown as THREE.Scene,
    roads: { lines, grid } as unknown as CrowdDeps['roads'],
    // a built-up street, so the crowd is dense enough to spawn in a short run
    buildings: { footprints, collide() {} } as unknown as CrowdDeps['buildings'],
    labels: [],
    groundAt: () => 0,
    walkOffset: () => 2,
    coarse: false,
    rnd: makeRnd(7),
    pick: <T>(a: readonly T[]) => a[Math.floor(deps.rnd() * a.length)],
    personParts: (shirt, pants, hair, skin) => {
      calls.push([shirt, pants, hair, skin]);
      const m = new THREE.Object3D() as PersonMesh;
      m.legs = [new THREE.Object3D(), new THREE.Object3D()];
      return m;
    },
    advance() {},
    cars: [],
    player: { x: 0, z: 0 },
    inCar: false,
  };
  return { crowd: new Crowd(deps), calls, lines };
}

describe('pedestrian skin tones', () => {
  it('gives each spawned pedestrian a skin from the palette and builds their body with it', () => {
    const { crowd, calls } = fixture();
    // the crowd spawns a few at a time, so run long enough for several to appear
    for (let i = 0; i < 400; i++) crowd.update({ x: 0, z: 0 }, 0.4);
    const npcs = crowd.npcs;
    expect(npcs.length).toBeGreaterThan(1);
    const skins = new Set<string>();
    for (const n of npcs) {
      expect(n.look.skin).toMatch(/^#[0-9a-f]{6}$/);
      skins.add(n.look.skin);
    }
    // the body is built with the same skin the look records (so the ragdolls and the walker match)
    const built = new Set(calls.map(c => c[3]));
    for (const s of skins) expect(built).toContain(s);
    // and the palette is a range, not one colour
    expect(skins.size).toBeGreaterThan(1);
  });
});
