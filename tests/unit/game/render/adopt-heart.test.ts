import * as THREE from 'three';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { CAT_ADOPT_PETS, type Cat } from '../../../../src/game/cats';
import { AdoptHearts, HEART_ADOPT_S, HEART_BROKE_S } from '../../../../src/game/render/adopt-heart';

// The hearts draw their four fills on canvases once, in order: canvases[n] is the heart filled n thirds.
let canvases: unknown[];
let calm: boolean;

beforeEach(() => {
  canvases = [];
  calm = false;
  const ctx = new Proxy({}, { get: () => vi.fn() }); // every 2D call is a no-op; the drawing itself isn't under test
  vi.stubGlobal('document', {
    createElement: () => {
      const cv = { width: 0, height: 0, getContext: () => ctx };
      canvases.push(cv);
      return cv;
    },
  });
  vi.stubGlobal('matchMedia', () => ({ matches: calm }));
  vi.stubGlobal('Path2D', class {});
});

afterEach(() => vi.unstubAllGlobals());

const world = new THREE.Group();
const cat = (pets = 0) => {
  const mesh = new THREE.Mesh();
  world.add(mesh);
  return { pets, mesh } as Partial<Cat> as Cat;
};

const make = () => {
  const scene = new THREE.Scene(),
    colony: { owned: Cat | null } = { owned: null };
  return { scene, colony, hearts: new AdoptHearts({ scene, colony }) };
};

const sprites = (scene: THREE.Scene) => scene.children as THREE.Sprite[];
const fill = (s: THREE.Sprite) => canvases.indexOf(s.material.map!.image);

describe('AdoptHearts', () => {
  it('shows no heart for a cat that has no good pets', () => {
    const { scene, hearts } = make();
    hearts.show(cat(0));
    expect(scene.children).toHaveLength(0);
  });

  it('fills the heart by thirds as the same cat is petted, and keeps it while the streak lasts', () => {
    const { scene, hearts } = make(),
      k = cat();
    for (let pets = 1; pets <= CAT_ADOPT_PETS; pets++) {
      k.pets = pets;
      hearts.show(k);
      hearts.update(10); // long past any timer: a streak has none
      expect(sprites(scene)).toHaveLength(1);
      expect(fill(sprites(scene)[0])).toBe(pets);
    }
  });

  it('follows the cat and hides when it does', () => {
    const { scene, hearts } = make(),
      k = cat(1);
    k.mesh.position.set(5, 0, -3);
    k.mesh.visible = false;
    hearts.show(k);
    hearts.update(0.1);
    const s = sprites(scene)[0];
    expect(s.position.x).toBe(5);
    expect(s.position.z).toBe(-3);
    expect(s.position.y).toBeGreaterThan(0);
    expect(s.visible).toBe(false);
  });

  it('wobbles an empty heart when the streak breaks, then lets it go', () => {
    const { scene, hearts } = make(),
      k = cat(2);
    hearts.show(k);
    k.pets = 0;
    hearts.show(k);
    const s = sprites(scene)[0];
    expect(fill(s)).toBe(0);
    hearts.update(0.05);
    expect(s.material.rotation).not.toBe(0);
    hearts.update(HEART_BROKE_S - 0.1);
    expect(scene.children).toHaveLength(1);
    hearts.update(0.1);
    expect(scene.children).toHaveLength(0);
  });

  it('fills the heart again on a good pet after a broken streak', () => {
    const { scene, hearts } = make(),
      k = cat(2);
    hearts.show(k);
    k.pets = 0;
    hearts.show(k);
    const broke = sprites(scene)[0].material,
      dispose = vi.spyOn(broke, 'dispose');
    k.pets = 1;
    hearts.show(k);
    hearts.update(10); // a streak again: no timer
    expect(sprites(scene)).toHaveLength(1);
    expect(sprites(scene)[0].material).not.toBe(broke);
    expect(fill(sprites(scene)[0])).toBe(1);
    expect(dispose).toHaveBeenCalled();
  });

  it('drops the heart when the player says no to adopting', () => {
    const { scene, hearts } = make(),
      k = cat(CAT_ADOPT_PETS);
    hearts.show(k);
    k.pets = 0; // what colony.decline does, with no showHeart after it
    hearts.update(0.1);
    expect(scene.children).toHaveLength(0);
  });

  it('gives each broken heart its own material, so two never wobble as one', () => {
    const { scene, hearts } = make(),
      a = cat(1),
      b = cat(1);
    hearts.show(a);
    hearts.show(b);
    a.pets = b.pets = 0;
    hearts.show(a);
    hearts.show(b);
    const [sa, sb] = sprites(scene);
    expect(sa.material).not.toBe(sb.material);
    expect(sa.material.map).toBe(sb.material.map); // the texture is still shared
  });

  it('keeps a broken heart still when the player prefers reduced motion', () => {
    calm = true;
    const { scene, hearts } = make(),
      k = cat(1);
    hearts.show(k);
    k.pets = 0;
    hearts.show(k);
    hearts.update(0.05);
    expect(sprites(scene)[0].material.rotation).toBe(0);
  });

  it('clears the other hearts when a cat is adopted, and shows the adopted one full for a while', () => {
    const { scene, colony, hearts } = make(),
      a = cat(2),
      b = cat(CAT_ADOPT_PETS);
    hearts.show(a);
    hearts.show(b);
    colony.owned = b;
    b.pets = 0; // pets stop counting once adopted; the heart is full anyway
    hearts.show(b);
    hearts.update(0.1);
    expect(sprites(scene)).toHaveLength(1);
    expect(fill(sprites(scene)[0])).toBe(CAT_ADOPT_PETS);
    hearts.show(cat(1)); // while you own a cat, petting a stray shows nothing
    expect(sprites(scene)).toHaveLength(1);
    hearts.update(HEART_ADOPT_S - 0.3);
    expect(sprites(scene)).toHaveLength(1);
    hearts.update(0.3);
    expect(scene.children).toHaveLength(0);
  });

  it('pops a full heart over your own cat each pet, and starts its time over', () => {
    const { scene, colony, hearts } = make(),
      k = cat(0);
    colony.owned = k;
    hearts.show(k); // no heart yet, and pets don't count: it shows full anyway
    expect(sprites(scene)).toHaveLength(1);
    expect(fill(sprites(scene)[0])).toBe(CAT_ADOPT_PETS);
    hearts.update(HEART_ADOPT_S - 0.5);
    hearts.show(k);
    hearts.update(HEART_ADOPT_S - 0.5); // past the first pet's time, not the second's
    expect(sprites(scene)).toHaveLength(1);
    hearts.update(0.5);
    expect(scene.children).toHaveLength(0);
  });

  it('drops the heart of a cat that leaves the world', () => {
    const { scene, hearts } = make(),
      k = cat(1);
    hearts.show(k);
    world.remove(k.mesh);
    hearts.update(0.1);
    expect(scene.children).toHaveLength(0);
  });
});
