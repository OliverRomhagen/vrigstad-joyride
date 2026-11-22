// Plåt-Pelle's price on a card in the rear window of each car for sale on Skroten's lot (#76), so you see it before you press E: the cars
// stand noses to the yard, so you come up behind them. It reads the cars' saleKr and never changes it. A ray finds the glass, so the card
// fits every model and the simple shapes alike.
import * as THREE from 'three';
import type { RenderedCar } from './car-meshes';

const CARD_W_M = 0.58,
  CARD_H_M = 0.3;
const CARD_PX = 256; // the card's width in pixels
const CARD_SIDE_M = 0.3; // right of the middle, on the passenger's side
const GLASS_BELOW_TOP_M = [0.3, 0.4, 0.22, 0.5]; // tried in turn: how far under the car's top the ray looks for the rear window
const GLASS_MIN_UP = -0.1; // a face whose normal points further down than this is the underside of a spoiler or a roof's edge, not glass
const CARD_OFF_M = 0.012; // the card stands this far off the glass, so the two don't flicker into each other
const LOOK_FROM_M = 6; // the ray starts this far behind the car's middle
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

type Tag = { card: THREE.Mesh; on: THREE.Object3D; kr: number }; // `on`: the shape the card was fitted to

/** The cards; `update` adds, fits and takes them away. */
export class PriceTags {
  private readonly g: PriceTagsDeps;
  private readonly tags = new Map<RenderedCar, Tag>();
  private readonly materials = new Map<number, THREE.Material>(); // by price: the lot has few
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
        tag.card.removeFromParent(); // a car taken away has left the scene with its card already
        this.tags.delete(c);
      }
    for (const c of this.g.cars) {
      if (!c.saleKr) continue;
      const shape = this.g.visibleModel(c) ?? c.body,
        tag = this.tags.get(c);
      if (tag?.on === shape && tag.kr === c.saleKr) continue;
      const card = tag?.card ?? new THREE.Mesh(this.geo);
      card.material = this.material(c.saleKr);
      card.visible = this.fit(c, shape, card);
      c.mesh.add(card);
      this.tags.set(c, { card, on: shape, kr: c.saleKr });
    }
  }

  // puts the card on the rear window of `shape`, in c.mesh's frame; false when no ray finds the glass
  private fit(c: RenderedCar, shape: THREE.Object3D, card: THREE.Mesh) {
    c.mesh.updateMatrixWorld(true);
    _inv.copy(c.mesh.matrixWorld).invert();
    const top = _box.setFromObject(shape).max.y - c.mesh.position.y,
      deep = shape !== c.body; // the procedural body is one mesh; a model is a tree of them
    for (const below of GLASS_BELOW_TOP_M) {
      // nose at local -z: look from behind the tail, forwards along the car
      _o.set(CARD_SIDE_M, top - below, LOOK_FROM_M).applyMatrix4(c.mesh.matrixWorld);
      _d.set(0, 0, -1).transformDirection(c.mesh.matrixWorld);
      this.ray.set(_o, _d);
      this.ray.far = LOOK_FROM_M * 2;
      const hit = this.ray.intersectObject(shape, deep)[0];
      if (!hit?.face) continue;
      _n.copy(hit.face.normal).transformDirection(hit.object.matrixWorld).transformDirection(_inv);
      if (_n.z < 0) _n.negate(); // a face wound the other way: the card faces out of the back
      if (_n.y < GLASS_MIN_UP) continue;
      card.position.copy(hit.point).applyMatrix4(_inv).addScaledVector(_n, CARD_OFF_M);
      card.quaternion.setFromRotationMatrix(_m.lookAt(_n, ZERO, UP));
      return true;
    }
    return false;
  }

  // a white card with the price in marker, Swedish style: "2 000:-"
  private material(kr: number) {
    let m = this.materials.get(kr);
    if (m) return m;
    const cv = this.g.doc.createElement('canvas'),
      w = CARD_PX,
      h = Math.round((CARD_PX * CARD_H_M) / CARD_W_M);
    cv.width = w;
    cv.height = h;
    const x = cv.getContext('2d')!;
    x.fillStyle = '#f4f1e6';
    x.fillRect(0, 0, w, h);
    x.textAlign = 'center';
    x.textBaseline = 'middle';
    x.fillStyle = '#b3171b';
    x.font = 'bold 92px sans-serif';
    x.fillText(kr.toLocaleString('sv-SE') + ':-', w / 2, h * 0.54, w - 14);
    const t = new THREE.CanvasTexture(cv);
    t.colorSpace = THREE.SRGBColorSpace;
    m = new THREE.MeshStandardMaterial({ map: t, roughness: 0.9, polygonOffset: true, polygonOffsetFactor: -2 });
    this.materials.set(kr, m);
    return m;
  }
}
