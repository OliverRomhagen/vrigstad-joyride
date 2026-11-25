import * as THREE from 'three';
import { describe, expect, it, vi } from 'vitest';
import { addBuildings } from '../../../../src/game/render/world-meshes';
import { BuildingKind, type WorldData } from '../../../../src/world/data';
import { Heightfield } from '../../../../src/world/heightfield';
import { makeWorld, square } from '../../world/fixture';

// Node has no canvas: the textures get one that ignores what's drawn on it. Hoisted, since modules draw some as they load.
vi.hoisted(() => {
  const ctx = new Proxy({}, { get: () => () => ({ addColorStop() {} }) });
  vi.stubGlobal('document', { createElement: () => ({ width: 0, height: 0, getContext: () => ctx }) });
});

type Building = WorldData['b'][number];
// each triangle of the house shells' mesh (walls, roof and trim) as the plane it lies in, facing the way it faces, to the cm:
// the plane, not the corners, since a quad listed the other way round is split along its other diagonal
function triangles(b: Building) {
  const world = makeWorld({ b: [b] }),
    scene = new THREE.Scene();
  addBuildings(scene, world, new Heightfield(world), { rnd: () => 0.5, pick: a => a[0], maxAnisotropy: 1 });
  const shells = scene.children.find(
    o => o instanceof THREE.Mesh && (o.material as THREE.Material & { vertexColors: boolean }).vertexColors,
  ) as THREE.Mesh;
  const pos = shells.geometry.getAttribute('position'),
    [p, q, r, n] = [new THREE.Vector3(), new THREE.Vector3(), new THREE.Vector3(), new THREE.Vector3()],
    out: string[] = [];
  const cm = (v: number) => (Math.round(v * 100) / 100 || 0).toFixed(2);
  for (let i = 0; i < pos.count; i += 3) {
    p.fromBufferAttribute(pos, i);
    q.fromBufferAttribute(pos, i + 1);
    r.fromBufferAttribute(pos, i + 2);
    THREE.Triangle.getNormal(p, q, r, n);
    out.push([n.x, n.y, n.z, n.dot(p)].map(cm).join(' '));
  }
  return out.sort();
}
// the same outline listed the other way round
const reversed = (b: Building): Building => {
  const p: number[] = [];
  for (let i = b.p.length - 2; i >= 0; i -= 2) p.push(b.p[i], b.p[i + 1]);
  return { ...b, p };
};

describe('house trim', () => {
  const flat = { p: square(0, 0, 10), h: 5, k: BuildingKind.OTHER };
  const pitched = { ...flat, g: [0, 5, 10, 5, 5] as [number, number, number, number, number] };
  // a parallelogram: its gables stand askew to the ridge, and its eave corners aren't right angles
  const askew = { ...pitched, p: [0, 0, 10, 0, 13, 9, 3, 9], g: [1.5, 4.5, 11.5, 4.5, 5] as Building['g'] };

  it.each([
    ['a flat roof', flat],
    ['a pitched roof', pitched],
  ])('comes out the same, facing the same way, whichever way the outline runs, with %s', (_, b) => {
    const forwards = triangles(b);
    expect(forwards.length).toBeGreaterThan(0);
    expect(triangles(reversed(b))).toEqual(forwards);
  });

  it('faces the same way whichever way the outline runs, with gables askew to the ridge', () => {
    // its mitred eave corners make the overhangs' quads a little warped, so the two diagonals give planes a few cm apart:
    // count how many triangles face up, down and sideways instead, which a face wound the wrong way would change
    const facing = (b: Building) => {
      const n = { up: 0, down: 0, side: 0 };
      for (const t of triangles(b)) {
        const y = Number(t.split(' ')[1]);
        n[y > 0.5 ? 'up' : y < -0.5 ? 'down' : 'side']++;
      }
      return n;
    };
    expect(facing(reversed(askew))).toEqual(facing(askew));
  });

  it("meets at the eave corners of a house whose outline is a few cm off its roof's rectangle, as real outlines are", () => {
    // the data rounds the outline and the ridge to 0.1 m apiece, so the eave walls seldom sit exactly at the eave height
    const off = { ...pitched, p: [0, 0, 10, 0.03, 10, 10.02, 0, 10.04] },
      world = makeWorld({ b: [off] }),
      scene = new THREE.Scene();
    addBuildings(scene, world, new Heightfield(world), { rnd: () => 0.5, pick: a => a[0], maxAnisotropy: 1 });
    const shells = scene.children.find(
      o => o instanceof THREE.Mesh && (o.material as THREE.Material & { vertexColors: boolean }).vertexColors,
    ) as THREE.Mesh;
    const pos = shells.geometry.getAttribute('position');
    // the overhang's mitred corner, EAVE_M (0.35 m) out from both walls: what both walls' overhangs put there is the roof's
    // edge and the fascia's foot FASCIA_M (0.15 m) under it, so the heights span exactly that when the two walls agree
    const span = (x: number, z: number) => {
      const ys: number[] = [];
      for (let i = 0; i < pos.count; i++) if (Math.hypot(pos.getX(i) - x, pos.getZ(i) - z) < 0.05) ys.push(pos.getY(i));
      return ys.length ? Math.max(...ys) - Math.min(...ys) : -1;
    };
    for (const [x, z] of [
      [-0.35, -0.35],
      [10.35, -0.35],
      [10.35, 10.37],
      [-0.35, 10.39],
    ])
      expect(span(x, z), `at (${x}, ${z})`).toBeCloseTo(0.15, 3);
  });
});
