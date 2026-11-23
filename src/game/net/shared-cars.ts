// Multiplayer prototype (lab: multiplayer, docs/multiplayer.md): the cars every player sees as the same car.
// A car has one id on every client: the cars parked when the village is built get theirs from the order they were
// made in, which the seed makes the same everywhere; any other car gets one from the player who first drives it.
// The driver's client moves the car; the others put it where the driver's snapshots say (mode 'remote'). Where a
// car was left is told once, and kept, so a player who joins later can be told too. No three.js or DOM here.
import type { Car } from '../cars';
import type { CarLook, CarRef, Snapshot } from './snapshots';

/** Where a shared car was left, or that it is gone (sold). The newest `t` wins. */
export interface RestingCar {
  id: string;
  t: number; // ms, on the clock the peers share
  x: number;
  z: number;
  h: number;
  dmg: number;
  look: CarLook;
  gone: boolean;
}

/** What the shared cars read from the game. The callbacks are function properties: they are called detached. */
export interface SharedCarsDeps {
  me: string; // this player's id
  cars: readonly Car[];
  /** the cars parked when the village was built, in the order they were made: the same on every client */
  seeded: readonly Car[];
  /** the car this player drives */
  driven: () => Car | null;
  look: (c: Car) => CarLook;
  /** makes a car nobody drives and adds it to the village */
  addCar: (look: CarLook, x: number, z: number, h: number) => Car;
  removeCar: (c: Car) => void;
  placeCar: (c: Car) => void;
  /** another player got into the car this player drives first: this player gets out */
  lostCar: () => void;
  /** tells the other players where cars were left */
  tell: (cars: RestingCar[]) => void;
}

type Drive = { car: Car; since: number }; // a car another player drives, and since when (ms)
// cars the others made here (driven out of traffic, a police car, the one Skroten put back): a room's worth, and a
// limit on what a peer that sends new ids without end can make this player build
export const MAX_ADDED_CARS = 200;
const isDriven = (c: Car) => c.mode === 'player' || c.mode === 'remote';

/** Which car is which across the players, who drives each, and where the ones nobody drives were left. */
export class SharedCars {
  private readonly g: SharedCarsDeps;
  private readonly byId = new Map<string, Car>();
  private readonly ids = new Map<Car, string>();
  private readonly resting = new Map<string, RestingCar>();
  private readonly drivers = new Map<string, Drive>(); // by the other player's id
  private mine: Car | null = null; // the car this player drove at the last look
  private since = 0;
  private made = 0;
  private readonly madeHere = new Set<Car>(); // cars made here for another player's id, at most MAX_ADDED_CARS

  constructor(g: SharedCarsDeps) {
    this.g = g;
    // traffic gets no id here: it drives differently on every client
    for (const [i, c] of g.seeded.entries()) this.name(c, 'p' + i);
  }

  private name(c: Car, id: string) {
    this.byId.set(id, c);
    this.ids.set(c, id);
    return c;
  }

  private forget(c: Car, id: string) {
    this.byId.delete(id);
    this.ids.delete(c);
    this.madeHere.delete(c);
  }

  // the car with that id, made if this player has never seen it and there is room for one more
  private car(id: string, look: CarLook, x: number, z: number, h: number) {
    const known = this.byId.get(id);
    if (known || this.madeHere.size >= MAX_ADDED_CARS) return known ?? null;
    const c = this.name(this.g.addCar(look, x, z, h), id);
    this.madeHere.add(c);
    return c;
  }

  /** The room's clock moved by `ms`: the times kept so far move with it, so they still compare with new ones. */
  shift(ms: number) {
    this.since += ms;
    for (const r of this.resting.values()) r.t += ms;
    for (const d of this.drivers.values()) d.since += ms;
  }

  /**
   * This player was away (a tab in the background) long enough for the others to let go of their car: the claim
   * on it starts now, so one who got in meanwhile keeps it, on every client alike.
   */
  claimAgain(now: number) {
    if (this.mine) this.since = now;
  }

  /** every car's last resting place this player knows of, for a player who just joined */
  get known() {
    return [...this.resting.values()];
  }

