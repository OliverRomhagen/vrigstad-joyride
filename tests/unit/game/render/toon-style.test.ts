import * as THREE from 'three';
import { expect, test, vi } from 'vitest';
import { HOUSE_SHELLS_MATERIAL } from '../../../../src/game/render/house-materials';
import { INK_FLAG } from '../../../../src/game/render/ink-flag';
import {
  FINISH_LEVELS,
  finishOf,
  INK_PULL,
  TOON_FILL_SCALE,
  TOON_LEVELS,
  TOON_SUN_SCALE,
  ToonStyle,
  toonGradient,
} from '../../../../src/game/render/toon-style';

const camera = new THREE.PerspectiveCamera();
// Records each mesh's material as the renderer sees it, which is only during render().
function recordingRenderer(scene: THREE.Scene) {
  const seen = new Map<THREE.Object3D, THREE.Material | THREE.Material[]>();
  const render = vi.fn(() => scene.traverse(o => o instanceof THREE.Mesh && seen.set(o, o.material)));
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
  expect(finishOf(new THREE.MeshLambertMaterial({ name: HOUSE_SHELLS_MATERIAL }))).toBe('house');
});

test('each finish draws with its own ramp, shared between materials', () => {
  const scene = new THREE.Scene(),
    meshes = ['body paint', 'tail lamp red', 'smoky glass', 'roof paint'].map(
      name => new THREE.Mesh(box, new THREE.MeshStandardMaterial({ name })),
    );
  scene.add(...meshes);
  const renderer = recordingRenderer(scene);
  new ToonStyle(renderer).render(scene, camera);
  const ramps = meshes.map(m => (renderer.seen.get(m) as THREE.MeshToonMaterial).gradientMap as THREE.DataTexture);
  expect(Array.from(ramps[1].image.data as Uint8Array)).toEqual([...FINISH_LEVELS.lamp]);
  expect(Array.from(ramps[2].image.data as Uint8Array)).toEqual([...FINISH_LEVELS.glass]);
  expect(ramps[3]).toBe(ramps[0]);
});

test('the houses get more, finer bands, so two walls at different angles to the sun shade apart (#413)', () => {
  const scene = new THREE.Scene(),
    [house, car] = [HOUSE_SHELLS_MATERIAL, 'body paint'].map(
      name => new THREE.Mesh(box, new THREE.MeshLambertMaterial({ name })),
    );
  scene.add(house, car);
  const renderer = recordingRenderer(scene);
  new ToonStyle(renderer).render(scene, camera);
  // the light a material is drawn with at a normal-light dot, from the ramp the style gave it, sampled as three does
  // (gradientmap_pars_fragment: coord = dot * 0.5 + 0.5, nearest texel)
  const light = (mesh: THREE.Mesh, dot: number) => {
    const texels = ((renderer.seen.get(mesh) as THREE.MeshToonMaterial).gradientMap as THREE.DataTexture).image
      .data as Uint8Array;
    return texels[Math.min(texels.length - 1, Math.floor((dot * 0.5 + 0.5) * texels.length))];
  };
  // under a high sun every wall's dot is below 0.5: one facing the sun (0.45) and one turned from it (0.1) are lit the
  // same on the paint ramp, not on the house ramp
  expect(light(car, 0.45)).toBe(light(car, 0.1));
  expect(light(house, 0.45)).toBeGreaterThan(light(house, 0.1));
  // and every band is lighter than the one before it, so no two neighbours merge
  const levels: readonly number[] = FINISH_LEVELS.house;
  for (let i = 1; i < levels.length; i++) expect(levels[i]).toBeGreaterThan(levels[i - 1]);
});

test('light shifts from the fill to the sun while drawing, and back after', () => {
  const scene = new THREE.Scene(),
    fill = new THREE.HemisphereLight(0xffffff, 0x888888, 2),
    sun = new THREE.DirectionalLight(0xffffff, 3);
  scene.add(fill, sun);
  let during: number[] = [];
  new ToonStyle({
    render: () => {
      during = [fill.intensity, sun.intensity];
    },
  }).render(scene, camera);
  expect(during[0]).toBeCloseTo(2 * TOON_FILL_SCALE);
  expect(during[1]).toBeCloseTo(3 * TOON_SUN_SCALE);
  expect([fill.intensity, sun.intensity]).toEqual([2, 3]);
});

test('a mesh the swap fails on leaves the materials and lights as they were, and fails only once', () => {
  const scene = new THREE.Scene(),
    fill = new THREE.HemisphereLight(0xffffff, 0x888888, 2),
    paint = new THREE.MeshLambertMaterial(),
    house = new THREE.Mesh(box, paint),
    broken = new THREE.Mesh(new THREE.BufferGeometry(), new THREE.MeshLambertMaterial()); // no positions to find edges in
  broken.userData[INK_FLAG] = true;
  scene.add(fill, house, broken);
  const renderer = recordingRenderer(scene),
    style = new ToonStyle(renderer);
  expect(() => style.render(scene, camera)).toThrow();
  expect(renderer.render).not.toHaveBeenCalled();
  expect(house.material).toBe(paint);
  expect(fill.intensity).toBe(2);
  style.render(scene, camera); // the mesh is skipped from then on, so the light isn't scaled twice
  expect(renderer.render).toHaveBeenCalledOnce();
  expect(fill.intensity).toBe(2);
});

