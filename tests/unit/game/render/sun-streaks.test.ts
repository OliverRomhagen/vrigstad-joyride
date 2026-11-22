import * as THREE from 'three';
import { describe, expect, it } from 'vitest';
import { type SunSource, SunStreaks, sunSource } from '../../../../src/game/render/sun-streaks';

const TAN_V = Math.tan(THREE.MathUtils.degToRad(58) / 2); // the game camera's vertical field of view
const at = (yawDeg: number, pitchDeg: number): SunSource => {
  // the sun's direction in camera axes, `yaw` to the right of and `pitch` above the view axis
  const y = THREE.MathUtils.degToRad(yawDeg),
    p = THREE.MathUtils.degToRad(pitchDeg);
  return sunSource(Math.sin(y) * Math.cos(p), Math.sin(p), Math.cos(y) * Math.cos(p), TAN_V, {
    x: 0,
    y: 0,
    presence: 0,
    glare: 0,
  });
};

describe('sunSource', () => {
  it('is the exact perspective projection in frame, so the streaks leave from the disc', () => {
    const s = at(10, 20);
    const cam = new THREE.PerspectiveCamera(58, 16 / 9, 1, 100);
    cam.updateMatrixWorld();
    const y = THREE.MathUtils.degToRad(10),
      p = THREE.MathUtils.degToRad(20);
    const ndc = new THREE.Vector3(Math.sin(y) * Math.cos(p), Math.sin(p), -Math.cos(y) * Math.cos(p))
      .multiplyScalar(50)
      .project(cam);
    expect(s.y).toBeCloseTo(ndc.y / 2, 6);
    expect(s.x).toBeCloseTo((ndc.x * cam.aspect) / 2, 6);
    expect(s.glare).toBeGreaterThan(0.9);
    expect(s.presence).toBe(1);
  });

  it('keeps going past the top edge instead of clamping, and keeps streaks when the sun is well above the frame', () => {
    const edge = at(0, 29),
      above = at(0, 45),
      high = at(0, 65);
    expect(edge.y).toBeCloseTo(0.5, 2);
    expect(above.y).toBeGreaterThan(0.5);
    expect(high.y).toBeGreaterThan(above.y);
    expect(high.presence).toBeGreaterThan(0.9); // ordinary driving: the camera looks down, the summer sun is high
    expect(high.glare).toBeLessThan(0.1);
  });

  it('is continuous and finite for every direction, across the edges and round behind the camera', () => {
    for (const pitch of [-10, 0, 15, 40, 70]) {
      let prev = at(-180, pitch);
      for (let yaw = -179.5; yaw <= 180; yaw += 0.5) {
        const s = at(yaw, pitch);
        for (const k of ['x', 'y', 'presence', 'glare'] as const) {
          expect(Number.isFinite(s[k])).toBe(true);
          expect(Math.abs(s[k] - prev[k])).toBeLessThan(0.12);
        }
        prev = s;
      }
    }
  });

  it('stays on the sun’s side behind the camera, never mirrored, and fades out there', () => {
    const behindLeft = at(-150, 30),
      behindAbove = at(180, 60);
    expect(behindLeft.x).toBeLessThan(0);
    expect(behindLeft.y).toBeGreaterThan(0);
    expect(behindAbove.y).toBeGreaterThan(0.5);
    expect(at(180, 0).presence).toBe(0);
    expect(behindLeft.presence).toBeLessThan(0.05);
  });

  it('weakens presence and glare smoothly as the camera turns away', () => {
    let lastP = 2,
      lastG = 2;
    for (let yaw = 0; yaw <= 180; yaw += 5) {
      const s = at(yaw, 20);
      expect(s.presence).toBeLessThanOrEqual(lastP);
      expect(s.glare).toBeLessThanOrEqual(lastG);
      lastP = s.presence;
      lastG = s.glare;
    }
    expect(at(90, 20).presence).toBeGreaterThan(0.2); // beside the camera: still perceptible
    expect(at(90, 20).glare).toBe(0);
  });
});