  /** The car this player drives, to send. Notices getting in, and tells the others where a car was left. */
  local(now: number): CarRef | null {
    const { g } = this,
      c = g.driven();
    if (c !== this.mine) {
      if (this.mine) this.left(this.mine, now, true);
      this.mine = c;
      this.since = now;
    }
    if (!c) return null;
    let id = this.ids.get(c);
    if (!id) {
      id = g.me + ':' + this.made++;
      this.name(c, id);
    }
    return { id, since: this.since, dmg: c.dmg, look: g.look(c) };
  }

  // nobody drives c any more: remember where it stands, and tell the others if it was this player's
  private left(c: Car, now: number, tell: boolean) {
    const id = this.ids.get(c);
    if (!id) return;
    const gone = !this.g.cars.includes(c); // sold
    if (gone) this.forget(c, id);
    const r = { id, t: now, x: c.x, z: c.z, h: c.h, dmg: c.dmg, look: this.g.look(c), gone };
    this.resting.set(id, r);
    if (tell) this.g.tell([r]);
  }

  /** Puts the car the player `peer` drives where their snapshot says, and lets go of the one they drove before. */
  show(peer: string, s: Snapshot) {
    const { g } = this,
      ref = s.car;
    let drive = this.drivers.get(peer),
      car = ref && this.car(ref.id, ref.look, s.x, s.z, s.h);
    if (car && ref && car === g.driven()) {
      // both took it: the one who got in first keeps it, and the other hears the same and gets out
      if (ref.since < this.since || (ref.since === this.since && peer < g.me)) {
        this.mine = null; // not left by this player: the other one drives it
        g.lostCar();
      } else car = null;
    }
    if (drive && drive.car !== car) {
      this.release(peer, drive);
      drive = undefined;
    }
    if (!car || !ref) return;
    // the same object every frame while they drive one car: this runs for each driver, every frame
    if (drive) drive.since = ref.since;
    else this.drivers.set(peer, { car, since: ref.since });
    car.mode = 'remote';
    car.x = s.x;
    car.z = s.z;
    car.h = s.h;
    car.vh = s.vh;
    car.v = s.v;
    car.dmg = ref.dmg;
    g.placeCar(car);
  }

  private release(peer: string, { car: c, since }: Drive) {
    this.drivers.delete(peer);
    if (c.mode !== 'remote') return; // someone else has it by now
    c.mode = 'idle';
    c.v = 0;
    c.vh = c.h;
    this.g.placeCar(c);
    // the driver's own word on where they left it is usually here before their last snapshot is drawn
    const id = this.ids.get(c),
      r = id && this.resting.get(id);
    if (r && r.t >= since) this.put(r);
  }

  /** The player `peer` left the game: the car they drove stays where it stands. */
  remove(peer: string, now: number) {
    const drive = this.drivers.get(peer);
    if (!drive) return;
    this.release(peer, drive);
    // they can't say where they left it, so every player who saw it remembers
    if (drive.car.mode === 'idle') this.left(drive.car, now, false);
  }

  /** Where other players say cars were left. An older word about a car than the one already known is dropped. */
  hear(cars: readonly RestingCar[]) {
    for (const r of cars) {
      const known = this.resting.get(r.id);
      if (known && known.t >= r.t) continue;
      this.resting.set(r.id, r);
      const c = this.byId.get(r.id);
      if (!c || !isDriven(c)) this.put(r); // a driven car is where its driver's snapshots say, until they let go
    }
  }

  // makes the car as r says: gone, or standing there
  private put(r: RestingCar) {
    const { g } = this;
    let c = this.byId.get(r.id);
    if (r.gone) {
      if (c) {
        this.forget(c, r.id);
        g.removeCar(c);
      }
      return;
    }
    c ??= this.car(r.id, r.look, r.x, r.z, r.h) ?? undefined;
    if (!c) return;
    c.x = r.x;
    c.z = r.z;
    c.h = c.vh = r.h;
    c.v = 0;
    c.dmg = r.dmg;
    g.placeCar(c);
  }
}
