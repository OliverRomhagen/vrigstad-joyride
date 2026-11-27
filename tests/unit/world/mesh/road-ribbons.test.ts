import * as THREE from 'three';
import { describe, expect, it } from 'vitest';
import { BridgeIndex } from '../../../../src/world/bridges';
import { ROAD_WIDTH_M, RoadClass, Surface } from '../../../../src/world/data';
import { RoadRibbons, SURFACE_BLEND_M, TILE_M } from '../../../../src/world/mesh/road-ribbons';
import { type Point, RoadNetwork, roadLiftM } from '../../../../src/world/roads';
import { makeWorld } from '../fixture';

const TERRAIN_M = 2;
const terrainAt = (heightM: number) => ({ heightAt: () => heightM });
// a primary road along z = 0, from x = -40 to 40
const MAIN_ROAD = { c: RoadClass.PRIMARY, n: 'Storgatan', p: [-40, 0, 40, 0] };
const SURFACE_COLOURS = [
  0x101010, 0x202020, 0x303030, 0x404040, 0x505050, 0x606060, 0x707070,
] as const satisfies Record<Surface, number>;

describe('RoadRibbons', () => {
  const asphalt = new THREE.Texture();
  const roads = new RoadNetwork(makeWorld({ r: [MAIN_ROAD] }), terrainAt(TERRAIN_M));
  const ribbons = new RoadRibbons(roads, terrainAt(TERRAIN_M), {
    asphalt,
    surfaceColours: SURFACE_COLOURS,
    centreLineColour: 0xffffff,
  });

  it('tints the asphalt it is given on the road, and not on the centre line', () => {
    expect(ribbons.meshes).toHaveLength(2);
    const [road, centreLine] = ribbons.meshes;
    expect((road.material as THREE.MeshLambertMaterial).map).toBe(asphalt);
    expect((centreLine.material as THREE.MeshLambertMaterial).map).toBeNull();
  });

  it('lifts the road its class height over the terrain', () => {
    const pos = ribbons.meshes[0].geometry.getAttribute('position');
    for (let i = 0; i < pos.count; i++) expect(pos.getY(i)).toBeCloseTo(TERRAIN_M + roadLiftM(RoadClass.PRIMARY), 5);
  });

  it('leaves the asphalt to its owner on dispose', () => {
    let freed = false;
    asphalt.addEventListener('dispose', () => {
      freed = true;
    });
    ribbons.dispose();
    expect(freed).toBe(false);
  });
});

// RoadRibbons' sampling as it was before polyline.ts (#187), copied verbatim, so the move is proven not to change a vertex.
function legacyRibbon(
  out: number[],
  uvOut: number[],
  points: Point[],
  width: number,
  lift: number,
  heightfield: { heightAt(x: number, z: number): number },
) {
  const STEP_M = 6;
  const TILE_M = 4;
  const q: Point[] = [points[0]];
  for (let i = 1; i < points.length; i++) {
    const a = points[i - 1];
    const b = points[i];
    const steps = Math.max(1, Math.ceil(Math.hypot(b[0] - a[0], b[1] - a[1]) / STEP_M));
    for (let s = 1; s <= steps; s++) q.push([a[0] + ((b[0] - a[0]) * s) / steps, a[1] + ((b[1] - a[1]) * s) / steps]);
  }
  let pl: number[] = [];
  let pr: number[] = [];
  let v = 0;
  let pv = 0;
  const u = width / TILE_M;
  for (let i = 0; i < q.length; i++) {
    const a = q[Math.max(0, i - 1)];
    const b = q[Math.min(q.length - 1, i + 1)];
    let dx = b[0] - a[0];
    let dz = b[1] - a[1];
    const length = Math.hypot(dx, dz) || 1;
    dx /= length;
    dz /= length;
    const nx = (-dz * width) / 2;
    const nz = (dx * width) / 2;
    const l = [q[i][0] - nx, 0, q[i][1] - nz];
    const r = [q[i][0] + nx, 0, q[i][1] + nz];
    l[1] = heightfield.heightAt(l[0], l[2]) + lift;
    r[1] = heightfield.heightAt(r[0], r[2]) + lift;
    if (i > 0) {
      v += Math.hypot(q[i][0] - q[i - 1][0], q[i][1] - q[i - 1][1]) / TILE_M;
      out.push(
        pl[0],
        pl[1],
        pl[2],
        l[0],
        l[1],
        l[2],
        r[0],
        r[1],
        r[2],
        pl[0],
        pl[1],
        pl[2],
        r[0],
        r[1],
        r[2],
        pr[0],
        pr[1],
        pr[2],
      );
      uvOut.push(0, pv, 0, v, u, v, 0, pv, u, v, u, pv);
    }
    pl = l;
    pr = r;
    pv = v;
  }
}

