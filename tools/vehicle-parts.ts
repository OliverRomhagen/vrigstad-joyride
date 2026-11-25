// Merges a vehicle GLB's static parts into one mesh per material before compression (#408): each mesh is a draw
// call, and most cars arrive as dozens of small parts (handles, lamps, trim) that never move on their own.
//
// Only the body's direct children are merged, in the body's space, so they still ride the suspension with it. Kept as
// they are: the body (the game paints it), glass_* (it cracks), body_* (painted with the body), the police beacons
// (they flash), the wheels and everything under them (they spin), and any part with attributes other than position
// and normal. The geometry is copied exactly, transformed into the body's space.

import { BODY_NODE, keepVehiclePart } from '../src/game/render/vehicle-registry';

const GLB_MAGIC = 0x46546c67;
const JSON_CHUNK = 0x4e4f534a;
const BIN_CHUNK = 0x004e4942;
const FLOAT = 5126;
const UINT32 = 5125;
const TRIANGLES = 4;

interface Accessor {
  sparse?: unknown;
  bufferView?: number;
  byteOffset?: number;
  componentType: number;
  count: number;
  type: string;
  min?: number[];
  max?: number[];
}
interface Primitive {
  targets?: unknown[];
  extensions?: unknown;
  attributes: Record<string, number>;
  indices?: number;
  material?: number;
  mode?: number;
}
interface Node {
  skin?: number;
  extensions?: unknown;
  name?: string;
  mesh?: number;
  children?: number[];
  matrix?: number[];
  translation?: number[];
  rotation?: number[];
  scale?: number[];
}
export interface Gltf {
  animations?: { channels: { target: { node?: number } }[] }[];
  nodes: Node[];
  meshes: { name?: string; primitives: Primitive[] }[];
  materials?: { name?: string }[];
  accessors: Accessor[];
  bufferViews: { buffer: number; byteOffset?: number; byteLength: number; byteStride?: number; target?: number }[];
  buffers: { byteLength: number }[];
}

/** What merging did, for the compression log and the tests. */
export interface MergeReport {
  before: number;
  after: number;
  merged: string[];
}

/** The column-major 4×4 matrix of a node's local transform. */
function localMatrix(node: Node): number[] {
  if (node.matrix) return node.matrix;
  const [tx, ty, tz] = node.translation ?? [0, 0, 0];
  const [x, y, z, w] = node.rotation ?? [0, 0, 0, 1];
  const [sx, sy, sz] = node.scale ?? [1, 1, 1];
  return [
    (1 - 2 * (y * y + z * z)) * sx,
    2 * (x * y + z * w) * sx,
    2 * (x * z - y * w) * sx,
    0,
    2 * (x * y - z * w) * sy,
    (1 - 2 * (x * x + z * z)) * sy,
    2 * (y * z + x * w) * sy,
    0,
    2 * (x * z + y * w) * sz,
    2 * (y * z - x * w) * sz,
    (1 - 2 * (x * x + y * y)) * sz,
    0,
    tx,
    ty,
    tz,
    1,
  ];
}

const COMPONENTS: Record<string, number> = { SCALAR: 1, VEC3: 3 };

function read(gltf: Gltf, bin: Buffer, index: number): number[] {
  const a = gltf.accessors[index]!;
  const view = gltf.bufferViews[a.bufferView!]!;
  const n = COMPONENTS[a.type]!;
  const size = a.componentType === FLOAT || a.componentType === UINT32 ? 4 : a.componentType === 5123 ? 2 : 1;
  const stride = view.byteStride ?? n * size;
  const start = (view.byteOffset ?? 0) + (a.byteOffset ?? 0);
  const out: number[] = [];
  for (let i = 0; i < a.count; i++)
    for (let k = 0; k < n; k++) {
      const at = start + i * stride + k * size;
      out.push(
        a.componentType === FLOAT
          ? bin.readFloatLE(at)
          : a.componentType === UINT32
            ? bin.readUInt32LE(at)
            : size === 2
              ? bin.readUInt16LE(at)
              : bin.readUInt8(at),
      );
    }
  return out;
}

/** Whether a primitive can be merged: indexed or not, triangles, float positions and normals and nothing else. */
function plain(gltf: Gltf, p: Primitive): boolean {
  const keys = Object.keys(p.attributes).sort().join();
  if (p.targets?.length || p.extensions) return false;
  if (
    Object.values(p.attributes).some(i => gltf.accessors[i]!.sparse) ||
    (p.indices !== undefined && gltf.accessors[p.indices]!.sparse)
  )
    return false;
  if (keys !== 'NORMAL,POSITION' || (p.mode ?? TRIANGLES) !== TRIANGLES || p.material === undefined) return false;
  const pos = gltf.accessors[p.attributes.POSITION!]!;
  const nrm = gltf.accessors[p.attributes.NORMAL!]!;
  return (
    pos.componentType === FLOAT &&
    nrm.componentType === FLOAT &&
    pos.bufferView !== undefined &&
    nrm.bufferView !== undefined
  );
}

