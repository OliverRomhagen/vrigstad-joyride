// The adopt heart: hovers over a stray once it has had a good pet, a third fuller for each good pet in a row.
// A sprite in the scene, so it shrinks with distance and hides behind walls like the cat does.
// Moved from src/game/main.ts (#177); main.ts passes in what the hearts read from the rest of the game.
import * as THREE from 'three';
import { CAT_ADOPT_PETS, type Cat, type CatColony } from '../cats';

export const HEART_BROKE_S = 0.8,
  HEART_ADOPT_S = 2; // a broken streak wobbles the empty heart / an adopted cat shows a full one this long (s) before it goes
const HEART_M = 0.42,
  HEART_Y = 0.9,
  HEART_POP_S = 0.35; // heart size and height of its middle over the cat's feet (m); how long a new or fuller heart pops (s)
const HEART_PATH =
  'M12 21s-7.5-4.6-10-9.2C.3 8.4 2.3 4 6.4 4c2.2 0 3.8 1.3 5.6 3.3C13.8 5.3 15.4 4 17.6 4 21.7 4 23.7 8.4 22 11.8 19.5 16.4 12 21 12 21z';

/** A cat's heart: its sprite, s until it goes (Infinity while the streak lasts), s since the last pet, and its own wobbling material once broken. */
interface Heart {
  s: THREE.Sprite;
  t: number;
  age: number;
  broke: THREE.SpriteMaterial | null;
}

/** What the hearts read from the rest of the game. */
export interface AdoptHeartDeps {
  scene: THREE.Scene;
  colony: Pick<CatColony, 'owned'>;
}

/** The hearts over the cats you are petting. */
export class AdoptHearts {
  private readonly g: AdoptHeartDeps;
  private readonly calm = matchMedia('(prefers-reduced-motion: reduce)').matches;
  private readonly mats: THREE.SpriteMaterial[];
  private readonly hearts = new Map<Cat, Heart>();

  constructor(g: AdoptHeartDeps) {
    this.g = g;
    // one material per fill (0 to 3 thirds), drawn once on a canvas: a light outline, and the pink fill clipped from the bottom.
    // With its 2-unit stroke the heart spans y 3 to 22 of its 24-unit box, so the fill line is measured on that.
    this.mats = [0, 1, 2, 3].map(n => {
      const cv = document.createElement('canvas');
      cv.width = cv.height = 120;
      const g = cv.getContext('2d')!,
        p = new Path2D(HEART_PATH);
      g.setTransform(4, 0, 0, 4, 12, 12); // 12 px of margin: room for the stroke and its shadow
      g.lineWidth = 2;
      g.lineJoin = 'round';
      g.shadowColor = 'rgba(0, 0, 0, .55)';
      g.shadowBlur = 6;
      g.strokeStyle = '#f4f1e6';
      g.stroke(p);
      g.shadowColor = 'transparent';
      if (n) {
        g.save();
        g.beginPath();
        g.rect(-2, n >= CAT_ADOPT_PETS ? -2 : 3 + 19 * (1 - n / CAT_ADOPT_PETS), 28, 28);
        g.clip();
        g.fillStyle = g.strokeStyle = '#e8506a';
        g.fill(p);
        g.stroke(p);
        g.restore();
      }
      const t = new THREE.CanvasTexture(cv);
      t.colorSpace = THREE.SRGBColorSpace;
      return new THREE.SpriteMaterial({ map: t, depthWrite: false, fog: false, toneMapped: false }); // the HUD's colours, not the scene's light
    });
  }

  // after a pet: a new or fuller heart pops, a broken streak wobbles the empty one away, while pets count towards adopting; your own cat pops a full one each pet or treat, a small love signal
  show(k: Cat) {
    const { colony, scene } = this.g,
      { mats } = this;
    let h = this.hearts.get(k);
    const full = colony.owned === k,
      pets = full ? CAT_ADOPT_PETS : k.pets;
    if (!h) {
      if (!pets || (colony.owned && !full)) return;
      h = { s: new THREE.Sprite(mats[0]), t: 0, age: 0, broke: null };
      h.s.renderOrder = 1;
      scene.add(h.s);
      this.hearts.set(k, h);
    }
    h.t = full ? HEART_ADOPT_S : pets ? Infinity : HEART_BROKE_S;
    h.age = 0;
    if (h.broke) {
      h.broke.dispose();
      h.broke = null;
    }
    if (!pets) h.broke = mats[0].clone(); // a copy to wobble, sharing the texture, so two broken hearts don't wobble as one
    h.s.material = h.broke || mats[Math.min(pets, CAT_ADOPT_PETS)];
  }

  update(dt: number) {
    const { hearts, calm } = this,
      { colony, scene } = this.g;
    if (!hearts.size) return;
    for (const [k, h] of hearts) {
      h.t -= dt;
      h.age += dt;
      // gone: done showing, despawned or sent home, a no to adopting, or another cat adopted (pets stop counting then)
      if (h.t <= 0 || !k.mesh.parent || (h.t === Infinity && !k.pets) || (colony.owned && colony.owned !== k)) {
        scene.remove(h.s);
        if (h.broke) h.broke.dispose();
        hearts.delete(k);
        continue;
      }
      k.mesh.getWorldPosition(h.s.position);
      h.s.position.y += HEART_Y;
      h.s.visible = k.mesh.visible;
      const a = calm ? 1 : Math.min(1, h.age / HEART_POP_S);
      h.s.scale.setScalar(HEART_M * (h.broke ? 1 : 0.4 + 0.6 * a + Math.sin(a * Math.PI) * 0.35)); // pops up past its size and settles
      if (h.broke) h.broke.rotation = calm ? 0 : Math.sin(h.age * 40) * 0.35 * (1 - h.age / HEART_BROKE_S);
    }
  }
}