describe('RoadRibbons after the move to polyline.ts', () => {
  // curves, a slope, a very short span, a repeated vertex and a hairpin
  const hilly = { heightAt: (x: number, z: number) => 0.13 * x - 0.07 * z + Math.sin(x * 0.11) * 1.7 };
  const lines = [
    { c: RoadClass.PRIMARY, n: '', p: [-40, 0, -10, 3, 0, 12, 4, 30, 4, 30.4, 30, 31] },
    { c: RoadClass.STREET, n: '', p: [10, -40, 12, -12, 12, -12, 30, -11, 13, -10] },
    { c: RoadClass.PATH, n: '', p: [-30, 30, -29.9, 30.05] },
  ];
  const ribbons = new RoadRibbons(new RoadNetwork(makeWorld({ r: lines }), hilly), hilly, {
    asphalt: new THREE.Texture(),
    surfaceColours: SURFACE_COLOURS,
    centreLineColour: 0xffffff,
  });

  it('gives exactly the vertices the old sampling gave', () => {
    const want: number[][] = [[], [], [], [], [], [], []];
    const wantUv: number[][] = [[], [], [], [], [], [], []];
    for (const l of lines) {
      const p: Point[] = [];
      for (let i = 0; i < l.p.length; i += 2) p.push([l.p[i], l.p[i + 1]]);
      legacyRibbon(want[l.c], wantUv[l.c], p, ROAD_WIDTH_M[l.c], roadLiftM(l.c), hilly);
      if (l.c < 2) legacyRibbon(want[6], wantUv[6], p, 0.2, 0.3, hilly);
    }
    const got = ribbons.meshes.map(m => Array.from(m.geometry.getAttribute('position').array as Float32Array));
    const f32 = (a: number[]) => Array.from(new Float32Array(a));
    expect(got).toEqual(want.filter(a => a.length).map(f32)); // the UVs moved to world space on purpose (#399)
  });

  it('puts the l edge on the left of the way, as OSM means left', () => {
    // a way heading north (towards -z): its left is west (-x)
    const north = new RoadRibbons(
      new RoadNetwork(makeWorld({ r: [{ c: RoadClass.STREET, n: '', p: [0, 10, 0, -10] }] }), terrainAt(0)),
      terrainAt(0),
      {
        asphalt: new THREE.Texture(),
        surfaceColours: SURFACE_COLOURS,
        centreLineColour: 0xffffff,
      },
    );
    const pos = north.meshes[0].geometry.getAttribute('position');
    // each quad is pl, l, r, pl, r, pr: vertex 1 is the l edge, vertex 2 the r edge
    expect(pos.getX(1)).toBeCloseTo(-ROAD_WIDTH_M[RoadClass.STREET] / 2, 6);
    expect(pos.getX(2)).toBeCloseTo(ROAD_WIDTH_M[RoadClass.STREET] / 2, 6);
  });
});

