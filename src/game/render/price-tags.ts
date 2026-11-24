// Plåt-Pelle's price, in marker on a card, in the windscreen and the rear window of each car for sale on Skroten's lot (#76), so you see it
// before you press E from either end. It reads the cars' saleKr and never changes it. A ray finds the glass, so the cards fit every model
// and the simple shapes alike.
import * as THREE from 'three';
import { makeRnd } from '../../world/random';
import { lotPrice } from '../economy';
import type { RenderedCar } from './car-meshes';

const CARD_W_M = 0.58,
  CARD_H_M = 0.3;
const CARD_PX = 256; // the card's width in pixels
const CARD_SIDE_M = 0.3; // right of the middle, on the passenger's side
const GLASS_BELOW_TOP_M = [0.3, 0.4, 0.22, 0.5]; // tried in turn: how far under the car's top the ray looks for the glass
// a face whose normal points up less than this is not the glass: at the front a grille or a bumper; at the back, where an estate's rear
// window stands upright, only the underside of a spoiler or a roof's edge
const GLASS_MIN_UP = { front: 0.2, back: -0.1 };
const HAND_FONT = '"Marker Felt", "Chalkboard SE", "Segoe Print", "Comic Sans MS", cursive'; // what a marker writes like, on most systems
const WOBBLE_RAD = 0.09, // each figure leans up to this much either way
  BOUNCE_PX = 5; // and sits up to this far off the line
const CARD_OFF_M = 0.012; // the card stands this far off the glass, so the two don't flicker into each other
const LOOK_FROM_M = 6; // the ray starts this far in front of or behind the car's middle
const REFRESH_S = 0.35; // how often the cards check for a sale, a new car or a model swapped in or out

const _o = new THREE.Vector3(),
  _d = new THREE.Vector3(),
  _n = new THREE.Vector3(),
  _box = new THREE.Box3(),
  _inv = new THREE.Matrix4(),
  _m = new THREE.Matrix4();
const ZERO = new THREE.Vector3(),
  UP = new THREE.Vector3(0, 1, 0);

/** What the cards read from the rest of the game. */
export interface PriceTagsDeps {
  doc: Pick<Document, 'createElement'>;
  readonly cars: readonly RenderedCar[];
  visibleModel(c: RenderedCar): THREE.Object3D | null; // the detailed model while it shows; else the procedural body does
}

type End = keyof typeof GLASS_MIN_UP;
const ENDS: readonly End[] = ['front', 'back'];
// where a card sits on one shape, in the car's frame; null when no ray found the glass
type Fit = { position: THREE.Vector3; quaternion: THREE.Quaternion } | null;
// a card per end; `on`: the shape they show on now; `fits`: each shape's fit, worked out once, as a car swaps its model in and out often
type Tag = { cards: THREE.Mesh[]; on: THREE.Object3D; kr: number; fits: Map<THREE.Object3D, Fit[]> };

/** The cards; `update` adds, fits and takes them away. */
export class PriceTags {
  private readonly g: PriceTagsDeps;
  private readonly tags = new Map<RenderedCar, Tag>();
  // by price, kept for good: the lot's prices, and a dented car's at most a few dozen more, each a small canvas
  private readonly materials = new Map<number, THREE.Material>();
  private readonly geo = new THREE.PlaneGeometry(CARD_W_M, CARD_H_M);
  private readonly ray = new THREE.Raycaster();
  private wait = 0;

  constructor(g: PriceTagsDeps) {
    this.g = g;
  }

  update(dt: number) {
    this.wait -= dt;
    if (this.wait > 0) return;
    this.wait = REFRESH_S;
    for (const [c, tag] of this.tags)
      if (!c.saleKr || !c.mesh.parent) {
        for (const card of tag.cards) card.removeFromParent(); // a car taken away has left the scene with its cards already
        this.tags.delete(c);
      }
    for (const c of this.g.cars) {
      if (!c.saleKr) continue;
      const shape = this.g.visibleModel(c) ?? c.body,
        kr = lotPrice(c.saleKr, c.dmg) ?? 0, // a wreck isn't for sale: no card
        tag = this.tags.get(c);
      if (tag?.on === shape && tag.kr === kr) continue;
      const cards = tag?.cards ?? ENDS.map(() => new THREE.Mesh(this.geo)),
        fits = tag?.fits ?? new Map<THREE.Object3D, Fit[]>();
      let shapeFits = fits.get(shape);
      if (!shapeFits) {
        shapeFits = ENDS.map(end => this.fit(c, shape, end));
        fits.set(shape, shapeFits);
      }
      ENDS.forEach((_end, i) => {
        const card = cards[i]!,
          fit = shapeFits[i];
        card.visible = !!(fit && kr);
        if (fit) {
          card.position.copy(fit.position);
          card.quaternion.copy(fit.quaternion);
        }
        if (kr) card.material = this.material(kr);
        c.mesh.add(card);
      });
      this.tags.set(c, { cards, on: shape, kr, fits });
    }
  }

