import * as THREE from 'three';
import { expect, test, vi } from 'vitest';
import { HOUSE_FRAMES_MATERIAL, HOUSE_SHELLS_MATERIAL } from '../../../../src/game/render/house-materials';
import { INK_FLAG, INK_NO_FEET_FLAG } from '../../../../src/game/render/ink-flag';
import {
  FINISH_LEVELS,
  finishOf,
  INK_CELL_M,
  INK_NEAR_COARSE_M,
  INK_NEAR_M,
  INK_PULL,
  inkPieces,
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
  // the 3D window frames match the painted windows under them, which the house ramp would light as a pale wall
  expect(finishOf(new THREE.MeshLambertMaterial({ name: HOUSE_FRAMES_MATERIAL }))).toBe('paint');
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
  expect(ink(body)[0].geometry.getAttribute('position').count).toBe(24); // a box's twelve edges (ink-edges.test.ts)
  expect(ink(glass)).toHaveLength(0);
  expect(ink(house)).toHaveLength(0);
});

test('only a mesh that asks for it loses the line along its open feet', () => {
  // a 4 m wall with no floor, from y = 0 to 3: top, two sides and a foot
  const wall = () => {
    const g = new THREE.BufferGeometry();
    g.setAttribute(
      'position',
      new THREE.Float32BufferAttribute([0, 0, 0, 4, 0, 0, 4, 3, 0, 0, 0, 0, 4, 3, 0, 0, 3, 0], 3),
    );
    return new THREE.Mesh(g, new THREE.MeshLambertMaterial());
  };
  const scene = new THREE.Scene(),
    prop = wall(),
    shells = wall();
  prop.userData[INK_FLAG] = true;
  shells.userData[INK_FLAG] = true;
  shells.userData[INK_NO_FEET_FLAG] = true;
  scene.add(prop, shells);
  new ToonStyle({ render: () => {} }).render(scene, camera);
  const segments = (mesh: THREE.Mesh) =>
    (mesh.children[0] as THREE.LineSegments).geometry.getAttribute('position').count / 2;
  expect(segments(prop)).toBe(4);
  expect(segments(shells)).toBe(3);
});

test("a mesh not flagged gets three's EdgesGeometry lines, even where inkEdges would draw others", () => {
  // a roof and its overhang in one plane, the overhang wound the other way: EdgesGeometry draws the edge between them,
  // inkEdges flips the normal and draws none; a car part like this keeps its line
  const roofAndOverhang = [
    [0, 3, 0, 4, 3, 0, 4, 4, -2, 0, 3, 0, 4, 4, -2, 0, 4, -2],
    [0, 3, 0, 4, 3, 0, 4, 2.8, 0.4, 0, 3, 0, 4, 2.8, 0.4, 0, 2.8, 0.4],
  ].flat();
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(roofAndOverhang, 3));
  const scene = new THREE.Scene(),
    prop = new THREE.Mesh(g, new THREE.MeshLambertMaterial()),
    shells = new THREE.Mesh(g, new THREE.MeshLambertMaterial());
  for (const o of [prop, shells]) o.userData[INK_FLAG] = true;
  shells.userData[INK_NO_FEET_FLAG] = true;
  scene.add(prop, shells);
  new ToonStyle({ render: () => {} }).render(scene, camera);
  const lines = (mesh: THREE.Mesh) => (mesh.children[0] as THREE.LineSegments).geometry.getAttribute('position');
  const alongTheJoin = (mesh: THREE.Mesh) => {
    const p = lines(mesh);
    let n = 0;
    for (let i = 0; i < p.count; i += 2) if (p.getY(i) === 3 && p.getY(i + 1) === 3) n++;
    return n;
  };
  expect(lines(prop).array).toEqual(new THREE.EdgesGeometry(g, 34).getAttribute('position').array);
  expect(alongTheJoin(prop)).toBe(1);
  expect(alongTheJoin(shells)).toBe(0);
});

