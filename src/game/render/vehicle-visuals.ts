import * as THREE from 'three';
import { MeshoptDecoder } from 'three/addons/libs/meshopt_decoder.module.js';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';
import { BODY_NODE, type VehicleId, vehicleDefinition, WHEEL_NODES } from './vehicle-registry';

type Car = { mesh: THREE.Object3D; x: number; z: number; h: number };
type Definition = NonNullable<ReturnType<typeof vehicleDefinition>>;
type Wheel = { pivot: THREE.Group; spin: THREE.Group; front: boolean };
type View = {
  car: Car;
  definition: Definition;
  fallback: THREE.Mesh;
  status: 'idle' | 'loading' | 'loaded' | 'failed';
  root?: THREE.Group;
  wheels: Wheel[];
  materials: Set<THREE.Material>;
  beacons: THREE.MeshStandardMaterial[];
  selected: boolean;
  removed: boolean;
  x: number;
  z: number;
  heading: number;
  travel: number;
  distance: number;
  color?: string;
  metallic?: boolean;
  rim?: RimLook | null;
};
/** How the rims look: a colour (sRGB) and finish; null puts the model's own back. */
export type RimLook = { hex: string; metalness: number; roughness: number };
type Finish = { color: THREE.Color; metalness: number; roughness: number };
const METALLIC = { metalness: 0.7, roughness: 0.28 }; // a metallic paint's finish
const RIM_NODE = /^trim_rim_(?!whitewall)/; // the rims under each wheel node, not the Impala's whitewalls
const DETAIL_RANGE_M = 120,
  DETAIL_KEEP_M = 15, // a detailed car keeps its model until it is this much further away than the next candidate, so it doesn't pop back and forth
  DETAIL_CAP_COARSE = 3,
  DETAIL_CAP_DESKTOP = 8,
  REFRESH_SECONDS = 0.35;
