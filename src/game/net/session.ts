// Multiplayer prototype (lab: multiplayer, docs/multiplayer.md): the session. It sends this player's snapshots over
// a transport, draws the others' a little in the past, keeps the shared cars, and keeps the room's clock. It knows
// the game's messages and nothing of how they travel, so any connector can carry it. No three.js or DOM here.
import { VEHICLE_SPECS } from '../sim/vehicle-spec';
import { type RestingCar, SharedCars, type SharedCarsDeps } from './shared-cars';
import { blankSnapshot, type CarLook, INTERP_DELAY_MS, SEND_HZ, type Snapshot, SnapshotBuffer } from './snapshots';
import type { Transport } from './transport';

export const SILENT_MS = 3000; // a player not heard from this long has gone (closed, or in the background, where frames stop)
const MAX_CARS = 500; // more resting cars than this in one message is not a village
// The room's clock. Two computers' clocks can be seconds apart, and every time in a message (a snapshot's, when a
// player got into a car, when a car was left) has to mean the same to all. So the players agree on one of them, the
// one who has been in the room longest, and each keeps the difference between that player's clock and their own.
const PING_S = 1, // how often a player asks the others what time it is
  PING_UNSURE_S = 0.25, // and how often while they don't know the room's time yet
  PINGS_KEPT = 8, // the answer that came back fastest of this many is the one believed: it sat least in a queue
  CLOCK_JUMP_MS = 100, // a change this big in the room's time is a new clock, not a better reading of the same one
  RESTART_MS = 1000; // a snapshot this much older than a player's newest is from a new clock too

/** Asks what the room's time is. `born` is when the asker joined, by their own clock: the lowest is the room's clock. */
type Ping = { t: number; born: number };
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
const isStr = (v: unknown) => typeof v === 'string' && v.length < 80;
const isLook = (l: CarLook) =>
  !!l && Object.hasOwn(VEHICLE_SPECS, l.type) && (l.model === null || isStr(l.model)) && isStr(l.color);
const isPose = (p: { x: number; z: number; h: number }) => !!p && isNum(p.x) && isNum(p.z) && isNum(p.h);
const isSnap = (s: Snapshot) =>
  isPose(s) &&
  [s.t, s.vh, s.v, s.y, s.phase].every(isNum) &&
  (s.car === null || (!!s.car && isStr(s.car.id) && isNum(s.car.since) && isNum(s.car.dmg) && isLook(s.car.look)));
const isResting = (r: RestingCar) => isPose(r) && isStr(r.id) && isNum(r.t) && isNum(r.dmg) && isLook(r.look);
// what a peer sends is input from outside: only whole messages with real numbers and known car types get in
const valid = (m: Message) =>
  !!m &&
  (m.snap === undefined || isSnap(m.snap)) &&
  (m.cars === undefined || (Array.isArray(m.cars) && m.cars.length <= MAX_CARS && m.cars.every(isResting))) &&
  (m.ping === undefined || (!!m.ping && isNum(m.ping.t) && isNum(m.ping.born))) &&
  (m.pong === undefined || (!!m.pong && isStr(m.pong.to) && isNum(m.pong.t) && isNum(m.pong.at)));

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
  private readonly borns = new Map<string, number>(); // when each other player joined, by their own clock
  private keeper: string; // whose clock is the room's
  private offset = 0; // the room's time minus this clock's (ms)
  private sure = true; // false between hearing of a new keeper and their first answer
  private readings: { rtt: number; offset: number }[] = [];
  private pingIn = 0;

  constructor(g: SessionDeps) {
    this.g = g;
    const { transport } = g;
    this.born = g.clock();
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
    if (!isStr(from) || from === me || !valid(m)) return;
    this.heard.set(from, this.g.clock());
    if (m.ping) {
      this.borns.set(from, m.ping.born);
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
      if (this.cars.known.length) this.send({ cars: this.cars.known }, true);
    }
    if (m.snap.t < peer.buffer.newest - RESTART_MS) peer.buffer = new SnapshotBuffer();
    peer.snapAt = this.g.clock();
    peer.buffer.push(m.snap);
  };

  // the room's clock is the clock of the player who joined first; two who say the same moment are told apart by id
  private pickKeeper() {
    const { me } = this.g.transport;
    let keeper = me,
      born = this.born;
    for (const [id, b] of this.borns)
      if (b < born || (b === born && id < keeper)) {
        keeper = id;
        born = b;
      }
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
    // every time kept so far was on the old clock: start the others' snapshots afresh
    if (Math.abs(best.offset - this.offset) > CLOCK_JUMP_MS)
      for (const p of this.shown.values()) p.buffer = new SnapshotBuffer();
    this.offset = best.offset;
    this.sure = true;
  }

  // the player is gone from the room
  private drop = (peer: string) => {
    this.heard.delete(peer);
    this.borns.delete(peer);
    this.pickKeeper();
    this.hide(peer);
  };

  // the player is not seen any more; the car they drove stays where it stands
  private hide(peer: string) {
    if (!this.shown.delete(peer)) return;
    this.g.remotes.remove(peer);
    this.cars.remove(peer, this.now);
  }

  /** One frame of `dt` s: sends when it is time, and shows the others. */
  update(dt: number) {
    const { g, cars, out } = this,
      clock = g.clock();
    this.pingIn -= dt;
    if (this.pingIn <= 0) {
      this.pingIn = this.sure ? PING_S : PING_UNSURE_S;
      this.send({ ping: { t: clock, born: this.born } }, false);
    }
    const now = clock + this.offset;
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
