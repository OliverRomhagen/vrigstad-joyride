import { expect, test, vi } from 'vitest';
import * as THREE from 'three';
import { TOON_BANDS, ToonStyle, toonGradient } from '../../../../src/game/render/toon-style';

const camera = new THREE.PerspectiveCamera();
// Records each mesh's material as the renderer sees it, which is only during render().
function recordingRenderer(scene: THREE.Scene) {
  const seen = new Map<THREE.Object3D, THREE.Material | THREE.Material[]>();
  const render = vi.fn(() => scene.traverse((o) => o instanceof THREE.Mesh && seen.set(o, o.material)));
  return { render, seen };
}
const box = new THREE.BoxGeometry();

test('the gradient is unlit facing away, then one texel per band', () => {
  const texels = toonGradient().image.data as Uint8Array;
  const lightAt = (dot: number) => texels[Math.floor(((dot + 1) / 2) * 16) * 4] / 255;
  expect(lightAt(-0.5)).toBe(0);
  expect(lightAt(0.2)).toBeCloseTo(TOON_BANDS[0].light, 2);
  expect(lightAt(0.9)).toBeCloseTo(TOON_BANDS[1].light, 2);
});

test('lit materials draw as toon copies and are put back after the frame', () => {
  const scene = new THREE.Scene(),
    texture = new THREE.Texture(),
    lambert = new THREE.MeshLambertMaterial({ map: texture, vertexColors: true, side: THREE.DoubleSide }),
    phong = new THREE.MeshPhongMaterial({ color: 0x336699 }),
    basic = new THREE.MeshBasicMaterial(),
    a = new THREE.Mesh(box, lambert),
    b = new THREE.Mesh(box, lambert),
    c = new THREE.Mesh(box, phong),
    d = new THREE.Mesh(box, basic);
  scene.add(a, b, c, d);
  const renderer = recordingRenderer(scene);
  new ToonStyle(renderer).render(scene, camera);
  const toonA = renderer.seen.get(a) as THREE.MeshToonMaterial;
  expect(toonA).toBeInstanceOf(THREE.MeshToonMaterial);
  expect(toonA).toMatchObject({ map: texture, vertexColors: true, side: THREE.DoubleSide });
  expect(renderer.seen.get(b)).toBe(toonA); // a shared material stays shared
  expect((renderer.seen.get(c) as THREE.MeshToonMaterial).color.equals(phong.color)).toBe(true);
  expect(renderer.seen.get(d)).toBe(basic);
  expect([a.material, b.material, c.material, d.material]).toEqual([lambert, lambert, phong, basic]);
});

test('what the game animates on its materials reaches the next frame', () => {
  const scene = new THREE.Scene(),
    beacon = new THREE.MeshStandardMaterial({ emissive: 0x176cff }),
    mesh = new THREE.Mesh(box, beacon);
  scene.add(mesh);
  const renderer = recordingRenderer(scene),
    style = new ToonStyle(renderer);
  style.render(scene, camera);
  beacon.emissiveIntensity = 1.8;
  beacon.color.set(0xff0000);
  style.render(scene, camera);
  const toon = renderer.seen.get(mesh) as THREE.MeshToonMaterial;
  expect(toon.emissiveIntensity).toBe(1.8);
  expect(toon.color.equals(beacon.color)).toBe(true);
});

test('material arrays, instanced meshes and transparent materials', () => {
  const scene = new THREE.Scene(),
    walls = new THREE.MeshLambertMaterial(),
    glass = new THREE.MeshLambertMaterial({ transparent: true, opacity: 0.4 }),
    sky = new THREE.ShaderMaterial(),
    building = new THREE.Mesh(box, [walls, glass]),
    trees = new THREE.InstancedMesh(box, walls, 4),
    dome = new THREE.Mesh(box, sky);
  scene.add(building, trees, dome);
  const renderer = recordingRenderer(scene),
    outline = { render: vi.fn(() => renderer.render()) };
  new ToonStyle(renderer, outline).render(scene, camera);
  const [toonWalls, toonGlass] = renderer.seen.get(building) as THREE.MeshToonMaterial[];
  expect(toonWalls).toBeInstanceOf(THREE.MeshToonMaterial);
  expect(toonWalls.userData.outlineParameters).toBeUndefined();
  expect(toonGlass).toMatchObject({ transparent: true, opacity: 0.4, userData: { outlineParameters: { visible: false } } });
  // OutlineEffect ignores instance transforms, so instanced meshes get their own copy without an outline
  const toonTrees = renderer.seen.get(trees) as THREE.MeshToonMaterial;
  expect(toonTrees).not.toBe(toonWalls);
  expect(toonTrees.userData.outlineParameters).toEqual({ visible: false });
  expect(sky.userData.outlineParameters).toEqual({ visible: false });
  expect(outline.render).toHaveBeenCalledOnce();
  expect(building.material).toEqual([walls, glass]);
  expect(trees.material).toBe(walls);
});

test('disposing a game material disposes its toon copy', () => {
  const scene = new THREE.Scene(),
    paint = new THREE.MeshLambertMaterial(),
    mesh = new THREE.Mesh(box, paint);
  scene.add(mesh);
  const renderer = recordingRenderer(scene);
  new ToonStyle(renderer).render(scene, camera);
  const disposed = vi.fn();
  (renderer.seen.get(mesh) as THREE.Material).addEventListener('dispose', disposed);
  paint.dispose();
  expect(disposed).toHaveBeenCalledOnce();
});

test('a failing render still puts the game materials back', () => {
  const scene = new THREE.Scene(),
    paint = new THREE.MeshLambertMaterial(),
    mesh = new THREE.Mesh(box, paint);
  scene.add(mesh);
  const style = new ToonStyle({ render: () => { throw new Error('context lost'); } });
  expect(() => style.render(scene, camera)).toThrow('context lost');
  expect(mesh.material).toBe(paint);
});