describe('RoadRibbons by surface (#399)', () => {
  // two streets in one class mesh, apart: a mapped paving one and an untagged one, which surfaceOf makes asphalt
  const lines = [
    { c: RoadClass.STREET, n: '', p: [0, 0, 30, 0], sf: Surface.PAVING },
    { c: RoadClass.STREET, n: '', p: [40, 0, 40, 30] },
  ];
  const ribbons = new RoadRibbons(new RoadNetwork(makeWorld({ r: lines }), terrainAt(0)), terrainAt(0), {
    asphalt: new THREE.Texture(),
    surfaceColours: SURFACE_COLOURS,
    centreLineColour: 0xffffff,
  });
  const [street] = ribbons.meshes;

  it('colours each road by its surface, per vertex, on a white material', () => {
    expect(ribbons.meshes).toHaveLength(1); // still one mesh for the class
    expect((street.material as THREE.MeshLambertMaterial).vertexColors).toBe(true);
    expect((street.material as THREE.MeshLambertMaterial).color.getHex()).toBe(0xffffff);
    const pos = street.geometry.getAttribute('position'),
      col = street.geometry.getAttribute('color'),
      paving = ribbons.surfaceColour(Surface.PAVING),
      asphalt = ribbons.surfaceColour(Surface.ASPHALT);
    expect(col.count).toBe(pos.count);
    // the paving street is first in the data, so its vertices lead the buffer: 30 m at 6 m a step, five quads of six
    const pavingVertices = 5 * 6;
    for (let i = 0; i < pos.count; i++) {
      const want = i < pavingVertices ? paving : asphalt;
      expect([col.getX(i), col.getY(i), col.getZ(i)]).toEqual([want.r, want.g, want.b].map(v => Math.fround(v)));
    }
    expect(paving.equals(new THREE.Color(SURFACE_COLOURS[Surface.PAVING]).convertSRGBToLinear())).toBe(true);
  });

  it('maps the asphalt in world space, so overlapping ribbons show the same speckle', () => {
    const pos = street.geometry.getAttribute('position'),
      uv = street.geometry.getAttribute('uv');
    for (let i = 0; i < pos.count; i++) {
      expect(uv.getX(i)).toBeCloseTo(pos.getX(i) / TILE_M, 5);
      expect(uv.getY(i)).toBeCloseTo(pos.getZ(i) / TILE_M, 5);
    }
  });
});

describe('RoadRibbons where the surface changes (#399)', () => {
  // a gravel track leaving the middle of an asphalt street, north from (0, 0), and a second street continuing the first
  const lines = [
    { c: RoadClass.STREET, n: '', p: [-30, 0, 0, 0, 30, 0] },
    { c: RoadClass.TRACK, n: '', p: [0, 0, 0, -30] },
    { c: RoadClass.STREET, n: '', p: [30, 0, 60, 0] },
  ];
  const ribbons = new RoadRibbons(new RoadNetwork(makeWorld({ r: lines }), terrainAt(0)), terrainAt(0), {
    asphalt: new THREE.Texture(),
    surfaceColours: SURFACE_COLOURS,
    centreLineColour: 0xffffff,
  });
  const meshOf = (c: RoadClass) =>
    ribbons.meshes.find(m => m.geometry.getAttribute('color') && m.renderOrder === 6 - c)!;
  const colourAt = (m: THREE.Mesh, i: number) => {
    const col = m.geometry.getAttribute('color');
    return new THREE.Color(col.getX(i), col.getY(i), col.getZ(i));
  };
  const asphalt = ribbons.surfaceColour(Surface.ASPHALT),
    gravel = ribbons.surfaceColour(Surface.GRAVEL);

  it('fades the softer road in from the harder one over SURFACE_BLEND_M, and no further', () => {
    const track = meshOf(RoadClass.TRACK),
      pos = track.geometry.getAttribute('position');
    let atJunction = 0;
    for (let i = 0; i < pos.count; i++) {
      const along = -pos.getZ(i), // the track runs north from the junction, towards -z
        c = colourAt(track, i);
      if (along < 0.01) {
        atJunction++;
        expect(c.r).toBeCloseTo(asphalt.r, 5);
      } else if (along >= SURFACE_BLEND_M) expect(c.r).toBeCloseTo(gravel.r, 5);
      else expect(c.r).toBeGreaterThan(Math.min(asphalt.r, gravel.r) - 1e-6);
    }
    expect(atJunction).toBeGreaterThan(0);
  });

  it('leaves the harder road, and roads meeting one of their own surface, as they are', () => {
    const streets = meshOf(RoadClass.STREET),
      n = streets.geometry.getAttribute('color').count;
    for (let i = 0; i < n; i++) {
      const c = colourAt(streets, i);
      for (const k of ['r', 'g', 'b'] as const) expect(c[k]).toBeCloseTo(asphalt[k], 6); // stored as float32
    }
  });
});

