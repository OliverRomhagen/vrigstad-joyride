import { describe, expect, it } from 'vitest';
import { type Car, newCar } from '../../../../src/game/cars';
import { type Link, LoopbackHub } from '../../../../src/game/net/loopback';
import { Session, SILENT_MS } from '../../../../src/game/net/session';
import type { CarLook, Snapshot } from '../../../../src/game/net/snapshots';
import { VEHICLE_SPECS } from '../../../../src/game/sim/vehicle-spec';

const look: CarLook = { type: 'volvo', model: null, color: '#27406b' };
const FRAME_MS = 16;
const BAD: Link = { lagMs: 80, jitterMs: 60, loss: 0.2 }; // worse than most home networks

/** A room, and players in it: each a session over the loopback, with a village of two parked cars 10 m apart. */
function room(link: Partial<Link> = {}) {
  const hub = new LoopbackHub(link),
    players: { p: { playing: boolean }; session: Session }[] = [];
  let now = 0;

  /** `skewMs`: how far this player's computer clock is from the true time */
  function join(me: string, skewMs = 0) {
    const cars: Car[] = [0, 10].map(x => newCar('volvo', x, 0, 0, 'parked', VEHICLE_SPECS.volvo, look.color)),
      seen = new Map<string, Snapshot>(), // the other players as last drawn
      p = { x: 0, driven: null as Car | null, playing: true };
    const transport = hub.join(me);
    const session = new Session({
      transport,
      clock: () => now + skewMs,
      local: () => ({ x: p.driven?.x ?? p.x, z: 0, h: 0, vh: Math.PI / 2, v: 0, y: 0, phase: 0, hidden: false }),
      remotes: { show: (id, s) => void seen.set(id, { ...s }), remove: id => void seen.delete(id) },
      cars: {
        cars,
        seeded: [...cars],
        driven: () => p.driven,
        look: () => look,
        addCar: (_look, x, z, h) => {
          const c = newCar('volvo', x, z, h, 'idle', VEHICLE_SPECS.volvo, look.color);
          cars.push(c);
          return c;
        },
        removeCar: c => void cars.splice(cars.indexOf(c), 1),
        placeCar: () => {},
        lostCar: () => {
          p.driven!.mode = 'idle';
          p.driven = null;
        },
      },
    });
    const player = { p, cars, seen, session, transport };
    players.push(player);
    return player;
  }

  /** Runs every player's frames for `ms`; `move` runs before each frame. */
  function run(ms: number, move: (dtS: number) => void = () => {}) {
    for (const end = now + ms; now < end; ) {
      now += FRAME_MS;
      move(FRAME_MS / 1000);
      hub.advance(now);
      for (const { p, session } of players) if (p.playing) session.update(FRAME_MS / 1000);
    }
  }
  return { join, run };
}

