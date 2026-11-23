// Multiplayer prototype (lab: multiplayer, docs/multiplayer.md): the session. It sends this player's snapshots over
// a transport, draws the others' a little in the past, keeps the shared cars, and keeps the room's clock. It knows
// the game's messages and nothing of how they travel, so any connector can carry it. No three.js or DOM here.
import { DMG_MAX } from '../health';
import { VEHICLE_SPECS } from '../sim/vehicle-spec';
import { type RestingCar, SharedCars, type SharedCarsDeps } from './shared-cars';
import { blankSnapshot, type CarLook, INTERP_DELAY_MS, SEND_HZ, type Snapshot, SnapshotBuffer } from './snapshots';
import type { Transport } from './transport';

export const SILENT_MS = 3000; // a player not heard from this long has gone (closed, or in the background, where frames stop)
const MAX_CARS = 500; // more resting cars than this in one message is not a village
// What a peer may say: a little past the playable square (±1100 m), past any car's top speed, and times no further
// ahead of the room's now than this (a snapshot's own time no further either way), so a number can't overflow the
// blending or freeze a car's state. When a player got in, or left a car, can be long ago
const MAX_POS_M = 1500,
  MAX_SPEED_MS = 150,
  MAX_HEIGHT_M = 500,
  MAX_ANGLE_RAD = 1e4, // headings aren't wrapped: a player who spins on the spot counts up
  MAX_TIME_OFF_MS = 600_000;
// The room's clock. Two computers' clocks can be seconds apart, and every time in a message (a snapshot's, when a
// player got into a car, when a car was left) has to mean the same to all. So the players agree on one of them, the
// one who has been in the room longest, and each keeps the difference between that player's clock and their own.
const PING_S = 1, // how often a player asks the others what time it is
  PING_UNSURE_S = 0.25, // and how often while they don't know the room's time yet
  PINGS_KEPT = 8, // the answer that came back fastest of this many is the one believed: it sat least in a queue
  CLOCK_JUMP_MS = 100, // a change this big in the room's time is a new clock, not a better reading of the same one
  RESTART_MS = 1000, // a snapshot this much older than a player's newest is from a new clock too
  // two who joined this close together are told apart by id: each works out the other's join time a network
  // delay late, so a closer call could come out differently on the two computers
  JOIN_TIE_MS = 1000,
  // a player this long in the room has heard everyone's ping, so whose clock they follow is worth saying
  SETTLED_MS = 2500;

/**
 * Asks what the room's time is. `age` is how long the asker has had the game open (ms): unlike a time by their
 * clock, it means the same on every computer. The oldest player's clock is the room's. `keeper` is whose clock the
 * asker follows, once they are settled: two who each count themselves the oldest find out that way.
 */
type Ping = { t: number; age: number; keeper?: string };
/** The answer to the ping `to` sent at their `t`: the room's time was `at`, as far as the one answering knows. */
type Pong = { to: string; t: number; at: number };
// snapshots are sent again 15 times a second, so one may be lost; where a car was left is said once, so it may not
type Message = { snap?: Snapshot; cars?: RestingCar[]; ping?: Ping; pong?: Pong };

/** Draws the other players: render/remote-players.ts in the game. */
export interface RemoteView {
  /** draws the player `id` at a state */
  show(id: string, s: Snapshot): void;
  /** takes away a player who left */
  remove(id: string): void;
}

/** What the session reads from the game. */
export interface SessionDeps {
  transport: Transport;
  /** this computer's clock (ms); it only has to run evenly */
  clock: () => number;
  /** this player now, or the car they drive; `t` and `car` are filled in here */
  local(): Omit<Snapshot, 't' | 'car'>;
  remotes: RemoteView;
  cars: Omit<SharedCarsDeps, 'me' | 'tell'>;
}

const isNum = (v: unknown) => typeof v === 'number' && Number.isFinite(v);
const within = (v: unknown, max: number) => isNum(v) && Math.abs(v as number) <= max;
const isStr = (v: unknown) => typeof v === 'string' && v.length < 80;
const isColor = (v: unknown) => typeof v === 'string' && /^#[0-9a-f]{6}$/i.test(v);
const isLook = (l: CarLook) =>
  !!l &&
  typeof l.type === 'string' &&
  Object.hasOwn(VEHICLE_SPECS, l.type) &&
  (l.model === null || isStr(l.model)) &&
  isColor(l.color);
const isDmg = (v: unknown) => isNum(v) && (v as number) >= 0 && (v as number) <= DMG_MAX;
const isPose = (p: { x: number; z: number; h: number }) =>
  !!p && within(p.x, MAX_POS_M) && within(p.z, MAX_POS_M) && within(p.h, MAX_ANGLE_RAD);
