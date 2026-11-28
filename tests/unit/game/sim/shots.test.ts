import { describe, expect, it } from 'vitest';
import {
  aimAt,
  aimAtMoving,
  aimShot,
  assistTarget,
  blastPush,
  flightPath,
  GRAVITY_MS2,
  knockbackOf,
  MUZZLE_M,
  newHit,
  onHead,
  type Shot,
  ShotStep,
  type ShotWorld,
  sight,
  slideCar,
  stepShot,
  WEAPONS,
  WeaponId,
} from '../../../../src/game/sim/shots';

const PICKADOLL = WEAPONS.findIndex(w => w.id === WeaponId.PICKADOLL);
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

function fly(s: Shot, w: ShotWorld, dt = 1 / 60) {
  const out = newHit();
  for (let i = 0; i < 600; i++) {
    const step = stepShot(s, dt, w, out);
    if (step !== ShotStep.FLYING) return step === ShotStep.HIT ? out : step;
  }
  throw new Error('still flying after 10 s');
}

describe('aimShot', () => {
  it('fires north at yaw 0 and east at a quarter turn, at the muzzle speed', () => {
    const w = WEAPONS[PICKADOLL];
    expect(aimShot(w, 0, 0)).toEqual({ vx: 0, vy: 0, vz: -w.speedMs });
    const kept = { ...shot(), vx: 1, vy: 2, vz: 3 }; // a shot passed as `out` gets the speed, and nothing new is made
    expect(aimShot(w, 0, 0, 0, 0, kept)).toBe(kept);
    expect(kept).toMatchObject({ vx: 0, vy: 0, vz: -w.speedMs });
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
    if (hit !== ShotStep.GONE) expect(-hit.z).toBeCloseTo(WEAPONS[PICKADOLL].speedMs * fallS, 0);
  });

  it('hits the wall of a house, and says which way the wall faces', () => {
    const hit = fly(shot(), world());
    expect(hit).toMatchObject({ kind: 'wall', nx: 0, nz: 1 }); // the south wall faces south
    if (hit !== ShotStep.GONE) expect(hit.z).toBeCloseTo(-20); // on the wall's face, not where the shot was noticed inside it
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
    if (hit !== ShotStep.GONE) {
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
      hit = newHit();
    expect(stepShot(s, 0.25, world({ people: [{ x: 0, z: -9, scale: 1 }] }), hit)).toBe('hit');
    expect(hit).toMatchObject({ kind: 'person' });
  });
});

describe('the weapons', () => {
  it('has a minigun that fires for as long as the trigger is held', () => {
    expect(WEAPONS.find(w => w.id === WeaponId.MINIGUN)).toMatchObject({ auto: true });
  });
});

describe('a shot that bounces', () => {
  const GULD = WEAPONS.findIndex(w => w.id === WeaponId.GULDARTPUFFRA);

  it('comes back off a wall the way it went in, slower, and flies on', () => {
    // aimed a little up: a level pea is on the ground before the wall, 20 m away
    const s: Shot = { ...shot(GULD), ...aimShot(WEAPONS[GULD], 0, 0.2) },
      hit = fly(s, world());
    expect(hit).toMatchObject({ kind: 'wall', fliesOn: true });
    expect(s.vz).toBeGreaterThan(0); // it flew north, and now south
    expect(Math.hypot(s.vx, s.vz)).toBeLessThan(WEAPONS[GULD].speedMs);
    expect(s.bounced).toBe(1);
  });

  it('stops in the end: after its bounces, or when it has lost its speed', () => {
    const s = shot(GULD),
      w = world({ collide: () => false });
    let hits = 0;
    for (let hit = fly(s, w); hit !== ShotStep.GONE && hit.fliesOn; hit = fly(s, w)) hits++;
    expect(hits).toBeGreaterThan(1);
    expect(hits).toBeLessThanOrEqual(WEAPONS[GULD].bounces);
  });

  it('is stopped by a person, and a pickadoll shot never bounces', () => {
    expect(fly(shot(GULD), world({ people: [{ x: 0, z: -10, scale: 1 }] }))).toMatchObject({
      kind: 'person',
      fliesOn: false,
    });
    expect(fly(shot(), world())).toMatchObject({ kind: 'wall', fliesOn: false });
  });
});

describe('a thrown shot with a fuse', () => {
  const GRANAT = WEAPONS.findIndex(w => w.id === WeaponId.GRANAT),
    fuseS = WEAPONS[GRANAT].fuseS;

  // steps until it goes off; says how many times it touched something before, and when it went off
  function untilBurst(s: Shot, w: ShotWorld) {
    const out = newHit();
    let touches = 0;
    for (let i = 0; i < 600; i++) {
      const step = stepShot(s, 1 / 60, w, out);
      if (step === ShotStep.GONE) throw new Error('gone before its fuse');
      if (step === ShotStep.FLYING) continue;
      if (out.wentOff) return { touches, hit: out };
      expect(out.fliesOn).toBe(true); // it never stops on what it touches
      touches++;
    }
    throw new Error('never went off');
  }

  it('bounces, comes to rest, and goes off when the fuse runs out, on the ground', () => {
    const s = shot(GRANAT),
      { touches, hit } = untilBurst(s, world({ collide: () => false }));
    expect(touches).toBeGreaterThan(0);
    expect(s.lifeS).toBeCloseTo(fuseS, 1);
    expect(hit).toMatchObject({ kind: 'ground', y: 0, wentOff: true, fliesOn: false });
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
    expect(hit).toMatchObject({ kind: 'person', fliesOn: false });
  });
});

describe('a bounce on a slope', () => {
  it('goes on up a hill instead of stopping where it first touches', () => {
    const GULD = WEAPONS.findIndex(w => w.id === WeaponId.GULDARTPUFFRA),
      // the ground rises 1 m for every 2 m north
      w = world({ collide: () => false, groundAt: (_x, z) => -z * 0.5 }),
      s = { ...shot(GULD), ...aimShot(WEAPONS[GULD], 0, 0.5) },
      out = newHit();
    let first: number | null = null;
    for (let i = 0; i < 600 && first === null; i++)
      if (stepShot(s, 1 / 60, w, out) !== ShotStep.FLYING) first = s.bounced;
    expect(first).toBe(1); // it met the slope still rising, and bounced off it
    expect(out.ny).toBeCloseTo(2 / Math.hypot(1, 2)); // the slope's own normal, leaning back south
    expect(out.nz).toBeCloseTo(1 / Math.hypot(1, 2));
  });
});

describe('aimAtMoving', () => {
  it('lands a shot from a car driving east on a target to the north', () => {
    const weapon = WEAPONS[PICKADOLL],
      aim = aimAtMoving(weapon.speedMs, 0, MUZZLE_M, 0, 0, 1, -40, 20, 0, { yaw: 0, pitch: 0 }),
      s = { ...shot(), ...aimShot(weapon, aim.yaw, aim.pitch) };
    s.vx += 20; // the shot keeps the car's speed
    const hit = fly(s, world({ collide: () => false, people: [{ x: 0, z: -40, scale: 1 }] })) as { kind: string };
    expect(hit.kind).toBe('person');
    expect(aim.yaw).toBeLessThan(0); // aimed back, against the drift
  });

  it('is aimAt for a shooter that stands still', () => {
    const a = aimAt(60, 0, 1, 0, 10, 2, -30, { yaw: 0, pitch: 0 }),
      b = aimAtMoving(60, 0, 1, 0, 10, 2, -30, 0, 0, { yaw: 0, pitch: 0 });
    expect(b).toEqual(a);
  });
});

describe('a fast shot', () => {
  const ALG = WEAPONS.findIndex(w => w.id === WeaponId.ALGSTUDSARE);

  it('stops at someone in its way, however far it flies in a frame', () => {
    // 760 m/s is 25 m in one step of 1/30 s: well past a person 0.7 m across
    const people = [{ x: 0, z: -200, scale: 1 }],
      hit = fly({ ...shot(ALG), ...aimShot(WEAPONS[ALG], 0, 0) }, world({ collide: () => false, people }), 1 / 30) as {
        kind: string;
        z: number;
      };
    expect(hit.kind).toBe('person');
    expect(hit.z).toBeGreaterThan(-200.6);
    expect(hit.z).toBeLessThan(-199.4);
  });

  it('lands where a slow frame rate lands it too', () => {
    const land = (dt: number) => {
      const hit = fly({ ...shot(ALG), ...aimShot(WEAPONS[ALG], 0.1, -0.004) }, world({ collide: () => false }), dt);
      return hit as { x: number; z: number };
    };
    const quick = land(1 / 120),
      slow = land(1 / 20);
    expect(Math.hypot(quick.x - slow.x, quick.z - slow.z)).toBeLessThan(1);
  });

  it('hits who it is aimed at 300 m off, the drop allowed for', () => {
    const weapon = WEAPONS[ALG],
      aim = aimAt(weapon.speedMs, 0, MUZZLE_M, 0, 0, 1, -300, { yaw: 0, pitch: 0 }),
      people = [{ x: 0, z: -300, scale: 1 }],
      hit = fly({ ...shot(ALG), ...aimShot(weapon, aim.yaw, aim.pitch) }, world({ collide: () => false, people }));
    expect((hit as { kind: string }).kind).toBe('person');
  });
});

describe('the weapons', () => {
  it('have ids of their own, and a scope only on something you fire', () => {
    expect(new Set(WEAPONS.map(w => w.id)).size).toBe(WEAPONS.length);
    for (const w of WEAPONS) if (w.scope) expect(w.thrown).toBe(false);
  });
});

describe('blastPush', () => {
  it('reaches what stands within the blast, and pushes it away from the middle', () => {
    const out = { dx: 0, dz: 0 };
    expect(blastPush(10, 10, 5, 13, 14, out)).toBe(true); // 5 m off: just in reach
    expect(out.dx).toBeCloseTo(0.6);
    expect(out.dz).toBeCloseTo(0.8);
    expect(blastPush(10, 10, 5, 13, 14.1, out)).toBe(false);
  });

  it('throws who stands at its very middle too', () => {
    const out = { dx: 9, dz: 9 };
    expect(blastPush(2, 3, 5, 2, 3, out)).toBe(true);
    expect(Math.hypot(out.dx, out.dz)).toBe(1);
  });
});

describe('a grenade at rest', () => {
  it('lies on the ground where it stopped, on a slope too', () => {
    const GRANAT = WEAPONS.findIndex(w => w.id === WeaponId.GRANAT),
      // a hill that rises to the north and to the east
      w = world({ collide: () => false, groundAt: (x, z) => -z * 0.3 + x * 0.2 }),
      s = { ...shot(GRANAT), vx: 3 },
      out = newHit();
    for (let i = 0; i < 600 && !s.lying; i++) stepShot(s, 1 / 60, w, out);
    expect(s.lying).toBe(true);
    expect(s.y).toBeCloseTo(w.groundAt(s.x, s.z), 6);
  });
});

describe('flightPath', () => {
  it('ends where the shot itself lands, with the points on its way there', () => {
    const w = world({ collide: () => false }),
      points: number[] = [],
      end = newHit(),
      n = flightPath(shot(), w, 1 / 20, 64, points, end),
      hit = fly(shot(), w) as { z: number };
    expect(n).toBeGreaterThan(2);
    expect(points.slice(0, 3)).toEqual([0, MUZZLE_M, 0]); // it starts at the muzzle
    expect(points[(n - 1) * 3 + 2]).toBeCloseTo(hit.z, 0);
    expect(points[(n - 1) * 3 + 1]).toBe(0); // and ends on the ground
  });

  it('follows a grenade through its bounces to where it comes to rest', () => {
    const GRANAT = WEAPONS.findIndex(w => w.id === WeaponId.GRANAT),
      points: number[] = [],
      end = newHit(),
      n = flightPath(shot(GRANAT), world({ collide: () => false }), 1 / 20, 64, points, end);
    // thrown level at 15 m/s from 1.35 m, it first lands about 7.9 m out, and rests further on
    expect(-points[(n - 1) * 3 + 2]).toBeGreaterThan(7.9);
    expect(-points[(n - 1) * 3 + 2]).toBeLessThan(14);
  });

  it('never gives more points than asked for', () => {
    const points: number[] = [];
    expect(flightPath(shot(), world({ collide: () => false }), 1 / 200, 10, points, newHit())).toBeLessThanOrEqual(10);
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

  it('names who it meets among many, and none of those beside the line', () => {
    const people = [
        { x: 3, z: -6, scale: 1 }, // beside the line
        { x: 0, z: -40, scale: 1 }, // behind the wall
        { x: 0.2, z: -9, scale: 1 }, // on it
        { x: 0, z: -4, scale: 1, down: true }, // lying down: looked over
      ],
      cars = [{ x: 9, z: -8, h: 0, T }], // parked well to the side
      out = newHit();
    expect(sight(0, 1.5, 0, 0, 0, -1, 0, 100, world({ people, cars }), out)).toBe(true);
    expect(out).toMatchObject({ kind: 'person', target: 2 });
    people[2].x = 1; // step aside, and the line goes on to the wall
    sight(0, 1.5, 0, 0, 0, -1, 0, 100, world({ people, cars }), out);
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
    for (const weapon of [PICKADOLL, WEAPONS.findIndex(w => w.id === WeaponId.GULDARTPUFFRA)]) {
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
      if (hit !== ShotStep.GONE) {
        expect(hit.x).toBeCloseTo(2, 0);
        expect(hit.y).toBeCloseTo(3, 0);
      }
    }
  });

  it('fires no higher than it must at a point out of reach, not in a 45° lob', () => {
    // 10 m/s reaches about 10 m on level ground: at 500 m, the arc that would reach that far is nearly flat
    expect(aimAt(10, 0, 0, 0, 0, 0, -500, { yaw: 0, pitch: 0 }).pitch).toBeCloseTo(Math.atan(100 / (9.8 * 500)));
    // high above, out of reach too: along the line to it
    expect(aimAt(10, 0, 0, 0, 0, 400, -500, { yaw: 0, pitch: 0 }).pitch).toBeCloseTo(Math.atan2(400, 500));
  });

  it("doesn't jump as the point crosses the edge of reach", () => {
    // 26 m/s reaches about 69 m on level ground; the pitch changes little either side of it
    const pitchAt = (m: number) => aimAt(26, 0, 0, 0, 0, 0, -m, { yaw: 0, pitch: 0 }).pitch,
      edgeM = (26 * 26) / 9.8;
    expect(Math.abs(pitchAt(edgeM + 0.5) - pitchAt(edgeM - 0.5))).toBeLessThan(0.1);
  });
});

describe('assistTarget', () => {
  const people = [
    { x: 2, z: -20, scale: 1 }, // a little right of north
    { x: -20, z: 0, scale: 1 }, // due west
  ];

  it('is who you look most nearly at, not who stands nearest', () => {
    const near = { x: 1.2, z: -5, scale: 1 }, // 5 m off, well to the side
      far = { x: 2, z: -40, scale: 1 }; // 40 m off, nearly dead ahead
    expect(assistTarget(0, 0, 0, { people: [near, far], cars: [] }, 0.3, 45)).toBe(far);
  });

  it('is the target inside the cone', () => {
    expect(assistTarget(0, 0, 0, { people, cars: [] }, 0.3, 45)).toBe(people[0]);
  });

  it('is nobody when nobody is inside the cone or the range', () => {
    expect(assistTarget(0, 0, Math.PI, { people, cars: [] }, 0.3, 45)).toBeNull();
    expect(assistTarget(0, 0, 0, { people, cars: [] }, 0.3, 10)).toBeNull();
  });
});

describe('onHead', () => {
  it('takes the top of a person for their head, by their size', () => {
    expect(onHead(1.6, 0, 1)).toBe(true);
    expect(onHead(1.4, 0, 1)).toBe(false);
    expect(onHead(1.6, 0, 1.1)).toBe(false); // a tall person's head is higher up
    expect(onHead(1.6, 0.3, 1)).toBe(false); // at head height, but past the shoulder
  });
});

describe('knockbackOf', () => {
  it('pushes by what the shot weighs times its speed, so a faster weapon pushes harder', () => {
    expect(knockbackOf({ shotMassKg: 0.5, speedMs: 80 })).toBe(40);
    expect(knockbackOf({ shotMassKg: 0.5, speedMs: 160 })).toBe(80);
  });

  it("keeps the pushes the weapons' power gave: 40 N·s a point", () => {
    const by = (id: WeaponId) => knockbackOf(WEAPONS.find(w => w.id === id)!);
    expect(by(WeaponId.PICKADOLL)).toBeCloseTo(40, 0);
    expect(by(WeaponId.ALGSTUDSARE)).toBeCloseTo(200, 0);
  });
});

describe('slideCar', () => {
  it('slides a parked car along a push that beats its brakes', () => {
    const c = { x: 10, z: 5, mode: 'parked' as const };
    expect(slideCar(c, 0, -1, 120)).toBe(true);
    expect(c.x).toBe(10);
    expect(c.z).toBeCloseTo(5 - 120 * 0.0035); // 0.0035 m an N·s
  });

  it("holds a parked car against a pistol's push: the shot only marks it", () => {
    const c = { x: 10, z: 5, mode: 'parked' as const };
    const pickadoll = WEAPONS.find(w => w.id === WeaponId.PICKADOLL)!;
    expect(slideCar(c, 0, -1, knockbackOf(pickadoll))).toBe(false);
    expect(c).toEqual({ x: 10, z: 5, mode: 'parked' });
  });

  it('leaves a car that drives where its driving puts it', () => {
    const c = { x: 10, z: 5, mode: 'ai' as const };
    expect(slideCar(c, 1, 0, 500)).toBe(false);
    expect(c).toMatchObject({ x: 10, z: 5 });
  });
});