// Rendering owns resource lifetime; no simulation or gameplay rules are mutated.
export class VehicleVisuals {
  private readonly loader = new GLTFLoader().setMeshoptDecoder(MeshoptDecoder);
  private readonly templates = new Map<string, Promise<THREE.Group>>();
  private readonly views: View[] = [];
  private readonly records = new WeakMap<Car, View>();
  private elapsed = REFRESH_SECONDS;
  private time = 0;
  // onBody hands out each loaded model's sprung body, the part that rolls and pitches without the wheels.
  constructor(
    private readonly coarse: boolean,
    private readonly onBody?: (car: Car, body: THREE.Object3D) => void,
  ) {}
  /** A model's loaded scene, fetched and parsed once and shared: clone it, or read it without changing it. */
  template(definition: { id: string; url: string }) {
    let task = this.templates.get(definition.id);
    if (!task) {
      task = this.loader.loadAsync(definition.url).then(g => g.scene);
      this.templates.set(definition.id, task);
    }
    return task;
  }
  private loadModel(view: View) {
    if (view.status !== 'idle') return;
    view.status = 'loading';
    this.template(view.definition)
      .then(template => {
        if (view.removed) return;
        const root = template.clone(true);
        root.updateMatrixWorld(true);
        const nodes = WHEEL_NODES.map(name => root.getObjectByName(name));
        if (nodes.some(n => !n) || !root.getObjectByName(BODY_NODE)) throw new Error('Missing body/wheel nodes');
        for (let i = 0; i < nodes.length; i++) {
          const node = nodes[i]!,
            pivot = new THREE.Group(),
            spin = new THREE.Group();
          root.attach(node); // preserve the supported parent transforms, including scale
          pivot.position.copy(node.position);
          node.removeFromParent();
          node.position.set(0, 0, 0);
          spin.add(node);
          pivot.add(spin);
          root.add(pivot);
          view.wheels.push({ pivot, spin, front: i < 2 });
        }
        const body = root.getObjectByName(BODY_NODE)!,
          sprung = new THREE.Group();
        root.attach(body);
        sprung.add(body);
        root.add(sprung);
        root.traverse(node => {
          if (!(node instanceof THREE.Mesh)) return;
          node.castShadow = !this.coarse;
          node.receiveShadow = true;
          if (view.definition.police && /^lamp_(blue_module|police_grille)/.test(node.name)) {
            node.material = node.material.clone();
            view.materials.add(node.material);
            node.material.emissive.set(0x176cff).convertSRGBToLinear();
            view.beacons.push(node.material);
          }
        });
        view.root = root;
        view.car.mesh.add(root);
        view.status = 'loaded';
        this.onBody?.(view.car, sprung);
        if (view.color) this.paint(view.car, view.color, view.metallic);
        if (view.rim) this.rims(view.car, view.rim);
        this.updateVisibility(view);
      })
      .catch(error => {
        if (!view.removed) {
          view.status = 'failed';
          console.warn('Vehicle asset failed:', view.definition.id, error);
        }
      });
  }
  private updateVisibility(view: View) {
    const visible = view.selected && view.status === 'loaded';
    view.fallback.visible = !visible;
    if (view.root) view.root.visible = visible;
  }
  /** Paints the body of the car's model, now or when it loads; `metallic` gives the paint a metallic finish (#3). */
  paint(car: Car, color: string, metallic = false) {
    const view = this.records.get(car);
    if (!view || view.definition.police) return;
    view.color = color;
    view.metallic = metallic;
    if (!view.root) return;
    const body = view.root.getObjectByName(BODY_NODE);
    const recolor = (material: THREE.MeshStandardMaterial) => {
      const m = this.own(view, material),
        base = m.userData.base as Finish;
      m.color.set(color).convertSRGBToLinear();
      m.metalness = metallic ? METALLIC.metalness : base.metalness;
      m.roughness = metallic ? METALLIC.roughness : base.roughness;
      return m;
    };
    body?.traverse(node => {
      if (!(node instanceof THREE.Mesh) || (node !== body && !node.name.startsWith(BODY_NODE + '_'))) return;
      node.material = Array.isArray(node.material) ? node.material.map(recolor) : recolor(node.material);
    });
  }
  /** Gives the car's model these rims, now or when it loads (#3); null puts its own back. */
  rims(car: Car, rim: RimLook | null) {
    const view = this.records.get(car);
    if (!view || view.definition.police) return;
    view.rim = rim;
    view.root?.traverse(node => {
      if (!(node instanceof THREE.Mesh) || !RIM_NODE.test(node.name) || Array.isArray(node.material)) return;
      const m = this.own(view, node.material),
        base = m.userData.base as Finish;
      if (rim) m.color.set(rim.hex).convertSRGBToLinear();
      else m.color.copy(base.color);
      m.metalness = rim ? rim.metalness : base.metalness;
      m.roughness = rim ? rim.roughness : base.roughness;
      node.material = m;
    });
  }
  // the view's own copy of a shared model material, made once, remembering the model's finish so it can be put back
  private own(view: View, material: THREE.MeshStandardMaterial) {
    if (view.materials.has(material)) return material;
    const m = material.clone();
    m.userData.base = { color: m.color.clone(), metalness: m.metalness, roughness: m.roughness } satisfies Finish;
    view.materials.add(m);
    return m;
  }
  attach(car: Car, id: VehicleId, fallback: THREE.Mesh, color?: string) {
    const definition = vehicleDefinition(id)!;
    const view: View = {
      car,
      definition,
      fallback,
      status: 'idle',
      wheels: [],
      materials: new Set(),
      beacons: [],
      selected: false,
      removed: false,
      x: car.x,
      z: car.z,
      heading: car.h,
      travel: 0,
      distance: 0,
      color,
    };
    this.views.push(view);
    this.records.set(car, view);
  }
  sync(car: Car) {
    const view = this.records.get(car);
    if (!view) return;
    const dx = car.x - view.x,
      dz = car.z - view.z,
      distance = Math.hypot(dx, dz);
    let dh = car.h - view.heading;
    dh = Math.atan2(Math.sin(dh), Math.cos(dh));
    const advance = dx * Math.sin(car.h) - dz * Math.cos(car.h);
    // Body yaw is -heading for a -Z-forward model; signed travel also handles reversing.
    const steering =
      Math.abs(advance) > 0.001 && distance < 20
        ? -Math.max(-0.6, Math.min(0.6, Math.atan((view.definition.wheelbase * dh) / advance)))
        : 0;
    if (distance < 20) view.travel += advance;
    for (const w of view.wheels) {
      w.pivot.rotation.y = w.front ? steering : 0;
      w.spin.rotation.x = -view.travel / view.definition.radius;
    }
    view.x = car.x;
    view.z = car.z;
    view.heading = car.h;
  }
  update(focus: { x: number; z: number }, dt: number) {
    this.elapsed += dt;
    this.time += dt;
    if (this.elapsed >= REFRESH_SECONDS) {
      this.elapsed = 0;
      for (const view of this.views)
        view.distance = Math.hypot(view.car.x - focus.x, view.car.z - focus.z) - (view.selected ? DETAIL_KEEP_M : 0);
      this.views.sort((a, b) => a.distance - b.distance);
      let count = 0;
      for (const view of this.views) {
        view.selected =
          view.status !== 'failed' &&
          view.distance < DETAIL_RANGE_M &&
          count++ < (this.coarse ? DETAIL_CAP_COARSE : DETAIL_CAP_DESKTOP);
        if (view.selected) this.loadModel(view);
        this.updateVisibility(view);
      }
    }
    for (const view of this.views)
      for (const beacon of view.beacons)
        beacon.emissiveIntensity = view.selected && Math.floor(this.time / 0.22) % 2 ? 1.8 : 0;
  }
  /** Whether the car's detailed model has loaded (false while loading, if it failed, or for a car without one). */
  loaded(car: Car) {
    return this.records.get(car)?.status === 'loaded';
  }
  /** The car's detailed model while it shows, else null: then its procedural body shows. */
  visibleModel(car: Car) {
    const root = this.records.get(car)?.root;
    return root?.visible ? root : null;
  }
  definition(car: Car) {
    return this.records.get(car)?.definition;
  }
  state(car: Car) {
    const view = this.records.get(car);
    return view
      ? {
          id: view.definition.id,
          status: view.status,
          detailed: !!view.root?.visible,
          wheels: view.wheels.map(w => ({
            steer: w.pivot.rotation.y,
            spin: w.spin.rotation.x,
          })),
          fallback: view.fallback.visible,
        }
      : null;
  }
  dispose(car: Car) {
    const view = this.records.get(car);
    if (!view) return;
    view.removed = true;
    view.root?.removeFromParent();
    for (const m of view.materials) m.dispose();
    this.views.splice(this.views.indexOf(view), 1);
    this.records.delete(car);
  }
}
