// Multiplayer prototype (lab: multiplayer, docs/multiplayer.md): the other players, drawn where their snapshots say.
// Each is a person on foot, or the car they drive. The cars here are meshes only: they are not in the Fleet, so
// nothing collides with them and nobody can get in.
import type { CarLook, Snapshot } from '../net/snapshots';
import type { RenderedCar } from './car-meshes';
import type { Person } from './models';

/** What the remote players' meshes read from the rest of the game. */
export interface RemotePlayersDeps {
  scene: { add(o: Person): unknown; remove(o: Person): unknown };
  groundAt(x: number, z: number): number;
  makePerson(): Person;
  /** a car with its meshes, in the scene but in no list */
  makeCar(look: CarLook): RenderedCar;
  placeCar(c: RenderedCar): void;
  disposeCar(c: RenderedCar): void;
}

interface Remote {
  person: Person;
  car: RenderedCar | null;
  look: CarLook | null; // what `car` was built from
}

const sameLook = (a: CarLook | null, b: CarLook | null) =>
  a === b || (!!a && !!b && a.type === b.type && a.model === b.model && a.color === b.color);

/** Owns the meshes of every remote player. */
export class RemotePlayers {
  private readonly g: RemotePlayersDeps;
  private readonly remotes = new Map<string, Remote>();

  constructor(g: RemotePlayersDeps) {
    this.g = g;
  }

  /** Draws the player `id` at `s`, making their meshes the first time and when they change cars. */
  show(id: string, s: Snapshot) {
    const { g } = this;
    let r = this.remotes.get(id);
    if (!r) {
      r = { person: g.makePerson(), car: null, look: null };
      g.scene.add(r.person);
      this.remotes.set(id, r);
    }
    if (!sameLook(r.look, s.car)) {
      if (r.car) g.disposeCar(r.car);
      r.look = s.car && { ...s.car };
      r.car = s.car && g.makeCar(s.car);
    }
    const { person, car } = r;
    person.visible = !car && !s.hidden;
    if (car) {
      car.x = s.x;
      car.z = s.z;
      car.h = s.h;
      car.vh = s.vh;
      car.v = s.v; // the wheels turn by it
      g.placeCar(car);
    } else if (person.visible) {
      const air = s.y > 0,
        swing = air ? 0.5 : Math.sin(s.phase) * 0.75;
      person.legs[0].rotation.x = swing;
      person.legs[1].rotation.x = -swing;
      person.blob.position.y = 0.06 - s.y; // the blob shadow stays on the ground
      person.position.set(s.x, g.groundAt(s.x, s.z) + s.y, s.z);
      person.rotation.y = -s.h;
    }
  }

  /** Takes a player who left out of the scene. */
  remove(id: string) {
    const r = this.remotes.get(id);
    if (!r) return;
    this.remotes.delete(id);
    this.g.scene.remove(r.person);
    if (r.car) this.g.disposeCar(r.car);
  }
}
