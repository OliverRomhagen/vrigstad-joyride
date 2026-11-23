import { describe, expect, it } from 'vitest';
import { blankSnapshot, COAST_MS, type Snapshot, SnapshotBuffer } from '../../../../src/game/net/snapshots';

const at = (t: number, over: Partial<Snapshot> = {}): Snapshot => ({ ...blankSnapshot(), t, ...over });
const volvo = { id: 'p3', since: 0, dmg: 0, look: { type: 'volvo', model: null, color: '#b3261e' } } as const;

describe('SnapshotBuffer', () => {
  it('has nothing to show before the first snapshot', () => {
    expect(new SnapshotBuffer().sample(100, blankSnapshot())).toBe(false);
  });

  it('is halfway between two snapshots at the time halfway between them', () => {
    const buffer = new SnapshotBuffer(),
      out = blankSnapshot();
    buffer.push(at(1000, { x: 0, z: 10 }));
    buffer.push(at(1100, { x: 4, z: 20 }));
    expect(buffer.sample(1050, out)).toBe(true);
    expect(out.x).toBeCloseTo(2);
    expect(out.z).toBeCloseTo(15);
  });

  it('turns the short way round across north', () => {
    const buffer = new SnapshotBuffer(),
      out = blankSnapshot();
    buffer.push(at(0, { h: Math.PI - 0.1 }));
    buffer.push(at(100, { h: -Math.PI + 0.1 }));
    buffer.sample(50, out);
    expect(Math.abs(out.h)).toBeCloseTo(Math.PI);
  });

  it('coasts along the line of travel after the newest snapshot, then stands still', () => {
    const buffer = new SnapshotBuffer(),
      out = blankSnapshot();
    buffer.push(at(1000, { v: 10, vh: Math.PI / 2 })); // 10 m/s east
    buffer.sample(1100, out);
    expect(out.x).toBeCloseTo(1);
    expect(out.z).toBeCloseTo(0);
    buffer.sample(1000 + COAST_MS + 5000, out);
    expect(out.x).toBeCloseTo((10 * COAST_MS) / 1000);
  });

  it('drops a snapshot that arrives after a newer one', () => {
    const buffer = new SnapshotBuffer(),
      out = blankSnapshot();
    buffer.push(at(200, { x: 2 }));
    buffer.push(at(100, { x: 99 }));
    buffer.sample(150, out);
    expect(out.x).toBe(2);
    expect(buffer.newest).toBe(200);
  });

  it('does not blend a walk into a car: it stays on foot until the snapshot in the car', () => {
    const buffer = new SnapshotBuffer(),
      out = blankSnapshot();
    buffer.push(at(0, { x: 0 }));
    buffer.push(at(100, { x: 6, car: volvo }));
    buffer.sample(50, out);
    expect(out.car).toBeNull();
    expect(out.x).toBe(0);
    buffer.sample(100, out);
    expect(out.car).toEqual(volvo);
    expect(out.x).toBe(6);
  });
});