  // where a card goes on the windscreen or the rear window of `shape`, in c.mesh's frame; null when no ray finds the glass
  private fit(c: RenderedCar, shape: THREE.Object3D, end: End): Fit {
    c.mesh.updateMatrixWorld(true);
    _inv.copy(c.mesh.matrixWorld).invert();
    const top = _box.setFromObject(shape).max.y - c.mesh.position.y,
      deep = shape !== c.body; // the procedural body is one mesh; a model is a tree of them
    const out = end === 'front' ? -1 : 1; // nose at local -z: the ray comes from out there, along the car
    for (const below of GLASS_BELOW_TOP_M) {
      _o.set(CARD_SIDE_M, top - below, out * LOOK_FROM_M).applyMatrix4(c.mesh.matrixWorld);
      _d.set(0, 0, -out).transformDirection(c.mesh.matrixWorld);
      this.ray.set(_o, _d);
      this.ray.far = LOOK_FROM_M * 2;
      const hit = this.ray.intersectObject(shape, deep)[0];
      if (!hit?.face) continue;
      _n.copy(hit.face.normal).transformDirection(hit.object.matrixWorld).transformDirection(_inv);
      if (_n.z * out < 0) _n.negate(); // a face wound the other way: the card faces out of its end
      if (_n.y < GLASS_MIN_UP[end]) continue;
      return {
        position: hit.point.clone().applyMatrix4(_inv).addScaledVector(_n, CARD_OFF_M),
        quaternion: new THREE.Quaternion().setFromRotationMatrix(_m.lookAt(_n, ZERO, UP)),
      };
    }
    return null;
  }

  // a white card with the price in red marker, Swedish style: "2 000:-", each figure a little off, and a quick line under it
  private material(kr: number) {
    let m = this.materials.get(kr);
    if (m) return m;
    const cv = this.g.doc.createElement('canvas'),
      w = CARD_PX,
      h = Math.round((CARD_PX * CARD_H_M) / CARD_W_M);
    cv.width = w;
    cv.height = h;
    const c = cv.getContext('2d')!;
    c.fillStyle = '#f4f1e6';
    c.fillRect(0, 0, w, h);
    const text = kr.toLocaleString('sv-SE') + ':-';
    c.fillStyle = c.strokeStyle = '#b3171b';
    c.textBaseline = 'middle';
    c.font = `bold 88px ${HAND_FONT}`;
    const px = Math.floor(88 * Math.min(1, (w - 24) / c.measureText(text).width)); // a long price in a wide hand is written smaller
    c.font = `bold ${px}px ${HAND_FONT}`;
    // the same wobble for the same price, from the price itself: this is the look, not a gameplay roll
    const rnd = makeRnd(kr),
      wobble = () => rnd() * 2 - 1;
    let pen = (w - c.measureText(text).width) / 2;
    const line = h * 0.46;
    for (const ch of text) {
      const cw = c.measureText(ch).width;
      c.save();
      c.translate(pen + cw / 2, line + wobble() * BOUNCE_PX);
      c.rotate(wobble() * WOBBLE_RAD);
      c.textAlign = 'center';
      c.fillText(ch, 0, 0);
      c.restore();
      pen += cw;
    }
    c.lineWidth = 6;
    c.lineCap = 'round';
    c.beginPath();
    const y0 = line + px * 0.52;
    c.moveTo(w * 0.16, y0 + wobble() * 3);
    c.quadraticCurveTo(w / 2, y0 + 8 + wobble() * 4, w * 0.84, y0 - 4 + wobble() * 3);
    c.stroke();
    const t = new THREE.CanvasTexture(cv);
    t.colorSpace = THREE.SRGBColorSpace;
    m = new THREE.MeshStandardMaterial({ map: t, roughness: 0.9, polygonOffset: true, polygonOffsetFactor: -2 });
    this.materials.set(kr, m);
    return m;
  }
}