test('two meshes that share a geometry each get their own lines, with and without feet, and the flag is not inherited', () => {
  const g = new THREE.BufferGeometry();
  g.setAttribute(
    'position',
    new THREE.Float32BufferAttribute([0, 0, 0, 4, 0, 0, 4, 3, 0, 0, 0, 0, 4, 3, 0, 0, 3, 0], 3),
  );
  const scene = new THREE.Scene(),
    group = new THREE.Group(),
    prop = new THREE.Mesh(g, new THREE.MeshLambertMaterial()),
    shells = new THREE.Mesh(g, new THREE.MeshLambertMaterial()),
    child = new THREE.Mesh(g, new THREE.MeshLambertMaterial());
  for (const o of [prop, shells, group]) o.userData[INK_FLAG] = true;
  shells.userData[INK_NO_FEET_FLAG] = true;
  group.userData[INK_NO_FEET_FLAG] = true; // on a group it says nothing about the meshes under it
  group.add(child);
  scene.add(prop, shells, group);
  new ToonStyle({ render: () => {} }).render(scene, camera);
  const segments = (mesh: THREE.Mesh) =>
    (mesh.children[0] as THREE.LineSegments).geometry.getAttribute('position').count / 2;
  expect([segments(prop), segments(shells), segments(child)]).toEqual([4, 3, 4]);
});

