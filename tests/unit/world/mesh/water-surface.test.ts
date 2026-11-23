import * as THREE from 'three';
import { describe, expect, it } from 'vitest';
import { WaterwayKind } from '../../../../src/world/data';
import { Heightfield } from '../../../../src/world/heightfield';
import { ShoreProps } from '../../../../src/world/mesh/shore-props';
import { WaterMaterial } from '../../../../src/world/mesh/water-material';
import { WaterSurface } from '../../../../src/world/mesh/water-surface';
import { layoutShore } from '../../../../src/world/shore';
import { GAME_WATER } from '../../../../src/world/water-palette';
import { WaterBodies } from '../../../../src/world/water-shapes';
import { makeValley, square } from '../fixture';

const world = makeValley({
  ww: [{ k: WaterwayKind.RIVER, p: [-180, 0, 180, 0] }],
  w: [[square(-150, -170, 100), square(-115, -135, 30)]],
});
const base = new Heightfield(world);
const bodies = new WaterBodies(world, base);
const material = new THREE.MeshBasicMaterial();

describe('WaterSurface', () => {
  const surface = new WaterSurface(bodies, { lakeMaterial: material, riverMaterial: material, exaggeration: 2 });
  const lakeMesh = surface.meshes.find(m => m.name.startsWith('lake:')) as THREE.Mesh;
  const rivers = surface.meshes.filter(m => m.name.startsWith('course:'));

  it('lays each lake flat at its level, exaggerated, and leaves the island out', () => {
    const pos = lakeMesh.geometry.getAttribute('position');
    for (let v = 0; v < pos.count; v++) expect(pos.getY(v)).toBeCloseTo(bodies.lakes[0].level * 2, 5);
    // no square has its middle on the island, well away from its shore
    const index = lakeMesh.geometry.getIndex() as THREE.BufferAttribute;
    for (let t = 0; t < index.count; t += 3) {
      let [x, z] = [0, 0];
      for (let k = 0; k < 3; k++) {
        x += pos.getX(index.getX(t + k)) / 3 + lakeMesh.position.x / 3;
        z += pos.getZ(index.getX(t + k)) / 3 + lakeMesh.position.z / 3;
      }
      expect(Math.abs(x + 100) < 8 && Math.abs(z + 120) < 8).toBe(false);
    }
  });

  it('runs a ribbon along the river at its level, with the distance from the waterline and the way along the flow', () => {
    expect(rivers.length).toBeGreaterThanOrEqual(2); // 360 m in pieces of about 300 m
    const c = bodies.courses[0];
    for (const m of rivers) {
      const pos = m.geometry.getAttribute('position');
      const shore = m.geometry.getAttribute('shore');
      const flow = m.geometry.getAttribute('flowUv');
      for (let v = 0; v < pos.count; v++) {
        const x = pos.getX(v) + m.position.x;
        const along = flow.getX(v);
        const k = Math.round(along / 2);
        expect(pos.getY(v)).toBeCloseTo(c.level[k] * 2, 4);
        expect(along).toBeCloseTo(x + 180, 0);
        expect(shore.getX(v)).toBeCloseTo(c.half[k] - Math.abs(flow.getY(v)), 5);
      }
    }
  });

  it('builds each mesh around its own middle, keeps the water material, and counts its triangles', () => {
    let triangles = 0;
    for (const m of surface.meshes) {
      m.geometry.computeBoundingBox();
      const box = m.geometry.boundingBox as THREE.Box3;
      expect(Math.abs(box.min.x + box.max.x)).toBeLessThan(1e-3);
      expect(m.userData.keepMaterial).toBe(true);
      expect(m.receiveShadow).toBe(true);
      triangles += (m.geometry.getIndex() as THREE.BufferAttribute).count / 3;
    }
    expect(surface.triangles).toBe(triangles);
  });

  it('frees its geometry', () => {
    let freed = 0;
    for (const m of surface.meshes) m.geometry.addEventListener('dispose', () => freed++);
    surface.dispose();
    expect(freed).toBe(surface.meshes.length);
  });
});