/** Material groups eligible for merging; shared with the committed-asset check. */
export function staticPartGroups(gltf: Gltf) {
  const children = gltf.nodes.find(n => n.name === BODY_NODE)?.children ?? [];
  const animated = new Set(gltf.animations?.flatMap(a => a.channels.map(c => c.target.node)));
  // a part merges only if it is a plain mesh with no children, and every one of its primitives is plain
  const mergeable = children.filter(c => {
    const n = gltf.nodes[c]!;
    return (
      n.mesh !== undefined &&
      !n.children?.length &&
      !keepVehiclePart(n.name ?? '') &&
      n.skin === undefined &&
      !n.extensions &&
      !animated.has(c) &&
      gltf.meshes[n.mesh]!.primitives.every(p => plain(gltf, p))
    );
  });
  const groups = new Map<number, { node: number; primitive: Primitive }[]>();
  for (const c of mergeable)
    for (const primitive of gltf.meshes[gltf.nodes[c]!.mesh!]!.primitives) {
      const group = groups.get(primitive.material!) ?? [];
      group.push({ node: c, primitive });
      groups.set(primitive.material!, group);
    }
  // a material on one primitive gains nothing; leave its part alone unless another of its materials merges
  const merging = [...groups].filter(([, parts]) => parts.length > 1);
  const touched = new Set(merging.flatMap(([, parts]) => parts.map(p => p.node)));
  for (const [material, parts] of groups)
    if (parts.length === 1 && touched.has(parts[0]!.node)) merging.push([material, parts]);
  return merging;
}

