import * as THREE from 'three';
import { describe, expect, it } from 'vitest';
import { BodyMotion } from '../../../../src/game/render/body-motion';
import { VEHICLE_SPECS } from '../../../../src/game/sim/vehicle-spec';

const setup = () => {
  const car = { mesh: new THREE.Group(), mode: 'player', x: 0, z: 0, h: 0, vh: 0, v: 0 },
    node = new THREE.Group(),
    motion = new BodyMotion();
  motion.add(car, VEHICLE_SPECS.volvo.suspension, node);
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
      car.h = car.vh += 1 * dt;
      motion.update(car, dt);
    }
    expect(motion.state(car)!.roll).toBeGreaterThan(0.02);
  });
  it('leans by the direction of travel, not the nose: a drift catch that swings only the nose is no corner', () => {
    const { car, motion } = setup();
    car.v = 12;
    for (let i = 0; i < 30; i++) {
      car.h += 1 * dt; // the nose swings, the car keeps its line
      motion.update(car, dt);
    }
    expect(motion.state(car)!.roll).toBe(0);
  });
  it('steers traffic by h, which is all advance() turns', () => {
    const { car, motion } = setup();
    car.mode = 'ai';
    car.v = 12;
    for (let i = 0; i < 30; i++) {
      car.h += 1 * dt;
      motion.update(car, dt);
    }
    expect(motion.state(car)!.roll).toBeGreaterThan(0.02);
  });
  it('takes a sudden drop into water as a reset, not a bump', () => {
    const { car, motion } = setup();
    car.mesh.position.y = -0.55;
    motion.update(car, dt);
    motion.update(car, dt);
    expect(motion.state(car)!.heave).toBe(0);
  });
  it('rests level after a teleport, and when the camera is far away', () => {
    const { car, node, motion } = setup();
    car.v = 12;
    for (let i = 0; i < 10; i++) {
      car.h = car.vh += dt;
      motion.update(car, dt);
    }
    car.x = 500;
    motion.update(car, dt);
    expect(motion.state(car)).toEqual({ roll: 0, pitch: 0, heave: 0 });
    car.h = car.vh += 0.5;
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