type IsTime = (t: unknown) => boolean;
const isSnap = (s: Snapshot, isTime: IsTime, isPast: IsTime) =>
  isPose(s) &&
  isTime(s.t) &&
  within(s.vh, MAX_ANGLE_RAD) &&
  within(s.v, MAX_SPEED_MS) &&
  within(s.y, MAX_HEIGHT_M) &&
  within(s.phase, 1e9) &&
  (s.car === null || (!!s.car && isStr(s.car.id) && isPast(s.car.since) && isDmg(s.car.dmg) && isLook(s.car.look)));
const isResting = (r: RestingCar, isPast: IsTime) =>
  isPose(r) && isStr(r.id) && isPast(r.t) && isDmg(r.dmg) && isLook(r.look);
// What a peer sends is input from outside: only whole messages with numbers in range and known car types get in.
// Times are checked against the room's now as this player knows it: a player still finding the room's clock may
// drop a moment of snapshots from a computer whose clock is far off, which the next ones make up for.
const valid = (m: Message, now: number) => {
  const isTime = (t: unknown) => isNum(t) && Math.abs((t as number) - now) <= MAX_TIME_OFF_MS,
    isPast = (t: unknown) => isNum(t) && (t as number) - now <= MAX_TIME_OFF_MS;
  return (
    !!m &&
    (m.snap === undefined || isSnap(m.snap, isTime, isPast)) &&
    (m.cars === undefined ||
      (Array.isArray(m.cars) && m.cars.length <= MAX_CARS && m.cars.every(r => isResting(r, isPast)))) &&
    (m.ping === undefined ||
      (!!m.ping &&
        isNum(m.ping.t) &&
        isNum(m.ping.age) &&
        m.ping.age >= 0 &&
        (m.ping.keeper === undefined || isStr(m.ping.keeper)))) &&
    (m.pong === undefined || (!!m.pong && isStr(m.pong.to) && isNum(m.pong.t) && isNum(m.pong.at)))
  );
};

type Shown = { buffer: SnapshotBuffer; snapAt: number }; // a player's snapshots, and when one last came (ms, this clock)

/** This player in a room. `update` runs every frame. */
export class Session {
  private readonly g: SessionDeps;
  private readonly cars: SharedCars;
  private readonly shown = new Map<string, Shown>();
  // when each other player last sent anything (ms, this clock). A tab in the background still answers pings, but
  // sends no snapshots: it stays in the room, and is not shown
  private readonly heard = new Map<string, number>();
  private readonly out = blankSnapshot();
  private sendIn = 0;
  // the room's clock
  private readonly born: number;
  private readonly borns = new Map<string, number>(); // when each other player joined, by this clock
  private readonly claims = new Map<string, string>(); // whose clock each settled player follows
  private keeper: string; // whose clock is the room's
  private offset = 0; // the room's time minus this clock's (ms)
  private sure = true; // false between hearing of a new keeper and their first answer
  private readings: { rtt: number; offset: number }[] = [];
  private pingIn = 0;
  private lastFrame: number; // this clock at the last update: a long gap means the tab was in the background

  constructor(g: SessionDeps) {
    this.g = g;
    const { transport } = g;
    this.born = this.lastFrame = g.clock();
    this.keeper = transport.me;
    this.cars = new SharedCars({ ...g.cars, me: transport.me, tell: list => this.send({ cars: list }, true) });
    transport.receive = this.receive;
    transport.left = this.drop;
  }

  /** how many other players are shown */
  get peers() {
    return this.shown.size;
  }

  /** the room's time (ms) */
  get now() {
    return this.g.clock() + this.offset;
  }

  private send(m: Message, reliable: boolean) {
    this.g.transport.send(m, reliable);
  }

  private receive = (from: string, data: unknown) => {
    const m = data as Message,
      { me } = this.g.transport;
    if (!isStr(from) || from === me || !valid(m, this.now)) return;
    const clock = this.g.clock();
    this.heard.set(from, clock);
    if (m.ping) {
      this.borns.set(from, clock - m.ping.age);
      if (m.ping.keeper === undefined) this.claims.delete(from);
      else this.claims.set(from, m.ping.keeper);
      this.pickKeeper();
      if (this.sure) this.send({ pong: { to: from, t: m.ping.t, at: this.now } }, false);
    }
    if (m.pong && m.pong.to === me && from === this.keeper) this.read(m.pong);
    if (m.cars) this.cars.hear(m.cars);
    if (!m.snap) return;
    let peer = this.shown.get(from);
    if (!peer) {
      peer = { buffer: new SnapshotBuffer(), snapAt: 0 };
      this.shown.set(from, peer);
      // someone new: every player says where cars were left, and the newest word about each car wins
      const { known } = this.cars;
      for (let i = 0; i < known.length; i += MAX_CARS) this.send({ cars: known.slice(i, i + MAX_CARS) }, true);
    }
    if (m.snap.t < peer.buffer.newest - RESTART_MS) peer.buffer = new SnapshotBuffer();
    peer.snapAt = this.g.clock();
    peer.buffer.push(m.snap);
  };

