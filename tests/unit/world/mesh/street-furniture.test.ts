import * as THREE from 'three';
import { describe, expect, it } from 'vitest';
import { FURNITURE, type FurnitureModelId, SHORT_LAMP_EMITTER } from '../../../../src/world/furniture/definitions';
import type { FurniturePlacement } from '../../../../src/world/furniture/placement';
import { FURNITURE_MODELS, StreetFurniture } from '../../../../src/world/mesh/street-furniture';

const BUDGET: Record<FurnitureModelId, number> = {
  'lamp-arm': 260,
  'lamp-arm-short': 260,
  'bench-wood': 300,
  'bin-green': 140,
  'wheelie-bin-green': 150,
  'wheelie-bin-black': 150,
  'mailbox-green': 80,
  'mailbox-grey': 80,
  'mailbox-black': 80,
  'mailbox-stand-3': 300,
  'mailbox-stand-4': 300,
  'mailbox-stand-5': 300,
  'mailbox-stand-6': 300,
  'street-cabinet': 60,
  'roadside-post': 50, // four boxes
  'silage-bale-white': 60, // a 14-sided cylinder
  'silage-bale-green': 60,
};
const tris = (g?: THREE.BufferGeometry) => (g ? g.getAttribute('position').count / 3 : 0);
const place = (
  id: string,
  modelId: FurnitureModelId,
  x: number,
  z: number,
  rotationY = 0,
  source: FurniturePlacement['source'] = 'procedural',
) =>
  ({
    id,
    kind: modelId.startsWith('lamp') ? 'street-lamp' : modelId === 'bench-wood' ? 'bench' : 'waste-bin',
    modelId,
    x,
    z,
    rotationY,
    scale: 1,
    source,
  }) as FurniturePlacement;

describe('street furniture models', () => {
  it.each(Object.keys(BUDGET) as FurnitureModelId[])(
    '%s stays within its triangle budget, faces outwards and stands on the ground',
    id => {
      const m = FURNITURE_MODELS[id]();
      expect(tris(m.body) + tris(m.glass)).toBeLessThanOrEqual(BUDGET[id]);
      for (const g of [m.body, m.glass]) {
        if (!g) continue;
        const p = g.getAttribute('position');
        const n = g.getAttribute('normal');
        const a = new THREE.Vector3();
        const b = new THREE.Vector3();
        const c = new THREE.Vector3();
        const face = new THREE.Vector3();
        const vn = new THREE.Vector3();
        for (let i = 0; i < p.count; i += 3) {
          a.fromBufferAttribute(p, i);
          b.fromBufferAttribute(p, i + 1);
          c.fromBufferAttribute(p, i + 2);
          face.subVectors(c, b).cross(a.clone().sub(b)).normalize();
          vn.fromBufferAttribute(n, i);
          if (face.lengthSq() > 0.5) expect(face.dot(vn)).toBeGreaterThan(0); // counter-clockwise from outside
        }
        g.computeBoundingBox();
        expect(g.boundingBox!.min.y).toBeGreaterThanOrEqual(-1e-6);
      }
      g_dispose(m);
    },
  );

  it('matches the footprints and heights placement uses, and puts the lamp glass where the emitter is', () => {
    for (const [kind, id] of [
      ['bench', 'bench-wood'],
      ['waste-bin', 'bin-green'],
      ['street-lamp', 'lamp-arm'],
      ['wheelie-bin', 'wheelie-bin-green'],
      ['mailbox', 'mailbox-green'],
      ['mailbox-stand', 'mailbox-stand-6'],
      ['street-cabinet', 'street-cabinet'],
    ] as const) {
      const m = FURNITURE_MODELS[id]();
      m.body.computeBoundingBox();
      const size = m.body.boundingBox!.getSize(new THREE.Vector3());
      const d = FURNITURE[kind];
      expect(size.y).toBeCloseTo(d.heightM, 0);
      if (kind !== 'street-lamp') {
        expect(size.x).toBeLessThanOrEqual(d.widthM + 1e-6);
        expect(size.z).toBeLessThanOrEqual(d.depthM + 1e-6);
      }
      g_dispose(m);
    }
    for (const [id, e] of [
      ['lamp-arm', FURNITURE['street-lamp'].emitter!],
      ['lamp-arm-short', SHORT_LAMP_EMITTER],
    ] as const) {
      const m = FURNITURE_MODELS[id]();
      m.glass!.computeBoundingBox();
      const centre = m.glass!.boundingBox!.getCenter(new THREE.Vector3());
      expect(centre.x).toBeCloseTo(e.offset[0], 2);
      expect(centre.y).toBeCloseTo(e.offset[1], 2);
      expect(centre.z).toBeCloseTo(e.offset[2], 2);
      g_dispose(m);
    }
  });
});

