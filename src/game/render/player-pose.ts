// The player's pose: the arms and legs while walking, jumping or playing an emote (#296). Rendering only: reads the
// walk phase or the emote and its time, writes the limbs, and says how the loop should lift, lean and turn the body.
// Angles are radians. An arm or leg turned +x swings forward; the right arm turned +z (the left −z) swings out to the side.
import * as THREE from 'three';
import type { EmoteId } from '../emotes';
import { boxGeo, type Person, paintMat } from './models';

/** How the loop places the body: `lift` (m) on top of the jump, `lean` forward (−) or back (+), `twist` added to the heading. */
interface BodyPlacement {
  lift: number;
  lean: number;
  twist: number;
}
const _at: BodyPlacement = { lift: 0, lean: 0, twist: 0 }; // returned every frame: no allocation
const SKIN = '#e2b796'; // personParts' skin colour
const TAU = Math.PI * 2;

export class PlayerPose {
  private readonly m: Person;
  private readonly finger: THREE.Mesh; // a fist with the middle finger up, on the right hand: only for the finger

  constructor(m: Person) {
    this.m = m;
    this.finger = new THREE.Mesh(
      boxGeo([
        [0.13, 0.12, 0.13, 0, -0.66, 0, SKIN],
        [0.05, 0.16, 0.05, 0, -0.8, 0, SKIN],
      ]),
      paintMat,
    );
    this.finger.visible = false;
    m.arms![1].add(this.finger);
  }

  /** Walking: arms swing against the legs and the body bobs. In the air: legs apart and both arms up. */
  walk(phase: number, air: boolean) {
    const sw = air ? 0.5 : Math.sin(phase) * 0.75;
    this.limbs(sw, -sw, air ? 2.4 : -sw * 0.8, 0, air ? 2.4 : sw * 0.8, 0);
    this.finger.visible = false;
    return this.body(air ? 0 : Math.abs(Math.sin(phase)) * 0.05, 0, 0);
  }

  /** `t` s into the emote. Loops repeat on their own beat; the others ease in and out over their length in EMOTES. */
  emote(id: EmoteId, t: number) {
    this.finger.visible = id === 'finger';
    const ease = Math.min(1, t / 0.25);
    switch (id) {
      case 'dance': {
        const s = Math.sin(TAU * 2 * t); // two beats a second
        this.limbs(0.25 * s, -0.25 * s, 2.5 + 0.5 * s, -0.35, 2.5 - 0.5 * s, 0.35);
        return this.body(0.06 * Math.abs(s), 0, 0.35 * Math.cos(TAU * t));
      }
      case 'kiss': {
        const out = Math.min(1, Math.max(0, (t - 0.5) / 0.3)); // the hand at the mouth, then thrown forward
        this.limbs(0, 0, 0, 0, ease * (2.6 - out), -0.5 + 0.7 * out);
        return this.body(0, -0.1 * out, 0);
      }
      case 'finger': {
        this.limbs(0, 0, -0.2, -0.4 * ease, ease * (2.5 + 0.1 * Math.sin(8 * t)), 0); // up and forward, so the finger points up
        return this.body(0, 0.08 * ease, 0);
      }
      case 'twerk': {
        // leaning forward from the feet with the legs turned back near upright; the hips then sit 0.1 m low, so lift them
        const s = Math.sin(TAU * 3 * t);
        this.limbs(0.55 + 0.1 * s, 0.55 - 0.1 * s, 0.9, -0.1, 0.9, 0.1);
        return this.body(0.1 + 0.04 * Math.abs(s), -0.5, 0.15 * s);
      }
      case 'wave': {
        this.limbs(0, 0, 0, 0, 0, ease * (2.7 + 0.35 * Math.sin(10 * t)));
        return this.body(0, 0, 0);
      }
      case 'shrug': {
        const b = Math.sin((Math.PI * t) / 1.2); // up and down again over its 1.2 s
        this.limbs(0, 0, 0.5 * b, -0.6 * b, 0.5 * b, 0.6 * b);
        return this.body(0.03 * b, 0, 0);
      }
      case 'grodorna': {
        // the midsummer frog hop: hands up as ears, then behind as a tail ("inga öron, inga svansar har de")
        const ears = t % 2.4 < 1.2,
          flap = 0.2 * Math.sin(12 * t);
        if (ears) this.limbs(0, 0, 0, -2.9 + flap, 0, 2.9 - flap);
        else this.limbs(0, 0, -0.7, -0.2 + flap, -0.7, 0.2 - flap);
        this.m.legs[0].rotation.z = -0.25;
        this.m.legs[1].rotation.z = 0.25;
        return this.body(0.22 * Math.abs(Math.sin(TAU * t)), -0.15, 0);
      }
      case 'sit': {
        // on the ground: legs out in front, the hips down at 0.1 m, leaning back on the hands
        const e = Math.min(1, t / 0.4);
        this.limbs(1.5 * e, 1.5 * e, -0.5 * e, -0.2 * e, -0.5 * e, 0.2 * e);
        return this.body(-0.7 * e, 0.1 * e, 0);
      }
    }
  }

  private limbs(legL: number, legR: number, armLX: number, armLZ: number, armRX: number, armRZ: number) {
    const { legs, arms } = this.m;
    legs[0].rotation.set(legL, 0, 0);
    legs[1].rotation.set(legR, 0, 0);
    arms![0].rotation.set(armLX, 0, armLZ);
    arms![1].rotation.set(armRX, 0, armRZ);
  }

  private body(lift: number, lean: number, twist: number) {
    _at.lift = lift;
    _at.lean = lean;
    _at.twist = twist;
    return _at;
  }
}