describe('ShoreProps', () => {
  const shore = layoutShore(bodies, base);
  const cut = new Heightfield(world, { cut: bodies });
  const colours = [new THREE.Color(1, 0, 0)];
  const props = new ShoreProps(shore, {
    heightAt: (x, z) => cut.heightAt(x, z),
    reedColours: colours,
    stoneColours: colours,
  });

  it('instances every reed and stone the layout placed, on the ground', () => {
    const count = (name: string) => props.meshes.filter(m => m.name === name).reduce((n, m) => n + m.count, 0);
    expect(count('shore-reeds')).toBe(shore.reeds.length / 4);
    expect(count('shore-stones')).toBe(shore.stones.length / 4);
    const m4 = new THREE.Matrix4();
    const p = new THREE.Vector3();
    for (const mesh of props.meshes) {
      mesh.getMatrixAt(0, m4);
      p.setFromMatrixPosition(m4);
      expect(p.y).toBeLessThanOrEqual(cut.heightAt(p.x, p.z));
      expect(p.y).toBeGreaterThan(cut.heightAt(p.x, p.z) - 0.2);
    }
  });

  it('frees its geometry and materials', () => {
    const owned = new Set<THREE.EventDispatcher<{ dispose: object }>>();
    for (const m of props.meshes) owned.add(m.geometry).add(m.material as THREE.Material);
    let freed = 0;
    for (const o of owned) o.addEventListener('dispose', () => freed++);
    props.dispose();
    expect(owned.size).toBeGreaterThanOrEqual(2);
    expect(freed).toBe(owned.size);
  });
});

describe('WaterMaterial', () => {
  const look = {
    colours: GAME_WATER,
    sunDir: new THREE.Vector3(0, 1, 0),
    horizon: new THREE.Color(1, 1, 1),
    flowing: true,
    detail: 'full' as const,
  };

  it('extends a Lambert material, so fog, shadows and the lights keep working', () => {
    const w = new WaterMaterial(look);
    expect(w.material).toBeInstanceOf(THREE.MeshLambertMaterial);
    expect(w.material.defines).toHaveProperty('WATER_FULL');
    expect(new WaterMaterial({ ...look, detail: 'lite' }).material.defines).not.toHaveProperty('WATER_FULL');
  });

  it('patches the shader with its uniforms, and shares them by reference with the page', () => {
    const w = new WaterMaterial(look);
    const shader = {
      uniforms: {} as Record<string, THREE.IUniform>,
      vertexShader: THREE.ShaderLib.lambert.vertexShader,
      fragmentShader: THREE.ShaderLib.lambert.fragmentShader,
    };
    w.material.onBeforeCompile(
      shader as unknown as THREE.WebGLProgramParametersWithUniforms,
      {} as THREE.WebGLRenderer,
    );
    expect(shader.vertexShader).toContain('vShore = shore;');
    expect(shader.fragmentShader).toContain('vec4 diffuseColor = vec4(waterC, opacity);');
    expect(shader.fragmentShader).not.toContain('vec4 diffuseColor = vec4( diffuse, opacity );');
    expect(shader.fragmentShader).toContain('#include <opaque_fragment>');
    expect(shader.uniforms.uSunDir.value).toBe(look.sunDir);
    w.tick(2.5, 0.4);
    expect(shader.uniforms.uTime.value).toBe(2.5);
    expect(shader.uniforms.uSunLight.value).toBe(0.4);
    w.toon = true;
    expect(shader.uniforms.uSoft.value).toBeLessThan(0.1);
  });

  it('frees its material', () => {
    const w = new WaterMaterial(look);
    let freed = false;
    w.material.addEventListener('dispose', () => {
      freed = true;
    });
    w.dispose();
    expect(freed).toBe(true);
  });
});
