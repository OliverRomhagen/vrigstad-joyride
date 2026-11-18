import * as THREE from 'three';
import { describe, expect, it } from 'vitest';
import { BodyMotion } from '../../../../src/game/render/body-motion';
import { suspensionFor } from '../../../../src/game/render/suspension';

const setup = () => {
  const car = { mesh: new THREE.Group(), x: 0, z: 0, h: 0, v: 0 },
    node = new THREE.Group(),
    motion = new BodyMotion();
  motion.add(car, suspensionFor('volvo'), node);
  motion.update(car, 1 / 60); // the first frame only records the pose
  return { car, node, motion };
};
const dt = 1 / 60;

describe('BodyMotion', () => {
  it('squats under throttle and tilts the sprung node', () => {
    const { car, node, motion } = setup();
    for (let i = 0; i < 20; i++) {
      car.v += 6 * dt;
      car.z -= car.v * dt;
      motion.update(car, dt);
    }
    expect(motion.state(car)!.pitch).toBeGreaterThan(0.005);
    expect(node.rotation.x).toBe(motion.state(car)!.pitch);
  });
  it('leans out of a right turn', () => {
    const { car, motion } = setup();
    car.v = 12;
    for (let i = 0; i < 30; i++) {
      car.h += 1 * dt;
      motion.update(car, dt);
    }
    expect(motion.state(car)!.roll).toBeGreaterThan(0.02);
  });
  it('rests level after a teleport, and when the camera is far away', () => {
    const { car, node, motion } = setup();
    car.v = 12;
    for (let i = 0; i < 10; i++) {
      car.h += dt;
      motion.update(car, dt);
    }
    car.x = 500;
    motion.update(car, dt);
    expect(motion.state(car)).toEqual({ roll: 0, pitch: 0, heave: 0 });
    car.h += 0.5;
    motion.update({ x: 0, z: 0 }, dt);
    expect(node.rotation.z).toBe(0);
  });
  it('tilts a node added later, and forgets removed cars', () => {
    const { car, motion } = setup();
    const late = new THREE.Group();
    motion.addNode(car, late);
    late.rotation.x = 1;
    motion.update(car, dt);
    expect(late.rotation.x).toBe(0);
    motion.remove(car);
    expect(motion.state(car)).toBeNull();
  });
});
