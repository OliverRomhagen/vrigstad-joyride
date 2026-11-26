import { type Mesh, Vector3 } from 'three';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';
import { expect, test } from 'vitest';
import { type Gltf, mergeStaticParts } from '../../../tools/vehicle-parts';

// A hand-made GLB: one triangle per part, so every merged vertex can be worked out.
// Materials: 0 paint, 1 rubber, 2 glass, 3 beacon.
const TRIANGLE = [0, 0, 0, 1, 0, 0, 0, 1, 0];
const UP = [0, 0, 1, 0, 0, 1, 0, 0, 1];
function glb(change?: (json: Gltf) => void): Buffer {
  const data = Buffer.from(new Float32Array([...TRIANGLE, ...UP]).buffer);
  const tri = (material: number) => ({ primitives: [{ attributes: { POSITION: 0, NORMAL: 1 }, material }] });
  const json = {
    asset: { version: '2.0' },
    scene: 0,
    scenes: [{ nodes: [0, 6] }],
    nodes: [
      { name: 'body', mesh: 0, children: [1, 2, 3, 4, 5, 8] },
      { name: 'trim_handle', mesh: 1, translation: [2, 0, 0] },
      { name: 'trim_handle.001', mesh: 1, scale: [-1, 1, 1] }, // mirrored, as the right side's copy is
      { name: 'glass_envelope', mesh: 2 },
      { name: 'lamp_blue_module', mesh: 3 },
      { name: 'lamp_blue_module.001', mesh: 3 },
      { name: 'wheel_fl', mesh: 1, translation: [0, -1, 0], children: [7] },
      { name: 'trim_rim_fl', mesh: 1 },
      { name: 'trim_badge', mesh: 1, rotation: [Math.SQRT1_2, 0, 0, Math.SQRT1_2] }, // a quarter turn about x
    ],
    meshes: [tri(0), tri(1), tri(2), tri(3)],
    materials: [{ name: 'paint' }, { name: 'rubber' }, { name: 'glass' }, { name: 'beacon' }],
    accessors: [
      { bufferView: 0, componentType: 5126, count: 3, type: 'VEC3', min: [0, 0, 0], max: [1, 1, 0] },
      { bufferView: 1, componentType: 5126, count: 3, type: 'VEC3' },
    ],
    bufferViews: [
      { buffer: 0, byteOffset: 0, byteLength: 36 },
      { buffer: 0, byteOffset: 36, byteLength: 36 },
    ],
    buffers: [{ byteLength: data.length }],
  };
  change?.(json);
  let text = Buffer.from(JSON.stringify(json));
  text = Buffer.concat([text, Buffer.alloc((4 - (text.length % 4)) % 4, 0x20)]);
  const chunk = (type: number, payload: Buffer) => {
    const head = Buffer.alloc(8);
    head.writeUInt32LE(payload.length, 0);
    head.writeUInt32LE(type, 4);
    return Buffer.concat([head, payload]);
  };
  const header = Buffer.alloc(12);
  header.writeUInt32LE(0x46546c67, 0);
  header.writeUInt32LE(2, 4);
  header.writeUInt32LE(12 + 16 + text.length + data.length, 8);
  return Buffer.concat([header, chunk(0x4e4f534a, text), chunk(0x004e4942, data)]);
}

test('static parts merge per material in the body space; named and moving parts stay', async () => {
  const { glb: out, report } = mergeStaticParts(glb());
  expect(report).toEqual({ before: 6, after: 4, merged: ['parts_rubber (3)'] });
  const { scene } = await new GLTFLoader().parseAsync(new Uint8Array(out).buffer, '');
  const body = scene.getObjectByName('body')!;
  expect(body.children.map(c => c.name).sort()).toEqual([
    'glass_envelope',
    'lamp_blue_module',
    'lamp_blue_module001', // three.js drops the dot; the game matches the prefix
    'parts_rubber',
  ]);
  expect(scene.getObjectByName('trim_handle')).toBeUndefined();
  expect(scene.getObjectByName('wheel_fl')!.children.map(c => c.name)).toEqual(['trim_rim_fl']);

  const merged = scene.getObjectByName('parts_rubber') as Mesh;
  const pos = merged.geometry.attributes.position!;
  const round = (v: Vector3) => v.toArray().map(c => Math.round(c * 1e6) / 1e6 + 0); // and -0 to 0
  const corners = [...merged.geometry.index!.array].map(i => round(new Vector3().fromBufferAttribute(pos, i)));
  const normals = [...merged.geometry.index!.array].map(i =>
    round(new Vector3().fromBufferAttribute(merged.geometry.attributes.normal!, i)),
  );
  // moved 2 m along x; mirrored in x with its winding turned, so it still faces +z; turned a quarter about x to face -y
  expect(corners.slice(0, 6)).toEqual([
    [2, 0, 0],
    [3, 0, 0],
    [2, 1, 0],
    [0, 0, 0],
    [0, 1, 0],
    [-1, 0, 0],
  ]);
  expect(corners.slice(6)).toEqual([
    [0, 0, 0],
    [1, 0, 0],
    [0, 0, 1],
  ]);
  // each triangle's stored normals agree with the side its winding faces
  for (let t = 0; t < 9; t += 3) {
    const [a, b, c] = corners.slice(t, t + 3).map(p => new Vector3(...p));
    const facing = b!.sub(a!).cross(c!.sub(a!)).normalize();
    for (const n of normals.slice(t, t + 3)) expect(new Vector3(...n).dot(facing)).toBeCloseTo(1);
  }
  expect(normals[3]).toEqual([0, 0, 1]);
  expect(normals[6]).toEqual([0, -1, 0]);
});

