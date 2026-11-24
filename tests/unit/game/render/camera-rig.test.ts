import * as THREE from 'three';
import { describe, expect, it } from 'vitest';
import { CameraRig } from '../../../../src/game/render/camera-rig';
import type { Sky } from '../../../../src/game/render/sky';
import { newGameState, newViewState } from '../../../../src/game/state';

// a rig on flat ground at height 0, following you on foot; `camY` is where the camera stands after a frame
function rig(calm = true) {
  const camera = new THREE.PerspectiveCamera();
  const r = new CameraRig({
    camera,
    sun: new THREE.DirectionalLight(),
    skyDome: { update() {}, sunFactor: 1 } as unknown as Sky,
    game: { ...newGameState(), started: true },
    view: newViewState(0, 0.3),
    dragging: false,
    inside: false,
    groundAt: () => 0,
    heightAt: () => 0,
    rnd: () => 0.5,
    calmMotion: { matches: calm },
    sunIntensity: 1,
  });
  return { r, camY: () => camera.position.y };
}

const DT = 1 / 60;

describe('CameraRig', () => {
  it('eases up to what you stand on, rather than jumping up in one frame (#451)', () => {
    const { r, camY } = rig(),
      you = { x: 0, z: 0, floor: 0 };
    r.update(you, 0, DT);
    const ground = camY();
    you.floor = 1.54; // up on a car's roof
    r.update(you, 0, DT);
    expect(camY() - ground).toBeGreaterThan(0);
    expect(camY() - ground).toBeLessThan(0.2); // not the whole 1.54 m at once
    for (let t = 0; t < 1; t += DT) r.update(you, 0, DT);
    expect(camY() - ground).toBeCloseTo(1.54, 1);
  });

  it('eases back down when you step off, the same at any frame rate', () => {
    for (const dt of [1 / 30, 1 / 144]) {
      const { r, camY } = rig(),
        you = { x: 0, z: 0, floor: 1.54 };
      for (let t = 0; t < 2; t += dt) r.update(you, 0, dt);
      const up = camY();
      you.floor = 0;
      for (let t = 0; t < 0.2; t += dt) r.update(you, 0, dt);
      expect(up - camY()).toBeGreaterThan(0.4); // well on its way down after 0.2 s
      expect(up - camY()).toBeLessThan(1.2); // but not there yet
    }
  });

  it('lifts with a share of a hop, and none for players who prefer less motion', () => {
    const hopPeak = (calm: boolean) => {
      const { r, camY } = rig(calm),
        you = { x: 0, z: 0, floor: 0, y: 0 };
      r.update(you, 0, DT);
      const ground = camY();
      let most = 0;
      for (let t = 0; t < 0.65; t += DT) {
        you.y = 5.2 * t - 8 * t * t; // a hop: 0.85 m high, 0.65 s long
        r.update(you, 0, DT);
        most = Math.max(most, camY() - ground);
      }
      return most;
    };
    const lift = hopPeak(false);
    expect(lift).toBeGreaterThan(0.05);
    expect(lift).toBeLessThan(0.3 * 0.85); // a share of the 0.85 m hop, eased, so less than the share itself
    expect(hopPeak(true)).toBe(0);
  });
});
