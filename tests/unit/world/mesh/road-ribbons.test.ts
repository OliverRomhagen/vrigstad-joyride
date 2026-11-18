import * as THREE from 'three';
import { describe, expect, it } from 'vitest';
import { RoadClass } from '../../../../src/world/data';
import { RoadRibbons } from '../../../../src/world/mesh/road-ribbons';
import { type Point, RoadNetwork, roadLiftM } from '../../../../src/world/roads';
import { ROAD_WIDTH_M } from '../../../../src/world/data';
import { makeWorld } from '../fixture';

const TERRAIN_M = 2;
const terrainAt = (heightM: number) => ({ heightAt: () => heightM });
// a primary road along z = 0, from x = -40 to 40
const MAIN_ROAD = { c: RoadClass.PRIMARY, n: 'Storgatan', p: [-40, 0, 40, 0] };
const ROAD_COLOURS = [0x101010, 0x202020, 0x303030, 0x404040, 0x505050, 0x606060] as const;

describe('RoadRibbons', () => {
  const asphalt = new THREE.Texture();
  const roads = new RoadNetwork(makeWorld({ r: [MAIN_ROAD] }), terrainAt(TERRAIN_M));
  const ribbons = new RoadRibbons(roads, terrainAt(TERRAIN_M), { asphalt, roadColours: ROAD_COLOURS, centreLineColour: 0xffffff });

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
function legacyRibbon(out: number[], uvOut: number[], points: Point[], width: number, lift: number, heightfield: { heightAt(x: number, z: number): number }) {
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
          out.push(pl[0], pl[1], pl[2], l[0], l[1], l[2], r[0], r[1], r[2], pl[0], pl[1], pl[2], r[0], r[1], r[2], pr[0], pr[1], pr[2]);
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
    roadColours: ROAD_COLOURS,
    centreLineColour: 0xffffff,
  });

  it('gives exactly the vertices and UVs the old sampling gave', () => {
    const want: number[][] = [[], [], [], [], [], [], []];
    const wantUv: number[][] = [[], [], [], [], [], [], []];
    for (const l of lines) {
      const p: Point[] = [];
      for (let i = 0; i < l.p.length; i += 2) p.push([l.p[i], l.p[i + 1]]);
      legacyRibbon(want[l.c], wantUv[l.c], p, ROAD_WIDTH_M[l.c], roadLiftM(l.c), hilly);
      if (l.c < 2) legacyRibbon(want[6], wantUv[6], p, 0.2, 0.3, hilly);
    }
    const got = ribbons.meshes.map((m) => Array.from(m.geometry.getAttribute('position').array as Float32Array));
    const gotUv = ribbons.meshes.map((m) => Array.from(m.geometry.getAttribute('uv').array as Float32Array));
    const f32 = (a: number[]) => Array.from(new Float32Array(a));
    expect(got).toEqual(want.filter((a) => a.length).map(f32));
    expect(gotUv).toEqual(wantUv.filter((a) => a.length).map(f32));
  });

  it('puts the l edge on the left of the way, as OSM means left', () => {
    // a way heading north (towards -z): its left is west (-x)
    const north = new RoadRibbons(new RoadNetwork(makeWorld({ r: [{ c: RoadClass.STREET, n: '', p: [0, 10, 0, -10] }] }), terrainAt(0)), terrainAt(0), {
      asphalt: new THREE.Texture(),
      roadColours: ROAD_COLOURS,
      centreLineColour: 0xffffff,
    });
    const pos = north.meshes[0].geometry.getAttribute('position');
    // each quad is pl, l, r, pl, r, pr: vertex 1 is the l edge, vertex 2 the r edge
    expect(pos.getX(1)).toBeCloseTo(-ROAD_WIDTH_M[RoadClass.STREET] / 2, 6);
    expect(pos.getX(2)).toBeCloseTo(ROAD_WIDTH_M[RoadClass.STREET] / 2, 6);
  });
});
