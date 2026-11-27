import { readFileSync } from 'node:fs';
import { Box3, Mesh, Vector3 } from 'three';
import { MeshoptDecoder } from 'three/addons/libs/meshopt_decoder.module.js';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';
import { expect, test } from 'vitest';
import {
  BODY_NODE,
  pickVariant,
  VEHICLE_VARIANTS,
  VEHICLES,
  type VehicleLamps,
  WHEEL_NODES,
} from '../../../src/game/render/vehicle-registry';
import { type Gltf, staticPartGroups } from '../../../tools/vehicle-parts';

const loader = new GLTFLoader().setMeshoptDecoder(MeshoptDecoder);
test.each(VEHICLES)('$id decodes with named body, wheel hubs and metre dimensions', async spec => {
  const bytes = readFileSync('src/public/' + spec.url);
  const json = JSON.parse(bytes.subarray(20, 20 + bytes.readUInt32LE(12)).toString());
  expect(json.extensionsRequired).toContain('EXT_meshopt_compression');
  const { scene } = await loader.parseAsync(new Uint8Array(bytes).buffer, '');
  scene.updateMatrixWorld(true);
  expect(scene.getObjectByName(BODY_NODE)).toBeDefined();
  for (const name of WHEEL_NODES) expect(scene.getObjectByName(name)).toBeDefined();
  scene.traverse(node => expect(node.matrixWorld.elements.every(Number.isFinite)).toBe(true));
  const front = scene.getObjectByName('wheel_fl')!.getWorldPosition(new Vector3());
  const rear = scene.getObjectByName('wheel_rl')!.getWorldPosition(new Vector3());
  expect(front.z).toBeLessThan(rear.z);
  expect(front.x).toBeLessThan(0);
  expect(Math.abs(rear.z - front.z - spec.wheelbase)).toBeLessThan(0.002);
  expect(Math.abs(rear.z - spec.rearAxle)).toBeLessThan(0.002); // the car turns about this point while gripping
  const box = new Box3().setFromObject(scene, true);
  const size = box.getSize(new Vector3());
  expect(size.x).toBeGreaterThan(1);
  expect(size.x).toBeLessThan(3);
  expect(size.y).toBeGreaterThan(1);
  expect(size.y).toBeLessThan(3);
  expect(Math.abs(size.z - spec.length)).toBeLessThan(0.005); // registry hitbox length follows the delivered model, within 5 mm
  const ahead = 'bodyAhead' in spec ? spec.bodyAhead : 0;
  expect(Math.abs(-box.getCenter(new Vector3()).z - ahead)).toBeLessThan(0.005); // and so does where it sits (#471)
  expect(size.z).toBeGreaterThan(3);
  expect(size.z).toBeLessThan(7);
});
test.each(VEHICLES)('$id has one static part per material on its body (#408)', async spec => {
  const bytes = readFileSync('src/public/' + spec.url);
  const json = JSON.parse(bytes.subarray(20, 20 + bytes.readUInt32LE(12)).toString()) as Gltf;
  expect(staticPartGroups(json)).toEqual([]); // exactly the compression tool's eligibility and material identity
});
test.each(VEHICLES)('$id has head and rear lamps, and every lamp it names is one of its meshes (#304)', spec => {
  const bytes = readFileSync('src/public/' + spec.url);
  const json = JSON.parse(bytes.subarray(20, 20 + bytes.readUInt32LE(12)).toString()) as {
    nodes: { name?: string; mesh?: number }[];
  };
  const meshes = new Set(json.nodes.filter(n => n.mesh !== undefined).map(n => n.name));
  const lamps: VehicleLamps = spec.lamps;
  expect(lamps.head.length).toBeGreaterThan(0);
  expect(lamps.rear.length).toBeGreaterThan(0);
  for (const name of Object.values(lamps).flat()) expect(meshes, name).toContain(name);
});
test('every model is in the world, worn only by its own simulation type', () => {
  const used = Object.entries(VEHICLE_VARIANTS).flatMap(([archetype, variants]) =>
    variants.map(([id]) => {
      expect(VEHICLES.find(model => model.id === id)?.archetype).toBe(archetype);
      return id;
    }),
  );
  expect(new Set(used)).toEqual(new Set(VEHICLES.map(model => model.id)));
});
test('variant rolls follow the weights', () => {
  expect(pickVariant('volvo', 0)).toBe('volvo240');
  expect(pickVariant('volvo', 0.79)).toBe('volvo240');
  expect(pickVariant('volvo', 0.8)).toBe('impala1970');
  expect(pickVariant('saab', 0.999)).toBe('micra-k11');
  expect(pickVariant('traktor', 0.5)).toBeUndefined();
});

test.each(VEHICLES.filter(v => v.id === 'xc70' || v.id === 'xc70-police'))(
  '$id stays within the delivery budget',
  async spec => {
    const bytes = readFileSync('src/public/' + spec.url);
    expect(bytes.length).toBeLessThan(300000);
    const { scene } = await loader.parseAsync(new Uint8Array(bytes).buffer, '');
    let triangles = 0;
    scene.traverse(o => {
      if (o instanceof Mesh) triangles += (o.geometry.index?.count ?? o.geometry.attributes.position!.count) / 3;
    });
    expect(triangles).toBeLessThan(36000); // counts every rendered wheel instance, not just unique meshes
  },
);