export function mergeStaticParts(glb: Buffer): { glb: Buffer; report: MergeReport } {
  if (glb.readUInt32LE(0) !== GLB_MAGIC || glb.readUInt32LE(16) !== JSON_CHUNK) throw new Error('Not a GLB');
  const jsonLength = glb.readUInt32LE(12);
  const gltf = JSON.parse(glb.subarray(20, 20 + jsonLength).toString()) as Gltf;
  const binStart = 20 + jsonLength;
  if (glb.readUInt32LE(binStart + 4) !== BIN_CHUNK || gltf.buffers.length !== 1)
    throw new Error('Expected one binary buffer');
  const bin = glb.subarray(binStart + 8, binStart + 8 + glb.readUInt32LE(binStart));
  const body = gltf.nodes.find(n => n.name === BODY_NODE);
  if (!body) throw new Error('No body node');
  const children = body.children ?? [];
  const before = children.filter(c => gltf.nodes[c]!.mesh !== undefined).length;

  const merging = staticPartGroups(gltf);
  const touched = new Set(merging.flatMap(([, parts]) => parts.map(p => p.node)));
  if (!merging.length) return { glb, report: { before, after: before, merged: [] } };

  const chunks: Buffer[] = [bin];
  let length = bin.length;
  const append = (data: Buffer, target: number) => {
    const pad = (4 - (length % 4)) % 4;
    if (pad) {
      chunks.push(Buffer.alloc(pad));
      length += pad;
    }
    gltf.bufferViews.push({ buffer: 0, byteOffset: length, byteLength: data.length, target });
    chunks.push(data);
    length += data.length;
    return gltf.bufferViews.length - 1;
  };
  const added: number[] = [];
  const merged: string[] = [];
  for (const [material, parts] of merging.sort((a, b) => a[0] - b[0])) {
    const positions: number[] = [];
    const normals: number[] = [];
    const indices: number[] = [];
    for (const { node, primitive } of parts) {
      const m = localMatrix(gltf.nodes[node]!);
      // normals take the inverse transpose of the upper 3×3, the cofactor matrix over the determinant; a mirroring
      // transform (negative determinant) also flips the winding
      const [a, b, c, d, e, f, g, h, i] = [m[0]!, m[1]!, m[2]!, m[4]!, m[5]!, m[6]!, m[8]!, m[9]!, m[10]!];
      const det = a * (e * i - f * h) - d * (b * i - c * h) + g * (b * f - c * e);
      const s = Math.sign(det);
      const cof = [
        e * i - h * f,
        h * c - b * i,
        b * f - e * c,
        g * f - d * i,
        a * i - g * c,
        d * c - a * f,
        d * h - g * e,
        g * b - a * h,
        a * e - d * b,
      ].map(x => x * s);
      const base = positions.length / 3;
      const pos = read(gltf, bin, primitive.attributes.POSITION!);
      const nrm = read(gltf, bin, primitive.attributes.NORMAL!);
      for (let k = 0; k < pos.length; k += 3) {
        const [x, y, z] = [pos[k]!, pos[k + 1]!, pos[k + 2]!];
        positions.push(
          m[0]! * x + m[4]! * y + m[8]! * z + m[12]!,
          m[1]! * x + m[5]! * y + m[9]! * z + m[13]!,
          m[2]! * x + m[6]! * y + m[10]! * z + m[14]!,
        );
        const [u, v, w] = [nrm[k]!, nrm[k + 1]!, nrm[k + 2]!];
        const nx = cof[0]! * u + cof[1]! * v + cof[2]! * w;
        const ny = cof[3]! * u + cof[4]! * v + cof[5]! * w;
        const nz = cof[6]! * u + cof[7]! * v + cof[8]! * w;
        const len = Math.hypot(nx, ny, nz) || 1;
        normals.push(nx / len, ny / len, nz / len);
      }
      const own =
        primitive.indices !== undefined ? read(gltf, bin, primitive.indices) : [...Array(pos.length / 3).keys()];
      for (let k = 0; k < own.length; k += 3)
        if (det < 0) indices.push(base + own[k]!, base + own[k + 2]!, base + own[k + 1]!);
        else indices.push(base + own[k]!, base + own[k + 1]!, base + own[k + 2]!);
    }
    const min = [Infinity, Infinity, Infinity];
    const max = [-Infinity, -Infinity, -Infinity];
    for (let j = 0; j < positions.length; j++) {
      min[j % 3] = Math.min(min[j % 3]!, positions[j]!);
      max[j % 3] = Math.max(max[j % 3]!, positions[j]!);
    }
    const floats = (values: number[]) => Buffer.from(new Float32Array(values).buffer);
    const position =
      gltf.accessors.push({
        bufferView: append(floats(positions), 34962),
        componentType: FLOAT,
        count: positions.length / 3,
        type: 'VEC3',
        min,
        max,
      }) - 1;
    const normal =
      gltf.accessors.push({
        bufferView: append(floats(normals), 34962),
        componentType: FLOAT,
        count: normals.length / 3,
        type: 'VEC3',
      }) - 1;
    const index =
      gltf.accessors.push({
        bufferView: append(Buffer.from(new Uint32Array(indices).buffer), 34963),
        componentType: UINT32,
        count: indices.length,
        type: 'SCALAR',
      }) - 1;
    const name =
      'parts_' +
      (gltf.materials?.[material]?.name ?? String(material))
        .toLowerCase()
        .replace(/[^a-z0-9]+/g, '_')
        .replace(/^_|_$/g, '');
    const mesh =
      gltf.meshes.push({
        name,
        primitives: [{ attributes: { POSITION: position, NORMAL: normal }, indices: index, material }],
      }) - 1;
    added.push(gltf.nodes.push({ name, mesh }) - 1);
    merged.push(`${name} (${parts.length})`);
  }
  body.children = [...children.filter(c => !touched.has(c)), ...added];
  // the merged parts' old nodes stay in the array (indices elsewhere point past them), emptied, so gltfpack drops them
  for (const c of touched) {
    delete gltf.nodes[c]!.name;
    delete gltf.nodes[c]!.mesh;
  }
  const after = body.children.filter(c => gltf.nodes[c]!.mesh !== undefined).length;

  // their meshes and data stay in the file, unreferenced; gltfpack drops those too
  let json = Buffer.from(JSON.stringify({ ...gltf, buffers: [{ byteLength: length }] }));
  json = Buffer.concat([json, Buffer.alloc((4 - (json.length % 4)) % 4, 0x20)]);
  const data = Buffer.concat([...chunks, Buffer.alloc((4 - (length % 4)) % 4)]);
  const header = Buffer.alloc(12);
  header.writeUInt32LE(GLB_MAGIC, 0);
  header.writeUInt32LE(2, 4);
  header.writeUInt32LE(12 + 8 + json.length + 8 + data.length, 8);
  const chunk = (type: number, payload: Buffer) => {
    const h = Buffer.alloc(8);
    h.writeUInt32LE(payload.length, 0);
    h.writeUInt32LE(type, 4);
    return Buffer.concat([h, payload]);
  };
  return {
    glb: Buffer.concat([header, chunk(JSON_CHUNK, json), chunk(BIN_CHUNK, data)]),
    report: { before, after, merged },
  };
}
