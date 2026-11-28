import * as THREE from 'three';
import { describe, expect, it, vi } from 'vitest';
import { FlakeWarmer } from '../../../../src/game/render/paint-flakes';

// a renderer that records what it was asked to compile
function warmer() {
  const compiled: THREE.Object3D[][] = [],
    standIn = new THREE.MeshStandardMaterial(),
    w = new FlakeWarmer({
      renderer: {
        compileAsync: (group: THREE.Object3D) => {
          compiled.push([...group.children]);
          return Promise.resolve(group);
        },
      } as unknown as Pick<THREE.WebGLRenderer, 'compileAsync'>,
      scene: new THREE.Scene(),
      camera: new THREE.PerspectiveCamera(),
      standInGeo: () => new THREE.BufferGeometry(),
      standInMat: () => standIn,
    });
  return { w, compiled, standIn };
}

// a car's mesh with its model's body, in a paint of its own
function carMesh() {
  const mesh = new THREE.Group(),
    paint = new THREE.MeshStandardMaterial({ color: '#abcdef' });
  mesh.add(Object.assign(new THREE.Mesh(new THREE.BoxGeometry(), paint), { name: 'body' }));
  return { mesh, paint };
}

describe('FlakeWarmer', () => {
  it("compiles a flaked copy of the car's paint and the stand-in's metallic paint, leaving the car's own as it is", () => {
    const { w, compiled, standIn } = warmer(),
      { mesh, paint } = carMesh();
    w.warm('volvo', mesh);
    expect(compiled).toHaveLength(1);
    const [copy, standInMesh] = compiled[0]! as THREE.Mesh[];
    expect(copy!.material).not.toBe(paint);
    expect((copy!.material as THREE.Material).customProgramCacheKey()).toBe('paint-flakes');
    expect(standInMesh!.material).toBe(standIn);
    expect(paint.onBeforeCompile).toBe(THREE.Material.prototype.onBeforeCompile); // the car keeps its paint until it's bought
  });

  it('compiles each kind once, however often he offers the paints', () => {
    const { w, compiled } = warmer();
    w.warm('volvo', carMesh().mesh);
    w.warm('volvo', carMesh().mesh); // another car of the same kind
    expect(compiled).toHaveLength(1);
    w.warm('traktor', new THREE.Group()); // a stand-in of another type: the same shared metallic material, compiled already
    expect(compiled).toHaveLength(1);
  });

  it('only warns when compiling fails, so his menu still opens', () => {
    const w = new FlakeWarmer({
      renderer: {
        compileAsync: () => {
          throw new Error('context lost');
        },
      } as unknown as Pick<THREE.WebGLRenderer, 'compileAsync'>,
      scene: new THREE.Scene(),
      camera: new THREE.PerspectiveCamera(),
      standInGeo: () => new THREE.BufferGeometry(),
      standInMat: () => new THREE.MeshStandardMaterial(),
    });
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    expect(() => w.warm('volvo', carMesh().mesh)).not.toThrow();
    expect(warn).toHaveBeenCalledOnce();
    warn.mockRestore();
  });

  it('tries again, the next time he offers the paints, what failed to compile', () => {
    let fails = true;
    const compiled: number[] = [],
      w = new FlakeWarmer({
        renderer: {
          compileAsync: (group: THREE.Object3D) => {
            if (fails) throw new Error('context lost');
            compiled.push(group.children.length);
            return Promise.resolve(group);
          },
        } as unknown as Pick<THREE.WebGLRenderer, 'compileAsync'>,
        scene: new THREE.Scene(),
        camera: new THREE.PerspectiveCamera(),
        standInGeo: () => new THREE.BufferGeometry(),
        standInMat: () => new THREE.MeshStandardMaterial(),
      });
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    w.warm('volvo', carMesh().mesh);
    fails = false;
    w.warm('volvo', carMesh().mesh);
    expect(compiled).toEqual([2]); // the car's flaked paint and the stand-in's, both again
    warn.mockRestore();
  });
});
