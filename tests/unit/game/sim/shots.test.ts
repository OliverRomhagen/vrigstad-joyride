import { describe, expect, it } from 'vitest';
import {
  aimAt,
  aimShot,
  assistTarget,
  GRAVITY_MS2,
  MUZZLE_M,
  newHit,
  type Shot,
  type ShotWorld,
  sight,
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
  return {
    x: 0,
    y: MUZZLE_M,
    z: 0,
    ...aimShot(WEAPONS[weapon], 0, 0),
    ageS: 0,
    weapon,
    bounced: 0,
    lifeS: 0,
    lying: false,
  };
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
    const s: Shot = {
      x: 0,
      y: 500,
      z: 0,
      vx: 0,
      vy: 0,
      vz: -1,
      ageS: 0,
      weapon: PICKADOLL,
      bounced: 0,
      lifeS: 0,
      lying: false,
    };
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

describe('a shot that bounces', () => {
  const GULD = WEAPONS.findIndex(w => w.id === 'guldartpuffra');

  it('comes back off a wall the way it went in, slower, and flies on', () => {
    // aimed a little up: a level pea is on the ground before the wall, 20 m away
    const s: Shot = { ...shot(GULD), ...aimShot(WEAPONS[GULD], 0, 0.2) },
      hit = fly(s, world());
    expect(hit).toMatchObject({ kind: 'wall', bounced: true });
    expect(s.vz).toBeGreaterThan(0); // it flew north, and now south
    expect(Math.hypot(s.vx, s.vz)).toBeLessThan(WEAPONS[GULD].speedMs);
    expect(s.bounced).toBe(1);
  });

  it('stops in the end: after its bounces, or when it has lost its speed', () => {
    const s = shot(GULD),
      w = world({ collide: () => false });
    let hits = 0;
    for (let hit = fly(s, w); hit !== 'gone' && hit.bounced; hit = fly(s, w)) hits++;
    expect(hits).toBeGreaterThan(1);
    expect(hits).toBeLessThanOrEqual(WEAPONS[GULD].bounces);
  });

  it('is stopped by a person, and a pickadoll shot never bounces', () => {
    expect(fly(shot(GULD), world({ people: [{ x: 0, z: -10, scale: 1 }] }))).toMatchObject({
      kind: 'person',
      bounced: false,
    });
    expect(fly(shot(), world())).toMatchObject({ kind: 'wall', bounced: false });
  });
});

describe('a thrown shot with a fuse', () => {
  const GRANAT = WEAPONS.findIndex(w => w.id === 'granat'),
    fuseS = WEAPONS[GRANAT].fuseS;

  // steps until it goes off; says how many times it touched something before, and when it went off
  function untilBurst(s: Shot, w: ShotWorld) {
    const out = newHit();
    let touches = 0;
    for (let i = 0; i < 600; i++) {
      const hit = stepShot(s, 1 / 60, w, out);
      if (hit === 'gone') throw new Error('gone before its fuse');
      if (hit?.burst) return { touches, hit };
      if (hit) {
        expect(hit.bounced).toBe(true); // it never stops on what it touches
        touches++;
      }
    }
    throw new Error('never went off');
  }

  it('bounces, comes to rest, and goes off when the fuse runs out, on the ground', () => {
    const s = shot(GRANAT),
      { touches, hit } = untilBurst(s, world({ collide: () => false }));
    expect(touches).toBeGreaterThan(0);
    expect(s.lifeS).toBeCloseTo(fuseS, 1);
    expect(hit).toMatchObject({ kind: 'ground', y: 0, burst: true, bounced: false });
  });

  it('goes off in the air when the fuse runs out before it lands', () => {
    const s: Shot = { ...shot(GRANAT), ...aimShot(WEAPONS[GRANAT], 0, 1.3) }; // thrown nearly straight up
    const { touches, hit } = untilBurst(s, world({ collide: () => false }));
    expect(touches).toBe(0);
    expect(s.y).toBeGreaterThan(2);
    expect(hit.y).toBe(0); // what it leaves lands on the ground below
  });

  it('goes off at once on a person', () => {
    const hit = fly(shot(GRANAT), world({ people: [{ x: 0, z: -3, scale: 1 }] }));
    expect(hit).toMatchObject({ kind: 'person', bounced: false });
  });
});

describe('sight', () => {
  it('finds the wall a level line of sight meets, on its face', () => {
    const out = newHit();
    expect(sight(0, 1.5, 0, 0, 0, -1, 0, 100, world(), out)).toBe(true);
    expect(out).toMatchObject({ kind: 'wall' });
    expect(out.z).toBeCloseTo(-20);
  });

  it('starts looking where it is told to, past what stands nearer', () => {
    const people = [{ x: 0, z: -3, scale: 1 }],
      out = newHit();
    sight(0, 1.5, 0, 0, 0, -1, 0, 100, world({ people }), out);
    expect(out.kind).toBe('person');
    sight(0, 1.5, 0, 0, 0, -1, 5, 100, world({ people }), out);
    expect(out.kind).toBe('wall');
  });

  it('gives its far end when it meets nothing', () => {
    const out = newHit();
    expect(sight(0, 1.5, 0, 1, 0, 0, 0, 50, world(), out)).toBe(false);
    expect(out).toMatchObject({ x: 50, y: 1.5, z: 0 });
  });
});

describe('aimAt', () => {
  it('sends a shot through the point it is aimed at, drop and all', () => {
    for (const weapon of [PICKADOLL, WEAPONS.findIndex(w => w.id === 'potatiskanon')]) {
      // a point on the house's south wall, 3 m up and a little to the east
      const { yaw, pitch } = aimAt(WEAPONS[weapon].speedMs, 0, MUZZLE_M, 0, 2, 3, -20, { yaw: 0, pitch: 0 });
      const hit = fly(
        {
          x: 0,
          y: MUZZLE_M,
          z: 0,
          ...aimShot(WEAPONS[weapon], yaw, pitch),
          ageS: 0,
          weapon,
          bounced: 0,
          lifeS: 0,
          lying: false,
        },
        world(),
      );
      expect(hit).toMatchObject({ kind: 'wall' });
      if (hit !== 'gone') {
        expect(hit.x).toBeCloseTo(2, 0);
        expect(hit.y).toBeCloseTo(3, 0);
      }
    }
  });

  it('fires at 45 degrees at a point out of reach', () => {
    expect(aimAt(10, 0, 0, 0, 0, 0, -500, { yaw: 0, pitch: 0 }).pitch).toBeCloseTo(Math.PI / 4);
  });
});

describe('assistTarget', () => {
  const people = [
    { x: 2, z: -20, scale: 1 }, // a little right of north
    { x: -20, z: 0, scale: 1 }, // due west
  ];

  it('is the nearest target inside the cone', () => {
    expect(assistTarget(0, 0, 0, { people, cars: [] }, 0.3, 45)).toBe(people[0]);
  });

  it('is nobody when nobody is inside the cone or the range', () => {
    expect(assistTarget(0, 0, Math.PI, { people, cars: [] }, 0.3, 45)).toBeNull();
    expect(assistTarget(0, 0, 0, { people, cars: [] }, 0.3, 10)).toBeNull();
  });
});
