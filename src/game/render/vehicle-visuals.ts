import * as THREE from 'three';
import { MeshoptDecoder } from 'three/addons/libs/meshopt_decoder.module.js';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';
import type { LampState } from '../lighting';
import {
  BEACON_PARTS,
  BODY_NODE,
  type VehicleId,
  type VehicleLamps,
  vehicleDefinition,
  WHEEL_NODES,
} from './vehicle-registry';

type Car = { mesh: THREE.Object3D; x: number; z: number; h: number; saleKr?: number };
type Definition = NonNullable<ReturnType<typeof vehicleDefinition>>;
type Wheel = { pivot: THREE.Group; spin: THREE.Group; front: boolean };
type LampGroup = keyof VehicleLamps;
/** How a lamp looks: its model's own material, or lit dimly (dipped headlights, rear position lights) or fully. */
type LampLook = 'off' | 'run' | 'full';
type Lamp = {
  mesh: THREE.Mesh;
  group: LampGroup;
  off: THREE.Material;
  lit: Record<'run' | 'full', THREE.Material>;
  look: LampLook;
};
type View = {
  car: Car;
  definition: Definition;
  fallback: THREE.Mesh;
  status: 'idle' | 'loading' | 'loaded' | 'failed';
  root?: THREE.Group;
  wheels: Wheel[];
  materials: Set<THREE.Material>;
  beacons: THREE.MeshStandardMaterial[];
  lamps: Lamp[];
  selected: boolean;
  removed: boolean;
  x: number;
  z: number;
  heading: number;
  travel: number;
  distance: number;
  color?: string;
};
const DETAIL_RANGE_M = 120,
  DETAIL_KEEP_M = 15, // a detailed car keeps its model until it is this much further away than the next candidate, so it doesn't pop back and forth
  DETAIL_CAP_COARSE = 3,
  DETAIL_CAP_DESKTOP = 8,
  REFRESH_SECONDS = 0.35,
  // a part casts a shadow only if it has this much surface (m²): the body, the bumpers, the trim; not lamps, grilles,
  // rims or beacons, whose shadows are a texel or two at the game's shadow resolution (about 0.1 m) but cost a draw call
  // each. Area, not size: a part merged per material (tools/vehicle-parts.ts) spans the whole car however small it is.
  SHADOW_MIN_AREA_M2 = 1;
// Lamp colours (#304, sRGB): warm halogen on the old cars, a cooler white on the XC70s, deep red tails, amber hazards.
const LAMP_COLOURS: Record<LampGroup, number> = { head: 0xffe7c2, rear: 0xc4101a, reverse: 0xfff8f0, hazard: 0xff9a1f },
  COOL_HEAD = 0xf2f4ff,
  // emissive intensities, picked by eye in daylight: a dipped or position lamp reads as switched on, a brake light
  // clearly brighter than the tail beside it. Lit lamps skip tone mapping, which bleaches a bright red to pink.
  LAMP_RUN_I = 0.5,
  LAMP_FULL_I = 2;
const areas = new WeakMap<THREE.BufferGeometry, number>(),
  _a = new THREE.Vector3(),
  _b = new THREE.Vector3(),
  _c = new THREE.Vector3();