describe('Session over the loopback connector', () => {
  it('draws a walking player close to where they are, on a late, uneven and lossy network', () => {
    const { join, run } = room(BAD),
      a = join('a'),
      b = join('b');
    let worst = 0;
    run(5000, dt => {
      a.p.x += 4 * dt; // 4 m/s
      const shown = b.seen.get('a');
      // b draws a where a was a moment ago: the lag, plus the delay it draws at, plus a lost snapshot or two
      if (shown) worst = Math.max(worst, a.p.x - shown.x);
    });
    expect(a.session.peers).toBe(1);
    expect(b.seen.get('a')!.x).toBeGreaterThan(18);
    expect(worst).toBeLessThan(4 * 0.6); // never more than 0.6 s behind
  });

  it('moves the car a player drives, and leaves it exactly where they got out, whatever was lost', () => {
    const { join, run } = room({ ...BAD, loss: 0.5 }),
      a = join('a'),
      b = join('b');
    run(500);
    a.p.driven = a.cars[1];
    a.cars[1].mode = 'player';
    run(2000, dt => {
      a.cars[1].x += 10 * dt;
    });
    expect(b.cars[1].mode).toBe('remote');
    expect(b.cars[1].x).toBeGreaterThan(20);
    a.p.x = a.cars[1].x;
    a.p.driven = null;
    a.cars[1].mode = 'idle';
    run(1000);
    expect(b.cars).toHaveLength(2);
    expect(b.cars[1]).toMatchObject({ mode: 'idle', v: 0 });
    expect(b.cars[1].x).toBe(a.cars[1].x);
  });

  it('tells a player who joins later where the cars were left', () => {
    const { join, run } = room(BAD),
      a = join('a');
    a.p.driven = a.cars[0];
    a.cars[0].mode = 'player';
    run(500);
    a.cars[0].x = 55;
    a.p.driven = null;
    a.cars[0].mode = 'idle';
    run(500);
    const late = join('late');
    run(1000);
    expect(late.cars[0].x).toBe(55);
    expect(late.session.peers).toBe(1);
  });

  it('gives a car two players take at once to one of them, the same one for both', () => {
    const { join, run } = room(BAD),
      a = join('a'),
      b = join('b');
    run(500);
    for (const { p, cars } of [a, b]) {
      p.driven = cars[0];
      cars[0].mode = 'player';
    }
    run(1000);
    // which one depends on whose reading of the room's clock was a hair earlier; what matters is that they agree
    const [kept, lost] = a.p.driven ? [a, b] : [b, a];
    expect(kept.cars[0].mode).toBe('player');
    expect(lost.p.driven).toBeNull();
    expect(lost.cars[0].mode).toBe('remote');
  });

  it('agrees on one clock when the clocks of the computers are seconds apart', () => {
    const { join, run } = room(BAD),
      a = join('a', 5000),
      b = join('b', -3000);
    let worst = 0;
    run(1000);
    run(4000, dt => {
      a.p.x += 4 * dt;
      const shown = b.seen.get('a');
      if (shown) worst = Math.max(worst, a.p.x - shown.x);
    });
    expect(b.seen.get('a')!.x).toBeGreaterThan(14);
    expect(worst).toBeLessThan(4 * 0.6);
    expect(Math.abs(a.session.now - b.session.now)).toBeLessThan(60); // within the network's unevenness

    // b gets into the car 300 ms before a, though a's clock says b is 8 s late
    b.p.driven = b.cars[0];
    b.cars[0].mode = 'player';
    run(300);
    a.p.driven = a.cars[0];
    a.cars[0].mode = 'player';
    run(1000);
    expect(b.cars[0].mode).toBe('player');
    expect(a.p.driven).toBeNull();
  });

  it('keeps the room going when the player whose clock it runs on leaves', () => {
    const { join, run } = room(),
      a = join('a', 5000),
      b = join('b'),
      c = join('c', -2000);
    run(1500);
    const before = b.session.now;
    a.p.playing = false;
    a.transport.close();
    run(2000, dt => {
      b.p.x += 4 * dt;
    });
    expect(b.session.now - before).toBeCloseTo(2000, -2);
    expect(Math.abs(b.session.now - c.session.now)).toBeLessThan(20);
    expect(c.seen.get('b')!.x).toBeGreaterThan(6);
  });

  it('takes away a player who says goodbye at once, and one who goes silent after a while', () => {
    const { join, run } = room(),
      a = join('a'),
      b = join('b'),
      c = join('c');
    run(500);
    expect(a.session.peers).toBe(2);
    b.p.playing = false;
    b.transport.close();
    run(FRAME_MS);
    expect([...a.seen.keys()]).toEqual(['c']);
    c.p.playing = false; // a tab in the background: no frames and no snapshots, though it still answers pings
    run(SILENT_MS - 500);
    expect(a.session.peers).toBe(1);
    run(1000);
    expect(a.session.peers).toBe(0);
  });

  it('drops what is not a whole message with real numbers and a known car type', () => {
    const hub = new LoopbackHub(),
      bad = hub.join('bad'),
      seen: string[] = [],
      cars: Car[] = [];
    const session = new Session({
      transport: hub.join('me'),
      clock: () => 200,
      local: () => ({ x: 0, z: 0, h: 0, vh: 0, v: 0, y: 0, phase: 0, hidden: false }),
      remotes: { show: id => void seen.push(id), remove: () => {} },
      cars: {
        cars,
        seeded: [],
        driven: () => null,
        look: () => look,
        addCar: () => {
          throw new Error('made a car from a bad message');
        },
        removeCar: () => {},
        placeCar: () => {},
        lostCar: () => {},
      },
    });
    const snap = { t: 1, x: 0, z: 0, h: 0, vh: 0, v: 0, y: 0, phase: 0, hidden: false, car: null };
    const car = { id: 'x', since: 0, dmg: 0, look: { type: 'tank', model: null, color: '#000' } };
    for (const m of [
      null,
      'hello',
      { snap: { ...snap, x: 'far' } },
      { snap: { ...snap, z: null } }, // what NaN and Infinity become on the wire
      { snap: { ...snap, car } },
      { snap: { ...snap, car: { ...car, look: { ...look, type: 'constructor' } } } },
      { cars: 'all of them' },
      { cars: [{ id: 'p0', t: 1, x: 0, z: 0, h: 0, dmg: 0, look: { ...look, type: 'tank' }, gone: false }] },
    ])
      bad.send(m, true);
    hub.advance(1);
    session.update(0.016);
    expect(session.peers).toBe(0);
    expect(seen).toEqual([]);
  });
});