function g_dispose(m: { body: THREE.BufferGeometry; glass?: THREE.BufferGeometry }) {
  m.body.dispose();
  m.glass?.dispose();
}

describe('StreetFurniture', () => {
  const placements = [
    place('a', 'lamp-arm', 10, 0, Math.PI / 2),
    place('b', 'lamp-arm', 40, 0),
    place('c', 'lamp-arm-short', 0, 50),
    place('d', 'bench-wood', 5, 5, 0, 'osm'),
    place('e', 'bin-green', 7, 5, 0, 'override'),
  ];

  it('draws one instanced mesh per model and per lamp glass, standing on the ground, no per-frame work', () => {
    const f = new StreetFurniture(placements, { groundAt: (x, z) => 0.01 * x + 0.02 * z });
    expect(f.meshes.length).toBe(6); // two lamp bodies and glasses, a bench, a bin
    expect(f.meshes.length).toBeLessThanOrEqual(6);
    const lamps = f.meshes.find(m => m.name === 'furniture:lamp-arm')!;
    expect(lamps.count).toBe(2);
    expect(lamps.castShadow && lamps.receiveShadow).toBe(true);
    expect(f.meshes.find(m => m.name === 'furniture:lamp-arm:glass')!.castShadow).toBe(false);
    expect(lamps.matrixAutoUpdate).toBe(false);
    const m = new THREE.Matrix4();
    const pos = new THREE.Vector3();
    lamps.getMatrixAt(0, m);
    pos.setFromMatrixPosition(m);
    expect(pos.x).toBe(10);
    expect(pos.y).toBeCloseTo(0.1, 6);
    expect(pos.z).toBe(0);
    // rotationY π/2 turns the arm (+z) to +x
    const arm = new THREE.Vector3(0, 0, 1).applyQuaternion(new THREE.Quaternion().setFromRotationMatrix(m));
    expect(arm.x).toBeCloseTo(1, 9);
    expect(f.triangles).toBeGreaterThan(0);
    f.dispose();
  });

  it('splits a model into cells, so meshes far apart are culled apart', () => {
    const far = new StreetFurniture([place('a', 'lamp-arm', 10, 0), place('b', 'lamp-arm', 1010, 0)], {
      groundAt: () => 0,
    });
    const lamps = far.meshes.filter(m => m.name === 'furniture:lamp-arm');
    expect(lamps.map(m => m.count)).toEqual([1, 1]);
    for (const m of lamps) expect(m.boundingSphere!.radius).toBeLessThan(10); // one lamp, not the 1 km between them
    far.dispose();
  });

  it('tints by source in the debug view, and only there', () => {
    expect(new StreetFurniture(placements, { groundAt: () => 0 }).meshes.every(m => m.instanceColor === null)).toBe(
      true,
    );
    const debug = new StreetFurniture(placements, { groundAt: () => 0, debugSources: true });
    const bench = debug.meshes.find(m => m.name === 'furniture:bench-wood')!;
    const c = new THREE.Color();
    bench.getColorAt(0, c);
    expect(c.getHex()).toBe(new THREE.Color(0x3fae5a).convertSRGBToLinear().getHex()); // OSM green
  });

  it('frees every geometry and material it made', () => {
    const f = new StreetFurniture(placements, { groundAt: () => 0 });
    const disposed = new Set<object>();
    for (const m of f.meshes) m.geometry.addEventListener('dispose', () => disposed.add(m.geometry));
    for (const mat of [f.materials.body, f.materials.luminaire])
      mat.addEventListener('dispose', () => disposed.add(mat));
    f.dispose();
    expect(disposed.size).toBe(f.meshes.length + 2);
  });
});