test("a geometry's ink lines are disposed with it", () => {
  const scene = new THREE.Scene(),
    geometry = new THREE.BoxGeometry(),
    crate = new THREE.Mesh(geometry, new THREE.MeshLambertMaterial());
  crate.userData[INK_FLAG] = true;
  scene.add(crate);
  new ToonStyle({ render: () => {} }).render(scene, camera);
  const disposed = vi.fn();
  (crate.children[0] as THREE.LineSegments).geometry.addEventListener('dispose', disposed);
  geometry.dispose();
  geometry.dispose();
  expect(disposed).toHaveBeenCalledOnce();
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
  const ink = (mesh: THREE.Mesh) => mesh.children.filter(o => o instanceof THREE.LineSegments) as THREE.LineSegments[];
  expect(ink(body)).toHaveLength(1);
  expect(ink(door)[0].geometry).toBe(ink(body)[0].geometry);
  expect(ink(body)[0].geometry).toBeInstanceOf(THREE.EdgesGeometry);
  expect(ink(glass)).toHaveLength(0);
  expect(ink(house)).toHaveLength(0);
});

test('ink lines stay on far-off parts of a mesh, and are pulled towards the camera to show over the corner boards', () => {
  // the village shells are one mesh at the origin with world-coordinate vertices: scaling lines about it moved them
  const scene = new THREE.Scene(),
    shells = new THREE.Mesh(box.clone().translate(900, 0, 0), new THREE.MeshLambertMaterial());
  shells.userData[INK_FLAG] = true;
  scene.add(shells);
  new ToonStyle({ render: () => {} }).render(scene, camera);
  const [lines] = shells.children as THREE.LineSegments[];
  expect(lines.scale.equals(new THREE.Vector3(1, 1, 1))).toBe(true);
  const shader = { vertexShader: 'void main() {\n#include <project_vertex>\n}' };
  (lines.material as THREE.Material).onBeforeCompile(
    shader as THREE.WebGLProgramParametersWithUniforms,
    {} as THREE.WebGLRenderer,
  );
  // along the line of sight, about the camera: the same place on screen, only nearer
  expect(shader.vertexShader).toContain(`mvPosition.xyz *= ${(1 - INK_PULL).toFixed(6)};`);
  expect(shader.vertexShader.indexOf('mvPosition.xyz *=')).toBeGreaterThan(
    shader.vertexShader.indexOf('<project_vertex>'),
  );
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

test('material arrays, instanced trees and custom materials', () => {
  const scene = new THREE.Scene(),
    walls = new THREE.MeshLambertMaterial(),
    glass = new THREE.MeshLambertMaterial({ transparent: true, opacity: 0.4 }),
    sky = new THREE.ShaderMaterial(),
    water = new THREE.MeshLambertMaterial(),
    building = new THREE.Mesh(box, [walls, glass]),
    trees = new THREE.InstancedMesh(box, walls, 4),
    dome = new THREE.Mesh(box, sky),
    lake = new THREE.Mesh(box, water);
  water.onBeforeCompile = () => {}; // its colour comes from the patched shader, which a toon copy would lose
  scene.add(building, trees, dome, lake);
  const renderer = recordingRenderer(scene);
  new ToonStyle(renderer).render(scene, camera);
  const [toonWalls, toonGlass] = renderer.seen.get(building) as THREE.MeshToonMaterial[];
  expect(toonWalls).toBeInstanceOf(THREE.MeshToonMaterial);
  expect(toonGlass).toMatchObject({ transparent: true, opacity: 0.4 });
  expect(renderer.seen.get(trees)).toBe(toonWalls); // trees get the bands, and no lines: they aren't flagged
  expect(trees.children).toHaveLength(0);
  expect(renderer.seen.get(dome)).toBe(sky);
  expect(renderer.seen.get(lake)).toBe(water);
  expect(building.material).toEqual([walls, glass]);
  expect(trees.material).toBe(walls);
});

test('a material swapped into a material array draws as its own toon copy', () => {
  const scene = new THREE.Scene(),
    red = new THREE.MeshLambertMaterial({ color: 0xff0000 }),
    blue = new THREE.MeshLambertMaterial({ color: 0x0000ff }),
    materials: THREE.Material[] = [new THREE.MeshLambertMaterial(), red],
    building = new THREE.Mesh(box, materials);
  scene.add(building);
  const renderer = recordingRenderer(scene),
    style = new ToonStyle(renderer);
  style.render(scene, camera);
  materials[1] = blue; // repainted in place: the same array
  style.render(scene, camera);
  const [, toon] = renderer.seen.get(building) as THREE.MeshToonMaterial[];
  expect(toon.color.equals(blue.color)).toBe(true);
});

test('a flat-shaded material stays faceted', () => {
  const scene = new THREE.Scene(),
    stone = new THREE.Mesh(box, new THREE.MeshLambertMaterial({ flatShading: true })),
    wall = new THREE.Mesh(box, new THREE.MeshLambertMaterial());
  scene.add(stone, wall);
  const renderer = recordingRenderer(scene);
  new ToonStyle(renderer).render(scene, camera);
  expect(renderer.seen.get(stone)).toMatchObject({ flatShading: true });
  expect(renderer.seen.get(wall)).toMatchObject({ flatShading: false });
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
  const style = new ToonStyle({
    render: () => {
      throw new Error('context lost');
    },
  });
  expect(() => style.render(scene, camera)).toThrow('context lost');
  expect(mesh.material).toBe(paint);
});