describe('RoadRibbons on a bridge (#238)', () => {
  const asphalt = new THREE.Texture();
  const slope = { heightAt: (x: number) => 5 + 0.02 * x };
  const world = makeWorld({
    r: [
      { c: RoadClass.PRIMARY, n: '', p: [-40, 0, -10, 0], i: 1 },
      { c: RoadClass.PRIMARY, n: '', p: [-10, 0, 10, 0], i: 2, br: { l: 1 } },
    ],
  });
  const roads = new RoadNetwork(world, slope);
  const options = { asphalt, surfaceColours: SURFACE_COLOURS, centreLineColour: 0xffffff };
  const plain = new RoadRibbons(roads, slope, options);
  const bridges = new BridgeIndex(world, slope);
  const onDeck = new RoadRibbons(roads, slope, { ...options, heightOf: bridges.ribbonHeight.bind(bridges) });
  const positions = (r: RoadRibbons) => Array.from(r.meshes[0].geometry.getAttribute('position').array);

  it('leaves every other road exactly as it was', () => {
    // the approach is the first road, so its vertices lead the buffer
    const approach = 5 * 6 * 3; // 30 m at 6 m a step: five quads of six vertices, three numbers each
    expect(positions(onDeck).slice(0, approach)).toEqual(positions(plain).slice(0, approach));
  });

  it('follows the deck every metre on the bridge, matching groundAt', () => {
    const pos = onDeck.meshes[0].geometry.getAttribute('position');
    const ground = new RoadNetwork(world, slope, bridges);
    let n = 0;
    for (let i = 0; i < pos.count; i++) {
      const x = pos.getX(i);
      if (x <= -10) continue;
      n++;
      // the ribbon's edge is inside the deck, so the ground there is the carriageway's surface
      expect(pos.getY(i)).toBeCloseTo(ground.groundAt(x, pos.getZ(i) * 0.999), 5);
    }
    expect(n).toBe(20 * 6 - 3); // the first quad's three vertices at x = -10 are skipped with the approach's
    // the crest in the middle, where the slope's terrain is 5 m
    for (let i = 0; i < pos.count; i++)
      if (Math.abs(pos.getX(i)) < 1e-6) expect(pos.getY(i)).toBeCloseTo(5 + roadLiftM(RoadClass.PRIMARY) + 0.25, 5);
  });
});

describe('RoadRibbons skipping a road (#238)', () => {
  it('draws no ribbon for a road it is told to skip, and every other road as before', () => {
    const asphalt = new THREE.Texture();
    const roads = new RoadNetwork(
      makeWorld({ r: [MAIN_ROAD, { c: RoadClass.PATH, n: '', p: [0, -40, 0, 40] }] }),
      terrainAt(0),
    );
    const options = { asphalt, surfaceColours: SURFACE_COLOURS, centreLineColour: 0xffffff };
    const all = new RoadRibbons(roads, terrainAt(0), options);
    const skipped = new RoadRibbons(roads, terrainAt(0), { ...options, skip: ri => ri === 1 });
    // the path's mesh is gone; the primary road's and its centre line's are the same
    expect(skipped.meshes).toHaveLength(all.meshes.length - 1);
    const position = (r: RoadRibbons, i: number) => Array.from(r.meshes[i].geometry.getAttribute('position').array);
    expect(position(skipped, 0)).toEqual(position(all, 0));
  });
});
