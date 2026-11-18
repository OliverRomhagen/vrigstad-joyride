import { describe, expect, it } from 'vitest';
import { approach, HANDLING, handlingFor, rearPivotShift, yawRate } from '../../../../src/game/sim/handling';

describe('handlingFor', () => {
  it('uses the type and lets a model bring its own wheelbase', () => {
    expect(handlingFor('traktor')).toBe(HANDLING.traktor);
    expect(handlingFor('volvo', 3.02)).toEqual({ ...HANDLING.volvo, wheelbaseM: 3.02 });
    expect(handlingFor('ufo')).toBe(HANDLING.volvo);
  });
  it('makes the tractor slower to answer than the police car', () => {
    expect(HANDLING.traktor.steerResponseS).toBeGreaterThan(HANDLING.polis.steerResponseS);
    expect(HANDLING.traktor.throttleResponseS).toBeGreaterThan(HANDLING.polis.throttleResponseS);
  });
});

describe('yawRate', () => {
  it('is the bicycle model: v / L · tan(lock)', () => {
    // at 11 m/s the lock has halved: 0.6 rad · 1 / 2
    expect(yawRate(11, 1, 2.75)).toBeCloseTo((11 / 2.75) * Math.tan(0.3), 10);
  });
  it('turns a longer car wider at the same speed and stick', () => {
    expect(Math.abs(yawRate(10, 1, 3.02))).toBeLessThan(Math.abs(yawRate(10, 1, 2.36)));
  });
  it('is zero standing still and flips with reversing', () => {
    expect(yawRate(0, 1, 2.6)).toBe(0);
    expect(yawRate(-5, 1, 2.6)).toBeCloseTo(-yawRate(5, 1, 2.6), 10);
  });
});

describe('approach', () => {
  it('covers 1 − 1/e of the gap in one time constant, whatever the step size', () => {
    let a = 0,
      b = 0;
    for (let i = 0; i < 10; i++) a = approach(a, 1, 0.2, 0.02);
    for (let i = 0; i < 4; i++) b = approach(b, 1, 0.2, 0.05);
    expect(a).toBeCloseTo(1 - Math.exp(-1), 10);
    expect(b).toBeCloseTo(a, 10);
  });
  it('jumps straight to the target with no lag', () => {
    expect(approach(0, 1, 0, 0.016)).toBe(1);
  });
});

describe('rearPivotShift', () => {
  it('keeps the rear axle where it was', () => {
    const L = 2.6,
      h0 = 0.4,
      h1 = 0.55;
    const p = rearPivotShift(h0, h1, L);
    // rear axle = centre − forward · L/2, forward = (sin h, −cos h)
    const rear0 = { x: -Math.sin(h0) * (L / 2), z: Math.cos(h0) * (L / 2) };
    const rear1 = { x: p.dx - Math.sin(h1) * (L / 2), z: p.dz + Math.cos(h1) * (L / 2) };
    expect(rear1.x).toBeCloseTo(rear0.x, 10);
    expect(rear1.z).toBeCloseTo(rear0.z, 10);
  });
  it('moves the centre into a right turn when facing north', () => {
    expect(rearPivotShift(0, 0.1, 2.6).dx).toBeGreaterThan(0);
    expect(rearPivotShift(0.3, 0.3, 2.6)).toEqual({ dx: 0, dz: -0 });
  });
});
