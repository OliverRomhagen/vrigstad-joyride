import { expect, test, vi } from 'vitest';
import * as THREE from 'three';
import {
  FINISH_LEVELS,
  INK_FLAG,
  TOON_FILL_SCALE,
  TOON_LEVELS,
  TOON_SHADOW_RADIUS,
  TOON_SUN_SCALE,
  ToonStyle,
  finishOf,
  toonGradient,
} from '../../../../src/game/render/toon-style';

const camera = new THREE.PerspectiveCamera();
// Records each mesh's material as the renderer sees it, which is only during render().
function recordingRenderer(scene: THREE.Scene) {
  const seen = new Map<THREE.Object3D, THREE.Material | THREE.Material[]>();
  const render = vi.fn(() => scene.traverse((o) => o instanceof THREE.Mesh && seen.set(o, o.material)));
  return { render, seen };
}
const box = new THREE.BoxGeometry();

test('the gradient has one nearest-filtered texel per light level', () => {
  const gradient = toonGradient();
  expect(Array.from(gradient.image.data as Uint8Array)).toEqual([...TOON_LEVELS]);
  expect(gradient.magFilter).toBe(THREE.NearestFilter);
});

test('the levels change where three samples them: at a normal-light dot of -0.5, 0 and 0.5', () => {
  const texels = toonGradient().image.data as Uint8Array;
  // gradientmap_pars_fragment: coord = dot * 0.5 + 0.5, nearest texel
  const sample = (dot: number) => texels[Math.min(texels.length - 1, Math.floor((dot * 0.5 + 0.5) * texels.length))];
  expect([-0.9, -0.4, 0.1, 0.6, 1].map(sample)).toEqual([9, 45, 132, 255, 255]);
});

test('vehicle finishes come from the GLB material names, or metalness', () => {
  const named = (name: string, metalness = 0) => new THREE.MeshStandardMaterial({ name, metalness });
  expect(finishOf(named('Impala configurable body paint'))).toBe('paint');
  expect(finishOf(named('glazing envelope clay'))).toBe('glass');
  expect(finishOf(named('smoky blue grey glass'))).toBe('glass');
  expect(finishOf(named('police blue lenses'))).toBe('lamp');
  expect(finishOf(named('tail lamp red'))).toBe('lamp');
  expect(finishOf(named('tire charcoal'))).toBe('rubber');
  expect(finishOf(named('restrained satin chrome', 0.7))).toBe('metal');
  expect(finishOf(named('period wheel covers', 0.5))).toBe('metal');
  expect(finishOf(new THREE.MeshLambertMaterial())).toBe('paint');
});

test('each finish draws with its own ramp, shared between materials', () => {
  const scene = new THREE.Scene(),
    meshes = ['body paint', 'tail lamp red', 'smoky glass', 'roof paint'].map(
      (name) => new THREE.Mesh(box, new THREE.MeshStandardMaterial({ name })),
    );
  scene.add(...meshes);
  const renderer = recordingRenderer(scene);
  new ToonStyle(renderer).render(scene, camera);
  const ramps = meshes.map((m) => (renderer.seen.get(m) as THREE.MeshToonMaterial).gradientMap as THREE.DataTexture);
  expect(Array.from(ramps[1].image.data as Uint8Array)).toEqual([...FINISH_LEVELS.lamp]);
  expect(Array.from(ramps[2].image.data as Uint8Array)).toEqual([...FINISH_LEVELS.glass]);
  expect(ramps[3]).toBe(ramps[0]);
});

test('instanced meshes get a back-face hull that shares their instances, only with outlines on', () => {
  const scene = new THREE.Scene(),
    trees = new THREE.InstancedMesh(box, new THREE.MeshLambertMaterial(), 3),
    noOutlines = new THREE.InstancedMesh(box, new THREE.MeshLambertMaterial(), 3);
  scene.add(trees);
  const outline = { render: () => {} },
    style = new ToonStyle({ render: () => {} }, outline);
  style.render(scene, camera);
  style.render(scene, camera);
  const hulls = trees.children.filter((o) => o instanceof THREE.InstancedMesh) as THREE.InstancedMesh[];
  expect(hulls).toHaveLength(1);
  expect(hulls[0].instanceMatrix).toBe(trees.instanceMatrix);
  expect(hulls[0].boundingSphere).toBe(trees.boundingSphere);
  expect((hulls[0].material as THREE.Material).side).toBe(THREE.BackSide);
  const flat = new THREE.Scene();
  flat.add(noOutlines);
  new ToonStyle({ render: () => {} }).render(flat, camera);
  expect(noOutlines.children).toHaveLength(0);
});

test('light shifts from the fill to the sun and shadows harden while drawing, and both come back after', () => {
  const scene = new THREE.Scene(),
    fill = new THREE.HemisphereLight(0xffffff, 0x888888, 2),
    sun = new THREE.DirectionalLight(0xffffff, 3);
  sun.shadow.radius = 1;
  scene.add(fill, sun);
  let during: number[] = [];
  new ToonStyle({ render: () => { during = [fill.intensity, sun.intensity, sun.shadow.radius]; } }).render(scene, camera);
  expect(during[0]).toBeCloseTo(2 * TOON_FILL_SCALE);
  expect(during[1]).toBeCloseTo(3 * TOON_SUN_SCALE);
  expect(during[2]).toBe(TOON_SHADOW_RADIUS);
  expect([fill.intensity, sun.intensity, sun.shadow.radius]).toEqual([2, 3, 1]);
});

test('inked objects get crease lines on opaque meshes, once, sharing edges per geometry', () => {
  const scene = new THREE.Scene(),
    car = new THREE.Group(),
    body = new THREE.Mesh(box, new THREE.MeshStandardMaterial()),
    door = new THREE.Mesh(box, new THREE.MeshStandardMaterial()),
    glass = new THREE.Mesh(box, new THREE.MeshStandardMaterial({ transparent: true, opacity: 0.3 })),
    house = new THREE.Mesh(box, new THREE.MeshLambertMaterial());
  car.userData[INK_FLAG] = true;
  car.add(body, door, glass);
  scene.add(car, house);
  const style = new ToonStyle({ render: () => {} });
  style.render(scene, camera);
  style.render(scene, camera);
  const ink = (mesh: THREE.Mesh) => mesh.children.filter((o) => o instanceof THREE.LineSegments) as THREE.LineSegments[];
  expect(ink(body)).toHaveLength(1);
  expect(ink(door)[0].geometry).toBe(ink(body)[0].geometry);
  expect(ink(body)[0].geometry).toBeInstanceOf(THREE.EdgesGeometry);
  expect(ink(glass)).toHaveLength(0);
  expect(ink(house)).toHaveLength(0);
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