test('ink lines stay on far-off parts of a mesh, and are pulled towards the camera to show over the faces beside them', () => {
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

test('cockpit clipping stays on the toon material used for the draw', () => {
  const scene = new THREE.Scene();
  const planes = [new THREE.Plane(new THREE.Vector3(0, -1, 0), 1)];
  const paint = new THREE.MeshStandardMaterial({ clippingPlanes: planes, clipIntersection: true, clipShadows: true });
  const body = new THREE.Mesh(box, paint);
  scene.add(body);
  const renderer = recordingRenderer(scene);
  new ToonStyle(renderer).render(scene, camera);
  const drawn = renderer.seen.get(body) as THREE.Material;
  expect(drawn.clippingPlanes).toBe(planes);
  expect(drawn.clipIntersection).toBe(true);
  expect(drawn.clipShadows).toBe(true);
  expect(body.material).toBe(paint);
});

test("a small thing's ink is drawn only near the camera, less far on a touch screen", () => {
  const scene = new THREE.Scene(),
    crate = new THREE.Mesh(box, new THREE.MeshLambertMaterial()),
    eye = new THREE.PerspectiveCamera();
  crate.userData[INK_FLAG] = true;
  scene.add(crate);
  const lines = () => crate.children[0] as THREE.LineSegments;
  for (const [style, near] of [
    [new ToonStyle({ render: () => {} }), INK_NEAR_M],
    [new ToonStyle({ render: () => {} }, { coarse: true }), INK_NEAR_COARSE_M],
  ] as const) {
    crate.clear();
    style.render(scene, eye); // builds the lines
    scene.updateMatrixWorld();
    for (const [z, drawn] of [
      [near - 5, true],
      [near + 5, false],
    ] as const) {
      eye.position.set(0, 0, z);
      eye.updateMatrixWorld();
      style.render(scene, eye);
      expect(lines().visible).toBe(drawn);
    }
  }
});

test('the lines of a mesh as wide as the village are cut into squares, so the ones out of view are culled', () => {
  const segments: number[] = [];
  for (let x = -600; x < 600; x += 10) segments.push(x, 0, 0, x + 5, 0, 0); // a 1.2 km row of short lines
  const wide = new THREE.BufferGeometry();
  wide.setAttribute('position', new THREE.Float32BufferAttribute(segments, 3));
  const pieces = inkPieces(wide);
  expect(pieces.length).toBe(1200 / INK_CELL_M);
  expect(pieces.reduce((n, g) => n + g.getAttribute('position').count, 0)).toBe(segments.length / 3); // none lost
  for (const g of pieces) expect(g.boundingSphere?.radius).toBeLessThanOrEqual(INK_CELL_M);
  const small = new THREE.EdgesGeometry(box);
  expect(inkPieces(small)).toEqual([small]); // a car's or a crate's stays one piece
});

test('a mesh that joins an inked group later, as a car model does once it loads, gets its ink then', () => {
  const scene = new THREE.Scene(),
    car = new THREE.Group(),
    style = new ToonStyle({ render: () => {} });
  car.userData[INK_FLAG] = true;
  scene.add(car);
  style.render(scene, camera);
  const model = new THREE.Mesh(box, new THREE.MeshStandardMaterial());
  car.add(model);
  style.render(scene, camera);
  style.render(scene, camera);
  expect(model.children.filter(o => o instanceof THREE.LineSegments)).toHaveLength(1);
});

test("a lone house's piece of the village's ink is drawn from any distance, though the piece is small", () => {
  const scene = new THREE.Scene(),
    houses = new THREE.BoxGeometry(4, 4, 4).toNonIndexed(),
    village = new THREE.Mesh(
      mergeTwo(houses.clone().translate(-500, 0, 75), houses.clone().translate(800, 0, 75)), // each inside one square
      new THREE.MeshLambertMaterial(),
    ), // one mesh, its origin at Torget, as the house shells are, with one house in each of two squares
    eye = new THREE.PerspectiveCamera(),
    style = new ToonStyle({ render: () => {} });
  village.userData[INK_FLAG] = true;
  scene.add(village);
  eye.position.set(805, 0, 75); // by one house, 1.3 km from the other
  style.render(scene, eye); // builds the lines
  style.render(scene, eye);
  const pieces = village.children as THREE.LineSegments[];
  expect(pieces).toHaveLength(2); // cut into squares, each a piece a few metres across
  for (const l of pieces) expect(l.visible).toBe(true); // left to the camera's culling, not hidden by distance
});

test('a mesh drawn before its group is flagged gets its ink once the flag is set', () => {
  const scene = new THREE.Scene(),
    car = new THREE.Group(),
    model = new THREE.Mesh(box, new THREE.MeshStandardMaterial()),
    style = new ToonStyle({ render: () => {} });
  car.add(model);
  scene.add(car);
  style.render(scene, camera);
  expect(model.children).toHaveLength(0);
  car.userData[INK_FLAG] = true;
  style.render(scene, camera);
  style.render(scene, camera);
  expect(model.children.filter(o => o instanceof THREE.LineSegments)).toHaveLength(1);
});

test("a thing's ink is judged by its nearest side as drawn: scaled up, it isn't small", () => {
  const scene = new THREE.Scene(),
    eye = new THREE.PerspectiveCamera(),
    style = new ToonStyle({ render: () => {} }),
    sign = new THREE.Mesh(new THREE.SphereGeometry(5, 8, 4), new THREE.MeshLambertMaterial()), // 10 m across
    big = new THREE.Mesh(new THREE.SphereGeometry(5, 8, 4), new THREE.MeshLambertMaterial());
  big.scale.setScalar(10); // 100 m across as drawn, though its geometry is 10
  for (const m of [sign, big]) m.userData[INK_FLAG] = true;
  sign.position.set(0, 0, -(INK_NEAR_M + 3)); // its near side 2 m inside the reach, its centre 3 m past it
  big.position.set(0, 0, 500);
  scene.add(sign, big);
  style.render(scene, eye); // builds the lines
  style.render(scene, eye);
  expect(sign.children[0].visible).toBe(true);
  expect(big.children[0].visible).toBe(true); // 450 m to its near side: not a small thing, so not hidden by distance
  eye.position.set(0, 0, 10); // 8 m further from the sign: past the reach
  eye.updateMatrixWorld();
  style.render(scene, eye);
  expect(sign.children[0].visible).toBe(false);
});

test('the ink is judged from where the camera is this frame, before three updates it', () => {
  const scene = new THREE.Scene(),
    crate = new THREE.Mesh(box, new THREE.MeshLambertMaterial()),
    eye = new THREE.PerspectiveCamera(),
    style = new ToonStyle({ render: () => {} });
  crate.userData[INK_FLAG] = true;
  scene.add(crate);
  eye.position.set(0, 0, 1000);
  eye.updateMatrixWorld();
  style.render(scene, eye); // builds the lines, far off
  style.render(scene, eye);
  expect(crate.children[0].visible).toBe(false);
  eye.position.set(0, 0, 5); // a respawn beside it: the camera is moved, its matrix not yet updated
  style.render(scene, eye);
  expect(crate.children[0].visible).toBe(true);
  expect(scene.matrixWorldAutoUpdate).toBe(true); // three's own update is back on after the draw
});

test('a thing that jumps with the camera, as the player does on a respawn, keeps its ink on that frame', () => {
  const scene = new THREE.Scene(),
    person = new THREE.Mesh(box, new THREE.MeshLambertMaterial()),
    eye = new THREE.PerspectiveCamera(),
    style = new ToonStyle({ render: () => {} });
  person.userData[INK_FLAG] = true;
  scene.add(person);
  eye.position.set(0, 0, 5);
  style.render(scene, eye); // builds the lines
  for (const o of [person, eye]) o.position.x += 1000; // both moved, neither matrix updated yet
  style.render(scene, eye);
  expect(person.children[0].visible).toBe(true);
});

// two non-indexed geometries' positions as one
function mergeTwo(a: THREE.BufferGeometry, b: THREE.BufferGeometry) {
  const pa = a.getAttribute('position').array as Float32Array,
    pb = b.getAttribute('position').array as Float32Array,
    out = new Float32Array(pa.length + pb.length);
  out.set(pa);
  out.set(pb, pa.length);
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.BufferAttribute(out, 3));
  return g;
}
