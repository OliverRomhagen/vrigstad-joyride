import * as THREE from 'three';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { RenderedCar } from '../../../../src/game/render/car-meshes';
import { CarModsMeshes } from '../../../../src/game/render/car-mods';
import { GLOWS, PAINTS, RIMS } from '../../../../src/game/sim/car-mods';
import { specFor } from '../../../../src/game/sim/vehicle-spec';

beforeEach(() => {
  const ctx = new Proxy({}, { get: () => () => ({ addColorStop: () => {} }) }); // the glow's drawing isn't under test
  vi.stubGlobal('document', { createElement: () => ({ width: 0, height: 0, getContext: () => ctx }) });
});
afterEach(() => vi.unstubAllGlobals());

// a car as CarMeshes hands it out, and what the parts did to its model
function setup() {
  const calls: unknown[][] = [];
  const geos = new Map<string, THREE.BufferGeometry>();
  const carGeo = (type: string, color: string) => {
    const key = type + color;
    if (!geos.has(key)) geos.set(key, new THREE.BufferGeometry());
    return geos.get(key)!;
  };
  const mods = new CarModsMeshes({
    vehicleVisuals: {
      paint: (...a) => void calls.push(['paint', ...a.slice(1)]),
      rims: (...a) => void calls.push(['rims', ...a.slice(1)]),
    },
    carGeo,
  });
  const c = {
    type: 'volvo',
    T: specFor('volvo'),
    color: '#27406b',
    mesh: new THREE.Group(),
    body: new THREE.Mesh(),
  } as RenderedCar;
  return { mods, c, calls, carGeo };
}

const glowOf = (c: RenderedCar) =>
  c.mesh.children.find(o => o instanceof THREE.Mesh) as
    | THREE.Mesh<THREE.BufferGeometry, THREE.MeshBasicMaterial>
    | undefined;

describe('CarModsMeshes', () => {
  it('paints the procedural body and the model, metallic or not', () => {
    const { mods, c, calls, carGeo } = setup();
    c.mods = { paint: 'slattsjo-bla' };
    mods.apply(c);
    expect(c.body.geometry).toBe(carGeo('volvo', PAINTS['slattsjo-bla'].hex));
    expect(calls).toContainEqual(['paint', PAINTS['slattsjo-bla'].hex, true]);
    c.mods = {};
    mods.apply(c);
    expect(c.body.geometry).toBe(carGeo('volvo', '#27406b')); // its own paint again
    expect(calls).toContainEqual(['paint', '#27406b', false]);
  });

  it('gives the model its rims, and takes them off again', () => {
    const { mods, c, calls } = setup();
    c.mods = { rims: 'guld' };
    mods.apply(c);
    expect(calls).toContainEqual(['rims', RIMS.guld]);
    c.mods = {};
    mods.apply(c);
    expect(calls.at(-1)).toEqual(['rims', null]);
  });

  it('lays a glow in the neon colour under the car, bigger than the car, and takes it away', () => {
    const { mods, c } = setup();
    c.mods = { glow: 'rosa' };
    mods.apply(c);
    const glow = glowOf(c)!;
    expect(glow.material.color.getHexString()).toBe(
      new THREE.Color(GLOWS.rosa.hex).convertSRGBToLinear().getHexString(),
    );
    expect(glow.material.blending).toBe(THREE.AdditiveBlending);
    expect(glow.scale.x).toBeGreaterThan(c.T.widthM);
    expect(glow.scale.z).toBeGreaterThan(c.T.lengthM);
    c.mods = { glow: 'gron' };
    mods.apply(c);
    expect(c.mesh.children.filter(o => o instanceof THREE.Mesh)).toHaveLength(1); // the same glow, recoloured
    c.mods = {};
    mods.apply(c);
    expect(glowOf(c)).toBeUndefined();
  });

  it('makes the glow stronger at night than in full sun', () => {
    const { mods, c } = setup();
    c.mods = { glow: 'bla' };
    mods.apply(c);
    mods.update(1);
    const day = glowOf(c)!.material.opacity;
    mods.update(0);
    expect(glowOf(c)!.material.opacity).toBeGreaterThan(day);
  });
});
