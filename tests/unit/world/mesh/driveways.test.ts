import { describe, expect, it } from 'vitest';
import { DrivewaySurfaces } from '../../../../src/world/mesh/driveways';
import type { Plot } from '../../../../src/world/plots';

// a plot from z = 5 (its front, past the sidewalk) to 40, and a driveway from the carriageway's edge at z = 2.75 to 15
const plot: Plot = {
  key: 'p0',
  ri: 0,
  side: 1,
  outline: [0, 5, 20, 5, 20, 40, 0, 40],
  house: [5, 10, 15, 10, 15, 20, 5, 20],
  driveway: { p: [3, 2.75, 3, 15], widthM: 3.2, source: 'inferred' },
};

describe('DrivewaySurfaces', () => {
  it('lays the driveway on the ground from where it enters its plot, face up, its width wide', () => {
    const draw = new DrivewaySurfaces([plot], { groundAt: (_x, z) => z / 10, surfaceOf: () => 'gravel' });
    expect(draw.meshes).toHaveLength(1);
    const geometry = draw.meshes[0].geometry;
    const position = geometry.getAttribute('position');
    const zs = Array.from({ length: position.count }, (_, i) => position.getZ(i));
    const xs = Array.from({ length: position.count }, (_, i) => position.getX(i));
    expect(Math.min(...zs)).toBeCloseTo(5, 0); // not over the sidewalk, which runs on across it
    expect(Math.max(...zs)).toBeCloseTo(15, 6);
    expect(Math.min(...xs)).toBeCloseTo(3 - 1.6, 6);
    expect(Math.max(...xs)).toBeCloseTo(3 + 1.6, 6);
    for (let i = 0; i < position.count; i++) expect(position.getY(i)).toBeCloseTo(position.getZ(i) / 10 + 0.03, 6);
    const normal = geometry.getAttribute('normal');
    for (let i = 0; i < normal.count; i++) expect(normal.getY(i)).toBeGreaterThan(0.9);
    expect(draw.triangles).toBe(position.count / 3);
    draw.dispose();
  });

  it('follows a mapped driveway round its bend without a flat triangle at the bend', () => {
    const bent = { ...plot, driveway: { p: [3, 2.75, 3, 12, 8, 16], widthM: 3, source: 'mapped' as const } };
    const draw = new DrivewaySurfaces([bent], { groundAt: () => 0, surfaceOf: () => 'asphalt' });
    const normal = draw.meshes[0].geometry.getAttribute('normal');
    for (let i = 0; i < normal.count; i++) expect(normal.getY(i)).toBeGreaterThan(0.9);
    draw.dispose();
  });

  it('lays none for a plot without a driveway', () => {
    const draw = new DrivewaySurfaces([{ ...plot, driveway: null }], { groundAt: () => 0, surfaceOf: () => 'asphalt' });
    expect(draw.meshes).toEqual([]);
    draw.dispose();
  });
});
