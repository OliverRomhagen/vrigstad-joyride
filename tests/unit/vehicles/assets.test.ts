import { readFileSync } from 'node:fs';
import { expect, test } from 'vitest';
import { Box3, Vector3 } from 'three';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';
import { MeshoptDecoder } from 'three/addons/libs/meshopt_decoder.module.js';
import {
  BODY_NODE,
  WHEEL_NODES,
  VEHICLES,
  DEFAULT_VEHICLES,
} from '../../../src/game/render/vehicle-registry';

const loader = new GLTFLoader().setMeshoptDecoder(MeshoptDecoder);
test.each(VEHICLES)(
  '$id decodes with named body, wheel hubs and metre dimensions',
  async (spec) => {
    const bytes = readFileSync('src/public/' + spec.url);
    const json = JSON.parse(bytes.subarray(20, 20 + bytes.readUInt32LE(12)).toString());
    expect(json.extensionsRequired).toContain('EXT_meshopt_compression');
    const { scene } = await loader.parseAsync(new Uint8Array(bytes).buffer, '');
    scene.updateMatrixWorld(true);
    expect(scene.getObjectByName(BODY_NODE)).toBeDefined();
    for (const name of WHEEL_NODES) expect(scene.getObjectByName(name)).toBeDefined();
    scene.traverse((node) => expect(node.matrixWorld.elements.every(Number.isFinite)).toBe(true));
    const front = scene.getObjectByName('wheel_fl')!.getWorldPosition(new Vector3());
    const rear = scene.getObjectByName('wheel_rl')!.getWorldPosition(new Vector3());
    expect(front.z).toBeLessThan(rear.z);
    expect(front.x).toBeLessThan(0);
    expect(Math.abs(rear.z - front.z - spec.wheelbase)).toBeLessThan(0.002);
    const size = new Box3().setFromObject(scene).getSize(new Vector3());
    expect(size.x).toBeGreaterThan(1);
    expect(size.x).toBeLessThan(3);
    expect(size.y).toBeGreaterThan(1);
    expect(size.y).toBeLessThan(3);
    expect(size.z).toBeGreaterThan(3);
    expect(size.z).toBeLessThan(7);
  },
);
test('default visuals retain simulation archetypes', () => {
  for (const [archetype, id] of Object.entries(DEFAULT_VEHICLES)) {
    expect(VEHICLES.find((model) => model.id === id)?.archetype).toBe(archetype);
  }
});