/** A geometry's surface area in its own units, once per geometry: the models' clones share theirs. */
function surfaceArea(geometry: THREE.BufferGeometry) {
  let area = areas.get(geometry);
  if (area !== undefined) return area;
  const position = geometry.attributes.position!,
    index = geometry.index,
    count = index ? index.count : position.count;
  area = 0;
  for (let i = 0; i + 2 < count; i += 3) {
    _a.fromBufferAttribute(position, index ? index.getX(i) : i);
    _b.fromBufferAttribute(position, index ? index.getX(i + 1) : i + 1).sub(_a);
    _c.fromBufferAttribute(position, index ? index.getX(i + 2) : i + 2).sub(_a);
    area += _b.cross(_c).length() / 2;
  }
  areas.set(geometry, area);
  return area;
}
/** The body and the tyres always cast; glass never does (a car's shadow is its shell); other parts by their area. */
function castsShadow(node: THREE.Mesh) {
  if (node.name === BODY_NODE || (WHEEL_NODES as readonly string[]).includes(node.name)) return true;
  return !node.name.startsWith('glass_') && surfaceArea(node.geometry) >= SHADOW_MIN_AREA_M2;
}
/** How a lamp group looks for state s: headlights dipped or full, tails run or brake, the others on or off. */
function lookOf(group: LampGroup, s: LampState): LampLook {
  if (group === 'head') return s.head >= 0.5 ? 'full' : s.head > 0 ? 'run' : 'off';
  if (group === 'rear') return s.brake ? 'full' : s.rear > 0 ? 'run' : 'off';
  return s[group] ? 'full' : 'off';
}
// Rendering owns resource lifetime; no simulation or gameplay rules are mutated.
export class VehicleVisuals {
  private readonly loader = new GLTFLoader().setMeshoptDecoder(MeshoptDecoder);
  private readonly templates = new Map<string, Promise<THREE.Group>>();
  private readonly views: View[] = [];
  private readonly records = new WeakMap<Car, View>();
  private elapsed = REFRESH_SECONDS;
  private time = 0;
  // lit variants of each lamp material, shared by every car of a model: a car's lamps swap materials, never clone them.
  // At most two per lamp material of the fleet (about 40), kept for the page's life like the templates.
  private readonly lit = new Map<THREE.Material, Record<'run' | 'full', THREE.Material>>();
  // onBody hands out each loaded model's sprung body, the part that rolls and pitches without the wheels. lampsOf says
  // what a car's lamps show this frame (lighting.ts); without it the lamps stay as modelled.
  constructor(
    private readonly coarse: boolean,
    private readonly onBody?: (car: Car, body: THREE.Object3D) => void,
    private readonly lampsOf?: (car: Car) => LampState,
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
        const lamps: VehicleLamps = view.definition.lamps,
          cool = 'coolHead' in view.definition && view.definition.coolHead;
        root.traverse(node => {
          if (!(node instanceof THREE.Mesh)) return;
          const group = (Object.keys(lamps) as LampGroup[]).find(g => lamps[g]?.includes(node.name));
          if (group && !Array.isArray(node.material)) {
            const lit = this.litVariants(node.material, group === 'head' && cool ? COOL_HEAD : LAMP_COLOURS[group]);
            view.lamps.push({ mesh: node, group, off: node.material, lit, look: 'off' });
          }
          node.castShadow = !this.coarse && castsShadow(node);
          node.receiveShadow = true;
          if (view.definition.police && BEACON_PARTS.test(node.name)) {
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
        if (view.color) this.paint(view.car, view.color);
        this.updateVisibility(view);
      })
      .catch(error => {
        if (!view.removed) {
          view.status = 'failed';
          console.warn('Vehicle asset failed:', view.definition.id, error);
        }
      });
  }
  private litVariants(off: THREE.Material, colour: number) {
    let variants = this.lit.get(off);
    if (!variants) {
      const make = (intensity: number) => {
        const m = off.clone() as THREE.MeshStandardMaterial;
        m.emissive.set(colour).convertSRGBToLinear();
        m.emissiveIntensity = intensity;
        m.toneMapped = false;
        return m;
      };
      variants = { run: make(LAMP_RUN_I), full: make(LAMP_FULL_I) };
      this.lit.set(off, variants);
    }
    return variants;
  }
  private light(view: View, s: LampState) {
    for (const lamp of view.lamps) {
      const look = lookOf(lamp.group, s);
      if (look === lamp.look) continue;
      lamp.look = look;
      lamp.mesh.material = look === 'off' ? lamp.off : lamp.lit[look];
    }
  }
  private updateVisibility(view: View) {
    const visible = view.selected && view.status === 'loaded';
    view.fallback.visible = !visible;
    if (view.root) view.root.visible = visible;
  }
  paint(car: Car, color: string) {
    const view = this.records.get(car);
    if (!view || view.definition.police) return;
    view.color = color;
    if (!view.root) return;
    const body = view.root.getObjectByName(BODY_NODE);
    const recolor = (material: THREE.MeshStandardMaterial) => {
      // the driver's view's clipped clone is the cockpit's own (cockpit.ts): recoloured where it is, as a clone would keep a
      // copy of its clip planes, frozen where the cut was, and the cockpit disposes it and repaints these when you leave
      const clipped = !!material.clippingPlanes?.length,
        m = clipped || view.materials.has(material) ? material : material.clone();
      m.color.set(color).convertSRGBToLinear();
      if (!clipped) view.materials.add(m);
      return m;
    };
    body?.traverse(node => {
      if (!(node instanceof THREE.Mesh) || (node !== body && !node.name.startsWith(BODY_NODE + '_'))) return;
      node.material = Array.isArray(node.material) ? node.material.map(recolor) : recolor(node.material);
    });
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
      lamps: [],
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
        // a car for sale on Skroten's lot always shows its model, outside the cap: it's what you're asked to pay for, and the
        // lot's cars would fill the cap between them and leave the car you came in as a box
        view.selected =
          view.status !== 'failed' &&
          view.distance < DETAIL_RANGE_M &&
          (!!view.car.saleKr || count++ < (this.coarse ? DETAIL_CAP_COARSE : DETAIL_CAP_DESKTOP));
        if (view.selected) this.loadModel(view);
        this.updateVisibility(view);
      }
    }
    for (const view of this.views) {
      for (const beacon of view.beacons)
        beacon.emissiveIntensity = view.selected && Math.floor(this.time / 0.22) % 2 ? 1.8 : 0;
      if (this.lampsOf && view.lamps.length && view.root?.visible) this.light(view, this.lampsOf(view.car));
    }
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
          lamps: Object.fromEntries(view.lamps.map(l => [l.group, l.look])) as Partial<Record<LampGroup, LampLook>>,
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
