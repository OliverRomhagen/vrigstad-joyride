import { describe, expect, it } from 'vitest';
import {
  aimShot,
  assistYaw,
  GRAVITY_MS2,
  landing,
  MUZZLE_M,
  newHit,
  type Shot,
  type ShotWorld,
  stepShot,
  WEAPONS,
} from '../../../../src/game/sim/shots';

const PICKADOLL = WEAPONS.findIndex(w => w.id === 'pickadoll');
const T = { lengthM: 4.6, widthM: 1.8 };

// flat ground at 0, and one house: everything north of z = -20 between x = -5 and 5
function world(over: Partial<ShotWorld> = {}): ShotWorld {
  return {
    groundAt: () => 0,
    collide: (o, r) => {
      if (o.z > -20 + r || Math.abs(o.x) > 5) return false;
      o.z = -20 + r; // pushed back out of the south wall, as BuildingIndex.collide does
      return true;
    },
    people: [],
    cars: [],
    ...over,
  };
}

// a shot fired north from the origin, level, with no spread
function shot(weapon = PICKADOLL): Shot {
  return { x: 0, y: MUZZLE_M, z: 0, ...aimShot(WEAPONS[weapon], 0, 0), ageS: 0, weapon };
}

function fly(s: Shot, w: ShotWorld) {
  const out = newHit();
  for (let i = 0; i < 600; i++) {
    const hit = stepShot(s, 1 / 60, w, out);
    if (hit) return hit;
  }
  throw new Error('still flying after 10 s');
}

describe('aimShot', () => {
  it('fires north at yaw 0 and east at a quarter turn, at the muzzle speed', () => {
    const w = WEAPONS[PICKADOLL];
    expect(aimShot(w, 0, 0)).toEqual({ vx: 0, vy: 0, vz: -w.speedMs });
    const east = aimShot(w, Math.PI / 2, 0);
    expect(east.vx).toBeCloseTo(w.speedMs);
    expect(east.vz).toBeCloseTo(0);
  });

  it('turns by the spread times what it is given', () => {
    const w = WEAPONS[PICKADOLL],
      v = aimShot(w, 0, 0, 1, 0);
    expect(Math.atan2(v.vx, -v.vz)).toBeCloseTo(w.spreadRad);
  });
});

describe('stepShot', () => {
  it('drops to the ground where gravity puts it', () => {
    const s = shot(),
      hit = fly(s, world({ collide: () => false }));
    expect(hit).toMatchObject({ kind: 'ground', y: 0, ny: 1 });
    // level from MUZZLE_M: it falls for sqrt(2 h / g) seconds
    const fallS = Math.sqrt((2 * MUZZLE_M) / GRAVITY_MS2);
    expect(-s.z).toBeCloseTo(WEAPONS[PICKADOLL].speedMs * fallS, 0);
    if (hit !== 'gone') expect(-hit.z).toBeCloseTo(WEAPONS[PICKADOLL].speedMs * fallS, 0);
  });

  it('hits the wall of a house, and says which way the wall faces', () => {
    const hit = fly(shot(), world());
    expect(hit).toMatchObject({ kind: 'wall', nx: 0, nz: 1 }); // the south wall faces south
    if (hit !== 'gone') expect(hit.z).toBeCloseTo(-20); // on the wall's face, not where the shot was noticed inside it
  });

  it('hits a person in the way, not the house behind them', () => {
    const hit = fly(shot(), world({ people: [{ x: 0.1, z: -10, scale: 1 }] }));
    expect(hit).toMatchObject({ kind: 'person', target: 0 });
  });

  it('passes someone who is down, and someone beside the line', () => {
    const people = [
      { x: 0, z: -8, scale: 1, down: true },
      { x: 1.2, z: -10, scale: 1 },
    ];
    expect(fly(shot(), world({ people }))).toMatchObject({ kind: 'wall' });
  });

  it('hits a car across its path on its near side', () => {
    // a car at z = -10 pointing east: its body is 0.9 m either side of its spine
    const hit = fly(shot(), world({ cars: [{ x: 0, z: -10, h: Math.PI / 2, T }] }));
    expect(hit).toMatchObject({ kind: 'car', target: 0 });
    if (hit !== 'gone') {
      expect(hit.z).toBeCloseTo(-10 + T.widthM / 2); // on the body's side
      expect(hit.nz).toBeCloseTo(1); // the side that faces the shooter
    }
  });

  it('is gone when it has hit nothing within its range', () => {
    const s: Shot = { x: 0, y: 500, z: 0, vx: 0, vy: 0, vz: -1, ageS: 0, weapon: PICKADOLL };
    expect(fly(s, world({ collide: () => false }))).toBe('gone');
  });

  it('does not skip through a person on a slow frame', () => {
    const s = shot(),
      hit = stepShot(s, 0.25, world({ people: [{ x: 0, z: -9, scale: 1 }] }), newHit());
    expect(hit).toMatchObject({ kind: 'person' });
  });
});

describe('the weapons', () => {
  it('has a minigun that fires for as long as the trigger is held', () => {
    expect(WEAPONS.find(w => w.id === 'minigun')).toMatchObject({ auto: true });
  });
});

describe('landing', () => {
  it('is where a shot with no spread lands', () => {
    const w = world(),
      mark = landing(PICKADOLL, 0, 0, 0, 0, w, newHit());
    expect(mark).toMatchObject({ kind: 'wall' });
    expect(mark!.z).toBeCloseTo((fly(shot(), w) as { z: number }).z, 0);
  });
});

describe('assistYaw', () => {
  const people = [
    { x: 2, z: -20, scale: 1 }, // a little right of north
    { x: -20, z: 0, scale: 1 }, // due west
  ];

  it('turns to the nearest target inside the cone', () => {
    expect(assistYaw(0, 0, 0, { people, cars: [] }, 0.3, 45)).toBeCloseTo(Math.atan2(2, 20));
  });

  it('keeps the heading when nobody is inside the cone or the range', () => {
    expect(assistYaw(0, 0, Math.PI, { people, cars: [] }, 0.3, 45)).toBe(Math.PI);
    expect(assistYaw(0, 0, 0, { people, cars: [] }, 0.3, 10)).toBe(0);
  });
});
