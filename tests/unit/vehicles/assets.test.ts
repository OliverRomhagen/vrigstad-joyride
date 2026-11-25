import { readFileSync } from 'node:fs';
import { Box3, Vector3 } from 'three';
import { MeshoptDecoder } from 'three/addons/libs/meshopt_decoder.module.js';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';
import { expect, test } from 'vitest';
import {
  BODY_NODE,
  pickVariant,
  VEHICLE_VARIANTS,
  VEHICLES,
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
  const size = new Box3().setFromObject(scene).getSize(new Vector3());
  expect(size.x).toBeGreaterThan(1);
  expect(size.x).toBeLessThan(3);
  expect(size.y).toBeGreaterThan(1);
  expect(size.y).toBeLessThan(3);
  expect(size.z).toBeGreaterThan(3);
  expect(size.z).toBeLessThan(7);
});
test.each(VEHICLES)('$id has one static part per material on its body (#408)', async spec => {
  const bytes = readFileSync('src/public/' + spec.url);
  const json = JSON.parse(bytes.subarray(20, 20 + bytes.readUInt32LE(12)).toString()) as Gltf;
  expect(staticPartGroups(json)).toEqual([]); // exactly the compression tool's eligibility and material identity
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
