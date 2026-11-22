import * as THREE from 'three';
import { describe, expect, it } from 'vitest';
import data from '../../../../data/vrigstad.json';
import { BridgeIndex } from '../../../../src/world/bridges';
import { RoadClass, type WorldData } from '../../../../src/world/data';
import { Heightfield } from '../../../../src/world/heightfield';
import { BridgeMesh } from '../../../../src/world/mesh/bridge-mesh';
import { makeWorld } from '../fixture';

const materials = () => ({
  body: new THREE.MeshLambertMaterial({ vertexColors: true }),
  railing: new THREE.MeshLambertMaterial({ vertexColors: true }),
});
// a primary road bridge, a cycle footbridge and a short footway, on gently sloping ground far from the origin
const world = makeWorld({
  size: 2000,
  r: [
    { c: RoadClass.PRIMARY, n: '', p: [500, 500, 525, 502], i: 1, br: { l: 1 } },
    { c: RoadClass.PATH, n: '', p: [600, 600, 603, 608], i: 2, br: { l: 1, cy: 1 } },
    { c: RoadClass.PATH, n: '', p: [700, 700, 707, 700], i: 3, br: { l: 1 } },
  ],
});
const slope = { heightAt: (x: number, z: number) => 30 + 0.01 * x - 0.005 * z };

/** every directed edge has its reverse as often: closed, and wound one way throughout */
function closedAndConsistent(g: THREE.BufferGeometry) {
  const pos = g.getAttribute('position');
  const key = (i: number) => [pos.getX(i), pos.getY(i), pos.getZ(i)].map(v => v.toFixed(4)).join(',');
  const edges = new Map<string, number>();
  for (let t = 0; t < pos.count; t += 3)
    for (let k = 0; k < 3; k++) {
      const e = key(t + k) + '>' + key(t + ((k + 1) % 3));
      edges.set(e, (edges.get(e) ?? 0) + 1);
    }
  for (const [e, n] of edges) {
    const [a, b] = e.split('>');
    if ((edges.get(b + '>' + a) ?? 0) !== n) return false;
  }
  return true;
}

/** six times the signed volume: positive when the faces point outward */
function signedVolume(g: THREE.BufferGeometry) {
  const p = g.getAttribute('position');
  let v = 0;
  const a = new THREE.Vector3();
  const b = new THREE.Vector3();
  const c = new THREE.Vector3();
  for (let t = 0; t < p.count; t += 3) {
    a.fromBufferAttribute(p, t);
    b.fromBufferAttribute(p, t + 1);
    c.fromBufferAttribute(p, t + 2);
    v += a.dot(b.cross(c));
  }
  return v;
}

describe('BridgeMesh', () => {
  const index = new BridgeIndex(world, slope);
  const m = materials();
  const mesh = new BridgeMesh(index, { materials: m, top: false });

  it('builds a body and a railing per bridge, each archetype its own', () => {
    expect(index.bridges.map(b => b.archetype)).toEqual(['road-slab', 'path-steel', 'path-timber']);
    expect(mesh.meshes).toHaveLength(6);
    expect(mesh.meshes.map(x => x.material)).toEqual([m.body, m.railing, m.body, m.railing, m.body, m.railing]);
    expect(mesh.meshes.filter(x => x.castShadow)).toHaveLength(6);
    expect(mesh.triangles).toBeGreaterThan(0);
    expect(mesh.triangles).toBeLessThan(15000);
  });

  it('makes closed, outward-facing, finite bodies in coordinates local to each bridge', () => {
    for (const body of mesh.meshes.filter((_, i) => i % 2 === 0)) {
      const g = body.geometry;
      expect(closedAndConsistent(g)).toBe(true);
      expect(signedVolume(g)).toBeGreaterThan(0);
      for (const v of g.getAttribute('position').array) expect(Number.isFinite(v)).toBe(true);
      expect(g.boundingSphere!.center.length()).toBeLessThan(2);
      expect(body.position.x).toBeGreaterThan(400);
      expect(body.matrixAutoUpdate).toBe(false);
    }
  });

  it('keeps the railings on the deck, between its ends', () => {
    const [b] = index.bridges;
    const rail = mesh.meshes[1];
    const pos = rail.geometry.getAttribute('position');
    for (let i = 0; i < pos.count; i++) {
      const at = index.locate(b, pos.getX(i) + rail.position.x, pos.getZ(i) + rail.position.z);
      expect(at).not.toBeNull();
      expect(at!.s).toBeGreaterThan(0.2);
      expect(at!.s).toBeLessThan(b.spanM - 0.2);
      expect(Math.abs(at!.d)).toBeLessThanOrEqual(b.halfWidthM + 1e-3);
    }
    const box = new THREE.Box3().setFromObject(rail);
    // over the walkway's curb, about 1.1 m above it
    const deckTop = index.surfaceAt(b, 512.5, 501, b.spanM / 2);
    expect(box.max.y - deckTop).toBeGreaterThan(1);
    expect(box.max.y - deckTop).toBeLessThan(1.4);
  });

  it('keeps the deck top under the ribbon in the game, and draws it on the map', () => {
    const [b] = index.bridges;
    const topAt = (meshes: THREE.Mesh[]) => {
      const box = new THREE.Box3().setFromObject(meshes[0]);
      return box;
    };
    const game = topAt(mesh.meshes);
    const map = new BridgeMesh(index, { materials: materials(), top: true });
    expect(map.triangles).toBeGreaterThan(mesh.triangles);
    // the slab hangs 0.7 m under the driving surface
    expect(index.surfaceAt(b, 500, 500, 0) - game.min.y).toBeGreaterThan(0.6);
    map.dispose();
  });

  it('frees its geometry on dispose and leaves the materials to the page', () => {
    let geometries = 0;
    let freedMaterials = 0;
    for (const x of mesh.meshes) x.geometry.addEventListener('dispose', () => geometries++);
    m.body.addEventListener('dispose', () => freedMaterials++);
    mesh.dispose();
    expect(geometries).toBe(6);
    expect(freedMaterials).toBe(0);
  });
});

describe('BridgeMesh on the six mapped bridges', () => {
  const D = data as unknown as WorldData;
  const mesh = new BridgeMesh(new BridgeIndex(D, new Heightfield(D)), { materials: materials(), top: false });

  it('stays within the triangle budget of #238', () => {
    expect(mesh.meshes).toHaveLength(12);
    expect(mesh.triangles).toBeLessThan(15000);
    for (const body of mesh.meshes.filter((_, i) => i % 2 === 0)) expect(closedAndConsistent(body.geometry)).toBe(true);
  });
});
