import { readFileSync } from 'node:fs';
import { afterEach, beforeEach, expect, test, vi } from 'vitest';
import * as THREE from 'three';
import { GLTFLoader, type GLTF } from 'three/addons/loaders/GLTFLoader.js';
import { MeshoptDecoder } from 'three/addons/libs/meshopt_decoder.module.js';
import { VehicleVisuals } from '../../../src/game/render/vehicle-visuals';
import '../../../src/world/three-legacy';

const parser = new GLTFLoader().setMeshoptDecoder(MeshoptDecoder);
async function parse(url: string) {
  return parser.parseAsync(new Uint8Array(readFileSync('src/public/' + url)).buffer, '');
}
const focus = { x: 0, z: 0 };
function car(x = 0) {
  const mesh = new THREE.Group();
  const fallback = new THREE.Mesh(new THREE.BoxGeometry(), new THREE.MeshBasicMaterial());
  mesh.add(fallback);
  return { mesh, fallback, x, z: 0, h: 0 };
}
async function settle(assets: VehicleVisuals, cars: ReturnType<typeof car>[]) {
  await vi.waitFor(() =>
    expect(cars.every((c) => assets.state(c)?.status !== 'loading')).toBe(true),
  );
}
function mesh(root: THREE.Object3D, name: string) {
  const node = root.getObjectByName(name);
  if (!(node instanceof THREE.Mesh) || Array.isArray(node.material))
    throw new Error('Expected single-material mesh: ' + name);
  return node as THREE.Mesh<THREE.BufferGeometry, THREE.MeshStandardMaterial>;
}
beforeEach(() => {
  vi.spyOn(GLTFLoader.prototype, 'loadAsync').mockImplementation((url) => parse(url));
});
afterEach(() => {
  vi.restoreAllMocks();
});

test('cached geometry, queued paint, protected glass and owned material disposal', async () => {
  const assets = new VehicleVisuals(false),
    a = car(),
    b = car(2);
  assets.attach(a, 'volvo240', a.fallback);
  assets.attach(b, 'volvo240', b.fallback, '#abcdef');
  assets.paint(a, '#27406b');
  assets.update(focus, 0.01);
  await settle(assets, [a, b]);
  const bodyA = mesh(a.mesh, 'body'),
    bodyB = mesh(b.mesh, 'body');
  expect(GLTFLoader.prototype.loadAsync).toHaveBeenCalledTimes(1);
  expect(bodyA.geometry).toBe(bodyB.geometry);
  expect(bodyA.material).not.toBe(bodyB.material);
  expect(bodyA.material.color.equals(new THREE.Color('#27406b').convertSRGBToLinear())).toBe(true);
  expect(bodyB.material.color.equals(new THREE.Color('#abcdef').convertSRGBToLinear())).toBe(true);
  expect(assets.definition(a)?.spokenName).toBe('Volvon');
  const original = bodyB.material.color.clone(),
    glass = mesh(a.mesh, 'glass_envelope'),
    glassMaterial = glass.material;
  assets.paint(a, '#992233');
  expect(bodyB.material.color.equals(original)).toBe(true);
  expect(glass.material).toBe(glassMaterial);
  const disposed = vi.fn();
  bodyA.material.addEventListener('dispose', disposed);
  assets.dispose(a);
  expect(disposed).toHaveBeenCalledOnce();
  expect(assets.state(a)).toBeNull();
  expect(assets.definition(a)).toBeUndefined();
});

test('wheel travel, reverse steering and teleport reset use rendered motion', async () => {
  const assets = new VehicleVisuals(false),
    c = car();
  assets.attach(c, 'volvo240', c.fallback);
  assets.update(focus, 0.4);
  await settle(assets, [c]);
  c.x += 0.1;
  c.z -= 1;
  c.h += 0.1;
  assets.sync(c);
  expect(assets.state(c)!.wheels[0].steer).toBeLessThan(0);
  expect(assets.state(c)!.wheels[0].spin).toBeLessThan(0);
  c.x -= 0.1;
  c.z += 1;
  c.h -= 0.1;
  assets.sync(c);
  expect(assets.state(c)!.wheels[0].steer).toBeLessThan(0);
  const spin = assets.state(c)!.wheels[0].spin;
  c.x += 100;
  assets.sync(c);
  expect(assets.state(c)!.wheels[0].spin).toBe(spin);
});

