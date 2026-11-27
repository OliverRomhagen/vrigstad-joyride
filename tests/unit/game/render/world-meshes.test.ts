import * as THREE from 'three';
import { describe, expect, it, vi } from 'vitest';
import { inkEdges } from '../../../../src/game/render/ink-edges';
import { INK_FLAG, INK_NO_FEET_FLAG } from '../../../../src/game/render/ink-flag';
import { finishOf } from '../../../../src/game/render/toon-style';
import { addBuildings, PLINTH_OUT_M, PLINTH_TOP_M } from '../../../../src/game/render/world-meshes';
import { BuildingKind, type WorldData } from '../../../../src/world/data';
import { Heightfield } from '../../../../src/world/heightfield';
import { makeWorld, square } from '../../world/fixture';

// Node has no canvas: the textures get one that ignores what's drawn on it. Hoisted, since modules draw some as they load.
vi.hoisted(() => {
  const ctx = new Proxy({}, { get: () => () => ({ addColorStop() {} }) });
  vi.stubGlobal('document', { createElement: () => ({ width: 0, height: 0, getContext: () => ctx }) });
});

type Building = WorldData['b'][number];
// the house shells' mesh (walls, roof and trim) of a world with this building alone
function shellsOf(b: Building, flatWalls?: boolean) {
  const world = makeWorld({ b: [b] }),
    scene = new THREE.Scene();
  addBuildings(scene, world, new Heightfield(world), { rnd: () => 0.5, pick: a => a[0], maxAnisotropy: 1, flatWalls });
  return scene.children.find(
    o => o instanceof THREE.Mesh && (o.material as THREE.Material & { vertexColors: boolean }).vertexColors,
  ) as THREE.Mesh;
}
// each triangle of the house shells' mesh (walls, roof and trim) as the plane it lies in, facing the way it faces, to the cm:
// the plane, not the corners, since a quad listed the other way round is split along its other diagonal
function triangles(b: Building) {
  const pos = shellsOf(b).geometry.getAttribute('position'),
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

describe('house colours and materials', () => {
  // the church: white ('#efece3'), and it gets no trim, so its lowest vertices are all a wall's foot
  const church = { p: square(0, 0, 10), h: 5, k: BuildingKind.CHURCH };
  // the red of each of the shell's lowest vertices
  const footReds = (flatWalls?: boolean) => {
    const geometry = shellsOf(church, flatWalls).geometry,
      pos = geometry.getAttribute('position'),
      colour = geometry.getAttribute('color'),
      reds: number[] = [];
    let foot = Infinity;
    for (let i = 0; i < pos.count; i++) foot = Math.min(foot, pos.getY(i));
    for (let i = 0; i < pos.count; i++) if (pos.getY(i) - foot < 0.001) reds.push(colour.getX(i));
    return reds;
  };
  const white = new THREE.Color('#efece3').convertSRGBToLinear().r;

  it('darkens the walls to 62% at the ground in the default look', () => {
    const reds = footReds();
    expect(reds.length).toBeGreaterThan(0);
    for (const red of reds) expect(red).toBeCloseTo(white * 0.62, 5);
  });

  it('keeps the walls one colour down to the ground with flatWalls, for the toon style', () => {
    const reds = footReds(true);
    expect(reds.length).toBeGreaterThan(0);
    for (const red of reds) expect(red).toBeCloseTo(white, 5);
  });

  it("names the shells' material so that the toon style gives it its house ramp, and leaves the windows on the paint ramp", () => {
    const world = makeWorld({ b: [{ p: square(0, 0, 10), h: 5, k: BuildingKind.OTHER }] }),
      scene = new THREE.Scene();
    addBuildings(scene, world, new Heightfield(world), { rnd: () => 0.5, pick: a => a[0], maxAnisotropy: 1 });
    const materials = scene.children.filter(o => o instanceof THREE.Mesh).map(o => o.material as THREE.Material);
    expect(materials).toHaveLength(2); // the shells and the window skin
    expect(materials.map(finishOf)).toEqual(['house', 'paint']);
  });
});

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
      pos = shellsOf(off).geometry.getAttribute('position');
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

  it("leaves the toon style no line along the roof's edge at the walls, only at the fascia", () => {
    // the toon style's lines, as it draws them for the shells (INK_CREASE_DEG, and no feet, as the shells ask for): every
    // crease, and every edge that only one face has but the walls' feet
    const shells = shellsOf(pitched);
    expect(shells.userData).toMatchObject({ [INK_FLAG]: true, [INK_NO_FEET_FLAG]: true });
    const lines = inkEdges(shells.geometry, 34).getAttribute('position');
    // the feet are gone: the lowest line left is no level one along the ground
    let lowest = Infinity;
    for (let i = 0; i < lines.count; i++) lowest = Math.min(lowest, lines.getY(i));
    for (let i = 0; i < lines.count; i += 2)
      expect(lines.getY(i) - lowest < 0.001 && lines.getY(i + 1) - lowest < 0.001, `segment ${i / 2}`).toBe(false);
    // the walls stand from x 0 to 10 and z 0 to 10, and the roof's edge runs along their tops, from 5 m up to 8.5 at the ridge
    const onWallTop = (x: number, y: number, z: number) =>
      Math.min(Math.abs(x), Math.abs(x - 10), Math.abs(z), Math.abs(z - 10)) < 0.01 &&
      Math.abs(y - (5 + 0.7 * (5 - Math.abs(z - 5)))) < 0.01;
    // a segment along a wall's top has its ends and its middle there; the ridge has only its ends, on the gables
    const along: number[] = [];
    for (let i = 0; i < lines.count; i += 2) {
      const ends = [i, i + 1].map(j => [lines.getX(j), lines.getY(j), lines.getZ(j)] as const),
        [mx, my, mz] = [0, 1, 2].map(c => (ends[0][c] + ends[1][c]) / 2);
      if (ends.every(e => onWallTop(...e)) && onWallTop(mx, my, mz)) along.push(i);
    }
    expect(along).toEqual([]);
  });

  it('on a slope, the toon style loses only the feet: in the ground, on the plinth and in the roof (#413)', () => {
    // the ground rises 10 m every 50 m eastwards, 2 m across the house
    const world = makeWorld({ elev: [0, 10, 20, 0, 10, 20, 0, 10, 20], b: [pitched] }),
      heightfield = new Heightfield(world),
      scene = new THREE.Scene();
    addBuildings(scene, world, heightfield, { rnd: () => 0.5, pick: a => a[0], maxAnisotropy: 1, flatWalls: true });
    const shells = scene.children.find(o => o.userData[INK_NO_FEET_FLAG]) as THREE.Mesh;
    // each segment as its two ends to the mm, in either order
    const segments = (g: THREE.BufferGeometry) => {
      const p = g.getAttribute('position'),
        out = new Map<string, number[]>();
      for (let i = 0; i < p.count; i += 2) {
        const ends = [i, i + 1].map(j => [p.getX(j), p.getY(j), p.getZ(j)].map(v => Math.round(v * 1000) / 1000));
        out.set(
          ends
            .map(e => e.join(','))
            .sort()
            .join(' '),
          ends.flat(),
        );
      }
      return out;
    };
    const all = segments(new THREE.EdgesGeometry(shells.geometry, 34)),
      kept = segments(inkEdges(shells.geometry, 34));
    for (const s of kept.keys()) expect(all.has(s), s).toBe(true); // it only takes lines away
    const dropped = [...all].filter(([s]) => !kept.has(s)).map(([, e]) => e);
    for (const e of dropped) expect(e[1], 'every foot is level').toBeCloseTo(e[4], 3);
    const byHeight = new Map<number, number[][]>();
    for (const e of dropped) byHeight.set(e[1], [...(byHeight.get(e[1]) ?? []), e]);
    const [base, plinthTop, chimneyFoot] = [...byHeight.keys()].sort((a, b) => a - b);
    expect(byHeight.size).toBe(3);
    // the walls' and the plinth's feet, once round each (the walls' 40 m, and the plinth's longer ring), at the base under the whole house,
    // its lowest point; how many segments depends on where the walls are split
    const length = (e: number[]) => Math.hypot(e[0] - e[3], e[2] - e[5]);
    expect(byHeight.get(base)!.reduce((sum, e) => sum + length(e), 0)).toBeCloseTo(40 + 4 * (10 + 2 * PLINTH_OUT_M), 2);
    let lowest = Infinity;
    const pos = shells.geometry.getAttribute('position');
    for (let i = 0; i < pos.count; i++) lowest = Math.min(lowest, pos.getY(i));
    expect(base).toBeCloseTo(lowest, 3);
    // four corner boards, four sides each, standing on the plinth, whose top stands over the highest ground
    expect(byHeight.get(plinthTop)).toHaveLength(16);
    const highest = Math.max(...[0, 10].flatMap(x => [0, 10].map(z => heightfield.heightAt(x, z))));
    expect(plinthTop).toBeCloseTo(highest + PLINTH_TOP_M, 2);
    // the chimney's four sides, inside the roof, under its ridge
    const chimney = byHeight.get(chimneyFoot)!;
    expect(chimney).toHaveLength(4);
    for (const e of chimney) expect(length(e)).toBeLessThan(1);
  });

  it('leaves out the eave of a wall shorter than its mitre, which would come out crossed, and closes the wall instead', () => {
    // an L whose inner wall the ridge crosses 0.18 m from the inside corner, at (5, 6): from there to the corner, the
    // mitre shortens the eave line by 0.35 m, so it would run backwards, from (5, 6.35) to (5.17, 6.35)
    const ell = { ...pitched, p: [0, 0, 10, 0, 10, 6, 4.82, 6, 4.82, 10, 0, 10], g: [5, 0, 5, 10, 5] as Building['g'] };
    for (const b of [ell, reversed(ell)]) {
      const pos = shellsOf(b).geometry.getAttribute('position');
      // the crossed overhang's diagonal, from the wall's end at the ridge to the corner that swapped places with it; the
      // eaves either side have one of these corners each, never both
      const at = (i: number, x: number, z: number) => Math.hypot(pos.getX(i) - x, pos.getZ(i) - z) < 0.01;
      const crossed: number[] = [];
      for (let i = 0; i < pos.count; i += 3) {
        const corners = [i, i + 1, i + 2];
        if (corners.some(j => at(j, 5, 6)) && corners.some(j => at(j, 5.17, 6.35))) crossed.push(i);
      }
      expect(crossed).toEqual([]);
      // and the wall, which stops FASCIA_M short of the roof for a soffit to close, is closed up to the roof without one:
      // faces in its plane (z 6, x 4.82 to 5) between the wall's top, 8.35 to 8.224 m, and the roof's edge, 8.5 to 8.374,
      // covering the 0.18 m by 0.15 m strip, however it's split into triangles
      const [p, q, r] = [new THREE.Vector3(), new THREE.Vector3(), new THREE.Vector3()];
      let area = 0;
      for (let i = 0; i < pos.count; i += 3) {
        const corners = [i, i + 1, i + 2];
        const inStrip = (j: number) =>
          Math.abs(pos.getZ(j) - 6) < 0.001 &&
          pos.getX(j) > 4.819 &&
          pos.getX(j) < 5.001 &&
          pos.getY(j) > 8.2 &&
          pos.getY(j) < 8.51;
        if (corners.every(inStrip))
          area += new THREE.Triangle(
            p.fromBufferAttribute(pos, i),
            q.fromBufferAttribute(pos, i + 1),
            r.fromBufferAttribute(pos, i + 2),
          ).getArea();
      }
      expect(area).toBeCloseTo(0.18 * 0.15, 4);
    }
  });

  it('faces the windows out of the house, whichever way the outline runs', () => {
    // the window skin: the mesh with a texture, 4 cm out from the walls of a 10 m square around (5, 5)
    for (const b of [pitched, reversed(pitched)]) {
      const world = makeWorld({ b: [b] }),
        scene = new THREE.Scene();
      addBuildings(scene, world, new Heightfield(world), { rnd: () => 0.5, pick: a => a[0], maxAnisotropy: 1 });
      const skin = scene.children.find(
          o => o instanceof THREE.Mesh && (o.material as THREE.MeshLambertMaterial).map,
        ) as THREE.Mesh,
        pos = skin.geometry.getAttribute('position'),
        [p, q, r, n] = [new THREE.Vector3(), new THREE.Vector3(), new THREE.Vector3(), new THREE.Vector3()];
      expect(pos.count).toBeGreaterThan(0);
      for (let i = 0; i < pos.count; i += 3) {
        THREE.Triangle.getNormal(
          p.fromBufferAttribute(pos, i),
          q.fromBufferAttribute(pos, i + 1),
          r.fromBufferAttribute(pos, i + 2),
          n,
        );
        const cx = (p.x + q.x + r.x) / 3 - 5,
          cz = (p.z + q.z + r.z) / 3 - 5;
        expect(n.x * cx + n.z * cz, `triangle ${i / 3}`).toBeGreaterThan(0);
      }
    }
  });
});
