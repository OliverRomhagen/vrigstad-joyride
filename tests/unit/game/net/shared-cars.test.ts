import { describe, expect, it } from 'vitest';
import { type Car, newCar } from '../../../../src/game/cars';
import { type RestingCar, SharedCars } from '../../../../src/game/net/shared-cars';
import { blankSnapshot, type CarLook, type Snapshot } from '../../../../src/game/net/snapshots';
import { VEHICLE_SPECS } from '../../../../src/game/sim/vehicle-spec';

const look: CarLook = { type: 'volvo', model: null, color: '#27406b' };
const parked = (x: number) => newCar('volvo', x, 0, 0, 'parked', VEHICLE_SPECS.volvo, look.color);

/** One player's client: a village of two parked cars, 10 m apart, as every client builds it. */
function client(me: string) {
  const cars: Car[] = [parked(0), parked(10)],
    told: RestingCar[] = [],
    state = { driven: null as Car | null, lost: 0 };
  const shared = new SharedCars({
    me,
    cars,
    seeded: [...cars],
    driven: () => state.driven,
    look: () => look,
    addCar: (_look, x, z, h) => {
      const c = newCar('volvo', x, z, h, 'idle', VEHICLE_SPECS.volvo, look.color);
      cars.push(c);
      return c;
    },
    removeCar: c => void cars.splice(cars.indexOf(c), 1),
    placeCar: () => {},
    lostCar: () => {
      state.lost++;
      state.driven!.mode = 'idle';
      state.driven = null;
    },
    tell: list => void told.push(...list),
  });
  const getIn = (c: Car) => {
    c.mode = 'player';
    state.driven = c;
  };
  /** this player as the others get them: at x in the car they drive, or on foot */
  const snap = (now: number, x = 0): Snapshot => ({ ...blankSnapshot(), t: now, x, car: shared.local(now) });
  return { cars, told, state, shared, getIn, snap };
}

describe('SharedCars', () => {
  it('moves the same parked car on the other client, and leaves it where the driver got out', () => {
    const a = client('a'),
      b = client('b');
    a.getIn(a.cars[1]);
    b.shared.show('a', a.snap(1000, 30));
    expect(b.cars).toHaveLength(2); // no second car
    expect(b.cars[1]).toMatchObject({ mode: 'remote', x: 30 });

    a.cars[1].x = 42; // a rolls on a little after that snapshot, then gets out
    a.cars[1].mode = 'idle';
    a.state.driven = null;
    const onFoot = a.snap(1100, 42);
    b.shared.hear(a.told); // the word on where it stands arrives before the snapshot on foot is drawn
    b.shared.show('a', onFoot);
    expect(b.cars[1]).toMatchObject({ mode: 'idle', x: 42, v: 0 });
  });

  it('makes a car the other client has never seen, such as one taken from traffic', () => {
    const a = client('a'),
      b = client('b'),
      taken = newCar('volvo', 50, 0, 0, 'ai', VEHICLE_SPECS.volvo, look.color);
    a.cars.push(taken);
    a.getIn(taken);
    const s = a.snap(1000, 50);
    expect(s.car!.id).toBe('a:0');
    b.shared.show('a', s);
    b.shared.show('a', a.snap(1066, 51));
    expect(b.cars).toHaveLength(3);
    expect(b.cars[2]).toMatchObject({ mode: 'remote', x: 51 });
  });

  it('gives a car both took to the one who got in first, on both clients', () => {
    const a = client('a'),
      b = client('b');
    a.getIn(a.cars[0]);
    const fromA = a.snap(1000);
    b.getIn(b.cars[0]);
    const fromB = b.snap(1040);
    a.shared.show('b', fromB);
    b.shared.show('a', fromA);
    expect(a.state).toMatchObject({ driven: a.cars[0], lost: 0 });
    expect(a.cars[0].mode).toBe('player');
    expect(b.state).toMatchObject({ driven: null, lost: 1 });
    expect(b.cars[0].mode).toBe('remote');
    expect(b.told).toEqual([]); // b never left it anywhere
    b.snap(1100);
    expect(b.told).toEqual([]);
  });

  it('tells a player who joins later where cars were left, and which were sold', () => {
    const a = client('a');
    a.getIn(a.cars[0]);
    a.snap(1000);
    a.cars[0].x = 77;
    a.cars[0].dmg = 3;
    a.cars[0].mode = 'idle';
    a.state.driven = null;
    a.snap(2000);
    const sold = a.cars[1];
    a.getIn(sold);
    a.snap(3000);
    a.state.driven = null;
    a.cars.splice(1, 1);
    a.snap(4000);

    const late = client('late');
    late.shared.hear(a.shared.known);
    expect(late.cars).toHaveLength(1);
    expect(late.cars[0]).toMatchObject({ x: 77, dmg: 3 });
    // an older word about the car changes nothing
    late.shared.hear([{ ...a.shared.known[0], t: 1500, x: -5 }]);
    expect(late.cars[0].x).toBe(77);
  });

  it('leaves the car of a player who vanished where it stood, and remembers it for the next one to join', () => {
    const a = client('a'),
      b = client('b');
    a.getIn(a.cars[0]);
    b.shared.show('a', a.snap(1000, 20));
    b.shared.remove('a', 5000);
    expect(b.cars[0]).toMatchObject({ mode: 'idle', x: 20 });
    expect(b.shared.known).toMatchObject([{ id: 'p0', x: 20, t: 5000, gone: false }]);
  });
});