describe('SunStreaks', () => {
  const make = (sunDir = new THREE.Vector3(0, 0.5, -1).normalize()) => {
    const cam = new THREE.PerspectiveCamera(58, 16 / 9, 0.8, 4200);
    cam.position.set(10, 5, 20);
    return { cam, streaks: new SunStreaks({ sunDir }), sunDir };
  };
  const white = new THREE.Color(1, 1, 1);

  it('puts the disc along the shared sun direction from the camera, never at a screen edge', () => {
    const { cam, streaks, sunDir } = make();
    cam.lookAt(10, 5, 50); // facing away from the sun
    streaks.update(cam, 1, 0, white);
    const disc = streaks.object.children.find(o => o instanceof THREE.Sprite) as THREE.Sprite;
    const toDisc = disc.position.clone().sub(cam.position).normalize();
    expect(toDisc.dot(sunDir)).toBeCloseTo(1, 6);
    sunDir.set(1, 1, 0).normalize(); // the day cycle moves the sun: the shared vector moves the disc too
    streaks.update(cam, 1, 0, white);
    expect(disc.position.clone().sub(cam.position).normalize().dot(sunDir)).toBeCloseTo(1, 6);
  });

  it('fades everything out with no direct sunlight, as midway through the night skip', () => {
    const { cam, streaks } = make();
    cam.lookAt(10, 7, -20);
    streaks.update(cam, 1, 0, white);
    expect(streaks.state()).toMatchObject({ streaks: true, disc: true, light: 1 });
    streaks.update(cam, 0.1, 0, white);
    const dim = streaks.state();
    expect(dim.light).toBeGreaterThan(0);
    expect(dim.light).toBeLessThan(1);
    streaks.update(cam, 0, 0, white);
    expect(streaks.state()).toMatchObject({ streaks: false, disc: false, light: 0 });
  });

  it('hides the disc and the streaks behind a cloud, which depth can’t, and dims them under a partial one', () => {
    const { cam, streaks } = make();
    cam.lookAt(10, 7, -20);
    const strength = () => {
      const u = (
        streaks.object.children.find(o => o instanceof THREE.Mesh) as THREE.Mesh<
          THREE.PlaneGeometry,
          THREE.ShaderMaterial
        >
      ).material.uniforms;
      return u.presence.value + u.glare.value;
    };
    streaks.update(cam, 1, 0, white);
    const clear = strength();
    streaks.update(cam, 0.79, 0.5, white); // half covered under ?clouds=partly
    expect(strength()).toBeLessThan(clear * 0.4);
    expect(streaks.state()).toMatchObject({ disc: true, streaks: true });
    streaks.update(cam, 0.58, 1, white); // a cloud fully over the sun under ?clouds=mostly
    expect(streaks.state()).toMatchObject({ disc: false, streaks: false });
  });

  it('keeps the rays faint under a high sun and lets them grow as it sinks', () => {
    const sunDir = new THREE.Vector3();
    const streaks = new SunStreaks({ sunDir });
    const presence = (elevationDeg: number) => {
      const e = THREE.MathUtils.degToRad(elevationDeg);
      sunDir.set(0, Math.sin(e), -Math.cos(e));
      const cam = new THREE.PerspectiveCamera(58, 16 / 9, 0.8, 4200);
      cam.lookAt(0, -0.35, -1); // the chase camera's pitch, facing the sun's azimuth
      streaks.update(cam, 1, 0, white);
      return (
        streaks.object.children.find(o => o instanceof THREE.Mesh) as THREE.Mesh<
          THREE.PlaneGeometry,
          THREE.ShaderMaterial
        >
      ).material.uniforms.presence.value;
    };
    const midday = presence(55),
      afternoon = presence(30),
      evening = presence(12);
    expect(midday).toBeGreaterThan(0); // off-screen sunlight is still there, just faint
    expect(midday).toBeLessThan(evening * 0.35);
    expect(afternoon).toBeGreaterThan(midday);
    expect(evening).toBeGreaterThan(afternoon);
    // the game's own late afternoon (day-cycle.ts: 17:00 is about 35°) already shows them at half strength or more
    expect(presence(35)).toBeGreaterThan(evening * 0.45);
  });

  it('follows the camera’s aspect after a resize, with no resize call, and frees its GPU resources', () => {
    const { cam } = make();
    const streaks = new SunStreaks({ sunDir: new THREE.Vector3(0, 1, 0) });
    const quad = streaks.object.children.find(o => o instanceof THREE.Mesh) as THREE.Mesh<
      THREE.PlaneGeometry,
      THREE.ShaderMaterial
    >;
    cam.aspect = 0.5;
    streaks.update(cam, 1, 0, white);
    expect(quad.material.uniforms.aspect.value).toBe(0.5);
    const scene = new THREE.Scene();
    scene.add(streaks.object);
    let freed = 0;
    quad.geometry.addEventListener('dispose', () => freed++);
    quad.material.addEventListener('dispose', () => freed++);
    streaks.dispose();
    expect(freed).toBe(2);
    expect(scene.children).not.toContain(streaks.object);
  });
});