test('police retain authored paint and their real beacon meshes flash', async () => {
  const assets = new VehicleVisuals(false),
    c = car();
  assets.attach(c, 'xc70-police', c.fallback, '#ff0000');
  assets.update(focus, 0.01);
  await settle(assets, [c]);
  const paint = mesh(c.mesh, 'body').material;
  assets.paint(c, '#ff0000');
  expect(mesh(c.mesh, 'body').material).toBe(paint);
  const beacons: THREE.MeshStandardMaterial[] = [];
  c.mesh.traverse((node) => {
    if (node instanceof THREE.Mesh && /^lamp_(blue_module|police_grille)/.test(node.name))
      beacons.push(node.material);
  });
  expect(beacons).toHaveLength(5);
  assets.update(focus, 0.22);
  const lit = beacons[0].emissiveIntensity;
  assets.update(focus, 0.22);
  expect(beacons[0].emissiveIntensity).not.toBe(lit);
});

test('failed nearest models leave capacity for the healthy fourth model', async () => {
  vi.mocked(GLTFLoader.prototype.loadAsync).mockImplementation(async (url) => {
    if (url.endsWith('micra-k11.glb')) throw new Error('Expected missing asset');
    return parse(url);
  });
  vi.spyOn(console, 'warn').mockImplementation(() => {});
  const assets = new VehicleVisuals(true),
    cars = [1, 2, 3, 4].map(car);
  cars.forEach((c, i) => assets.attach(c, i === 3 ? 'volvo240' : 'micra-k11', c.fallback));
  assets.update(focus, 0.4);
  await settle(assets, cars.slice(0, 3));
  assets.update(focus, 0.4);
  await settle(assets, cars);
  expect(assets.state(cars[3])?.detailed).toBe(true);
  expect(cars.slice(0, 3).every((c) => assets.state(c)?.fallback)).toBe(true);
});

test.each([
  { coarse: true, limit: 3 },
  { coarse: false, limit: 8 },
])('detail cap $limit and range culling', async ({ coarse, limit }) => {
  const assets = new VehicleVisuals(coarse),
    cars = Array.from({ length: 9 }, (_, i) => car(i + 1));
  cars.forEach((c) => assets.attach(c, 'volvo240', c.fallback));
  assets.update(focus, 0.4);
  await settle(assets, cars);
  expect(cars.filter((c) => assets.state(c)?.detailed)).toHaveLength(limit);
  assets.update({ x: 1000, z: 0 }, 0.4);
  expect(cars.every((c) => assets.state(c)?.fallback)).toBe(true);
});

test('reparenting preserves inherited uniform wheel scale', async () => {
  const template = new THREE.Group(),
    parent = new THREE.Group();
  parent.scale.setScalar(2);
  template.add(parent);
  const body = new THREE.Mesh(new THREE.BoxGeometry(), new THREE.MeshStandardMaterial());
  body.name = 'body';
  parent.add(body);
  for (const name of ['wheel_fl', 'wheel_fr', 'wheel_rl', 'wheel_rr']) {
    const node = new THREE.Mesh(new THREE.BoxGeometry(), new THREE.MeshStandardMaterial());
    node.name = name;
    node.scale.setScalar(0.5);
    node.position.set(name.endsWith('l') ? -1 : 1, 1, name.includes('_f') ? -1 : 1);
    parent.add(node);
  }
  template.updateMatrixWorld(true);
  const expected = new THREE.Box3().setFromObject(template);
  // This controller only reads scene from the loader result.
  vi.mocked(GLTFLoader.prototype.loadAsync).mockResolvedValue({ scene: template } as GLTF);
  const assets = new VehicleVisuals(false),
    c = car();
  assets.attach(c, 'volvo240', c.fallback);
  assets.update(focus, 0.4);
  await settle(assets, [c]);
  const bounds = new THREE.Box3().setFromObject(
    c.mesh.children.find((node) => node !== c.fallback)!,
  );
  expect(bounds.min.distanceTo(expected.min)).toBeLessThan(1e-8);
  expect(bounds.max.distanceTo(expected.max)).toBeLessThan(1e-8);
});

test('disposing an instance during loading cannot resurrect its visual', async () => {
  let finish!: (model: GLTF) => void;
  vi.mocked(GLTFLoader.prototype.loadAsync).mockImplementation(
    () =>
      new Promise((resolve) => {
        finish = resolve;
      }),
  );
  const assets = new VehicleVisuals(false),
    c = car();
  assets.attach(c, 'volvo240', c.fallback);
  assets.update(focus, 0.4);
  assets.dispose(c);
  finish({ scene: new THREE.Group() } as GLTF);
  await new Promise(setImmediate);
  expect(c.mesh.children).toHaveLength(1);
  expect(assets.state(c)).toBeNull();
});
