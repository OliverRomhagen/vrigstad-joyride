// The driver of a car you steal gets out, and stands there shouting for a while, turned towards you.
// Moved from src/game/main.ts (#177); main.ts passes in the scene, the ground and the people's model.
import type * as THREE from 'three';

type Point = { x: number; z: number };
const SHIRTS = ['#b5463a', '#3f6b8a', '#5c7a4a', '#7a5a8a'];
const SHOUT_S = 14; // how long a driver stays (s)

/** What the drivers read from the rest of the game. */
export interface ShoutingDriverDeps {
  scene: THREE.Scene;
  groundAt(x: number, z: number): number;
  personParts(shirt: string, pants: string): THREE.Object3D;
  pick<T>(a: readonly T[]): T; // the game's rnd(), so the shirt rolls where it always did
}

/** Drivers out of their cars; `update` turns them towards you and takes them away after a while. */
export class ShoutingDrivers {
  private readonly g: ShoutingDriverDeps;
  private readonly peds: (THREE.Object3D & { ttl: number })[] = [];

  constructor(g: ShoutingDriverDeps) {
    this.g = g;
  }

  driverOut = (c: Point & { h: number }) => {
    const { scene, groundAt, personParts, pick } = this.g;
    const p = Object.assign(personParts(pick(SHIRTS), '#3a3a3a'), { ttl: SHOUT_S });
    p.position.set(c.x - Math.cos(c.h) * 2.2, 0, c.z - Math.sin(c.h) * 2.2);
    p.position.y = groundAt(p.position.x, p.position.z);
    scene.add(p);
    this.peds.push(p);
  };

  update(T: Point, dt: number) {
    const { peds } = this;
    for (let i = peds.length - 1; i >= 0; i--) {
      const p = peds[i];
      p.ttl -= dt;
      p.rotation.y = -Math.atan2(T.x - p.position.x, -(T.z - p.position.z));
      if (p.ttl <= 0) {
        this.g.scene.remove(p);
        peds.splice(i, 1);
      }
    }
  }
}
