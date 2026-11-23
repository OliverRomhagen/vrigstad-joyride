// Multiplayer prototype (lab: multiplayer, docs/multiplayer.md): the other players on foot, drawn where their
// snapshots say. The car a player drives is a car of the village, moved by net/shared-cars.ts.
import type { Snapshot } from '../net/snapshots';
import type { Person } from './models';

/** What the remote players' meshes read from the rest of the game. */
export interface RemotePlayersDeps {
  scene: { add(o: Person): unknown; remove(o: Person): unknown };
  groundAt(x: number, z: number): number;
  makePerson(): Person;
}

/** Owns the mesh of every remote player. */
export class RemotePlayers {
  private readonly g: RemotePlayersDeps;
  private readonly remotes = new Map<string, Person>();

  constructor(g: RemotePlayersDeps) {
    this.g = g;
  }

  /** Draws the player `id` at `s`, making their mesh the first time. A player in a car or a safehouse isn't seen. */
  show(id: string, s: Snapshot) {
    const { g } = this;
    let person = this.remotes.get(id);
    if (!person) {
      person = g.makePerson();
      g.scene.add(person);
      this.remotes.set(id, person);
    }
    person.visible = !s.car && !s.hidden;
    if (!person.visible) return;
    const air = s.y > 0,
      swing = air ? 0.5 : Math.sin(s.phase) * 0.75;
    person.legs[0].rotation.x = swing;
    person.legs[1].rotation.x = -swing;
    person.blob.position.y = 0.06 - s.y; // the blob shadow stays on the ground
    person.position.set(s.x, g.groundAt(s.x, s.z) + s.y, s.z);
    person.rotation.y = -s.h;
  }

  /** Takes a player who left out of the scene. */
  remove(id: string) {
    const person = this.remotes.get(id);
    if (!person) return;
    this.remotes.delete(id);
    this.g.scene.remove(person);
  }
}