test('a car with nothing left to merge comes back unchanged', () => {
  const once = mergeStaticParts(glb()).glb;
  const twice = mergeStaticParts(once);
  expect(twice.report.merged).toEqual([]);
  expect(twice.glb).toBe(once);
});

test('a childless wheel under the body remains named and separate', () => {
  const input = glb(json => {
    json.nodes[6]!.children = [];
    json.nodes[0]!.children!.push(6);
  });
  const out = mergeStaticParts(input).glb;
  const json = JSON.parse(out.subarray(20, 20 + out.readUInt32LE(12)).toString()) as Gltf;
  expect(json.nodes.find(n => n.name === 'wheel_fl')?.mesh).toBeDefined();
});

test.each<[string, (json: Gltf) => void]>([
  [
    'morph targets',
    j => {
      j.meshes[1]!.primitives[0]!.targets = [{ POSITION: 0 }];
    },
  ],
  [
    'sparse attributes',
    j => {
      j.accessors[0]!.sparse = {};
    },
  ],
  [
    'skin',
    j => {
      j.nodes[1]!.skin = 0;
    },
  ],
  [
    'node extension',
    j => {
      j.nodes[1]!.extensions = { example: {} };
    },
  ],
  [
    'primitive extension',
    j => {
      j.meshes[1]!.primitives[0]!.extensions = { example: {} };
    },
  ],
  [
    'animation target',
    j => {
      j.animations = [{ channels: [{ target: { node: 1 } }] }];
    },
  ],
])('keeps a part with %s untouched', (_name, change) => {
  const out = mergeStaticParts(glb(change)).glb;
  const json = JSON.parse(out.subarray(20, 20 + out.readUInt32LE(12)).toString()) as Gltf;
  expect(json.nodes.find(n => n.name === 'trim_handle')?.mesh).toBe(1);
});

test('bounds do not spread a dense material into function arguments', () => {
  const out = mergeStaticParts(
    glb(json => {
      const part = json.meshes[1]!.primitives[0]!;
      json.meshes[1]!.primitives = Array.from({ length: 23000 }, () => part);
    }),
  ).glb;
  const json = JSON.parse(out.subarray(20, 20 + out.readUInt32LE(12)).toString()) as Gltf;
  const mesh = json.nodes.find(n => n.name === 'parts_rubber')!.mesh!;
  const position = json.meshes[mesh]!.primitives[0]!.attributes.POSITION!;
  expect(json.accessors[position]!.count).toBe(207000);
  expect(json.accessors[position]!.min!.map(v => Math.round(v * 1e6) / 1e6 + 0)).toEqual([-1, 0, 0]);
  expect(json.accessors[position]!.max!.map(v => Math.round(v * 1e6) / 1e6 + 0)).toEqual([3, 1, 1]);
});

test('UV-mapped trim stays unmerged', () => {
  const input = glb(j => {
    j.meshes[1]!.primitives[0]!.attributes.TEXCOORD_0 = 0;
  });
  expect(mergeStaticParts(input).glb).toBe(input);
});

test('different unnamed materials are not treated as one', () => {
  const input = glb(j => {
    j.materials = [{}, {}, {}, {}, {}, {}];
    j.nodes[2]!.mesh = j.meshes.push({ primitives: [{ attributes: { POSITION: 0, NORMAL: 1 }, material: 4 }] }) - 1;
    j.nodes[8]!.mesh = j.meshes.push({ primitives: [{ attributes: { POSITION: 0, NORMAL: 1 }, material: 5 }] }) - 1;
  });
  expect(mergeStaticParts(input).report.merged).toEqual([]);
});