  // the room's clock is the clock of the player who joined first; two who joined about together are told apart by id
  private pickKeeper() {
    const { me } = this.g.transport;
    let keeper = me,
      born = this.born;
    for (const [id, b] of this.borns)
      if (b < born - JOIN_TIE_MS || (Math.abs(b - born) <= JOIN_TIE_MS && id < keeper)) {
        keeper = id;
        born = b;
      }
    // Near the edge of a tie, two players can each count themselves the oldest: each sees the other a network delay
    // late. Both say so in their pings, and the one with the higher id follows the other.
    if (keeper === me)
      for (const [id, claim] of this.claims)
        if (claim === id && id < keeper && Math.abs(this.borns.get(id)! - this.born) <= 2 * JOIN_TIE_MS) keeper = id;
    if (keeper === this.keeper) return;
    this.keeper = keeper;
    this.readings = [];
    // a keeper who left: this player carries the room's time on as it was. A new one: ask them at once
    this.sure = keeper === me;
    this.pingIn = 0;
  }

  // the keeper's answer: the room's time was `at` about halfway between asking and now
  private read(pong: Pong) {
    const t1 = this.g.clock(),
      rtt = t1 - pong.t;
    if (rtt < 0) return;
    this.readings.push({ rtt, offset: pong.at - (pong.t + rtt / 2) });
    if (this.readings.length > PINGS_KEPT) this.readings.shift();
    const best = this.readings.reduce((a, b) => (b.rtt < a.rtt ? b : a));
    // every time kept so far was on the old clock: start the others' snapshots afresh, and move the cars' times over
    if (Math.abs(best.offset - this.offset) > CLOCK_JUMP_MS) {
      for (const p of this.shown.values()) p.buffer = new SnapshotBuffer();
      this.cars.shift(best.offset - this.offset);
    }
    this.offset = best.offset;
    this.sure = true;
  }

  // the player is gone from the room
  private drop = (peer: string) => {
    this.heard.delete(peer);
    this.borns.delete(peer);
    this.claims.delete(peer);
    this.pickKeeper();
    this.hide(peer);
  };

  // the player is not seen any more; the car they drove stays where it stands
  private hide(peer: string) {
    if (!this.shown.delete(peer)) return;
    this.g.remotes.remove(peer);
    this.cars.remove(peer, this.now);
  }

  /** Leaves the room: hears nothing more, and takes the others away, letting go of the cars they drove. */
  // fallow-ignore-next-line unused-class-member -- main.ts calls it through a type of its own, as it loads the session behind the flag
  leave() {
    const { transport } = this.g;
    transport.receive = () => {};
    transport.left = () => {};
    transport.close();
    for (const id of [...this.shown.keys()]) this.hide(id);
  }

  /** One frame of `dt` s: sends when it is time, and shows the others. */
  update(dt: number) {
    const { g, cars, out } = this,
      clock = g.clock(),
      now = clock + this.offset;
    // back from the background: the others let go of this player's car meanwhile, so the claim on it starts again
    if (clock - this.lastFrame > SILENT_MS) this.cars.claimAgain(now);
    this.lastFrame = clock;
    this.pingIn -= dt;
    if (this.pingIn <= 0) {
      this.pingIn = this.sure ? PING_S : PING_UNSURE_S;
      const age = clock - this.born;
      this.send({ ping: { t: clock, age, keeper: age > SETTLED_MS ? this.keeper : undefined } }, false);
    }
    this.sendIn -= dt;
    // a time on the wrong clock would be worse than a short silence
    if (this.sendIn <= 0 && this.sure) {
      this.sendIn = 1 / SEND_HZ;
      this.send({ snap: { ...g.local(), car: cars.local(now), t: now } }, false);
    }
    for (const [id, at] of this.heard) if (clock - at > SILENT_MS) this.drop(id);
    for (const [id, peer] of this.shown) {
      if (clock - peer.snapAt > SILENT_MS) this.hide(id);
      else if (peer.buffer.sample(now - INTERP_DELAY_MS, out)) {
        cars.show(id, out);
        g.remotes.show(id, out);
      }
    }
  }
}
