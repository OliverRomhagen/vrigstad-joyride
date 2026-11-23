// Multiplayer prototype (lab: multiplayer, docs/multiplayer.md): the session. It sends this player's snapshots over
// a transport, draws the others' a little in the past, and keeps the shared cars. It knows the game's messages and
// nothing of how they travel, so any connector can carry it. No three.js or DOM here.
import { VEHICLE_SPECS } from '../sim/vehicle-spec';
import { type RestingCar, SharedCars, type SharedCarsDeps } from './shared-cars';
import { blankSnapshot, type CarLook, INTERP_DELAY_MS, SEND_HZ, type Snapshot, SnapshotBuffer } from './snapshots';
import type { Transport } from './transport';

export const SILENT_MS = 3000; // a player not heard from this long has gone (closed, or in the background, where frames stop)
const MAX_CARS = 500; // more resting cars than this in one message is not a village

// snapshots are sent again 15 times a second, so one may be lost; where a car was left is said once, so it may not
type Message = { snap?: Snapshot; cars?: RestingCar[] };

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
  (m.cars === undefined || (Array.isArray(m.cars) && m.cars.length <= MAX_CARS && m.cars.every(isResting)));

/** This player in a room. `update` runs every frame. */
export class Session {
  private readonly g: SessionDeps;
  private readonly cars: SharedCars;
  private readonly buffers = new Map<string, SnapshotBuffer>();
  private readonly out = blankSnapshot();
  private sendIn = 0;
  private now = 0;

  constructor(g: SessionDeps) {
    this.g = g;
    const { transport } = g;
    this.cars = new SharedCars({ ...g.cars, me: transport.me, tell: list => this.send({ cars: list }, true) });
    transport.receive = this.receive;
    transport.left = this.drop;
  }

  /** how many other players are shown */
  get peers() {
    return this.buffers.size;
  }

  private send(m: Message, reliable: boolean) {
    this.g.transport.send(m, reliable);
  }

  private receive = (from: string, data: unknown) => {
    const m = data as Message;
    if (!isStr(from) || from === this.g.transport.me || !valid(m)) return;
    if (m.cars) this.cars.hear(m.cars);
    if (!m.snap) return;
    let buffer = this.buffers.get(from);
    if (!buffer) {
      buffer = new SnapshotBuffer();
      this.buffers.set(from, buffer);
      // someone new: every player says where cars were left, and the newest word about each car wins
      if (this.cars.known.length) this.send({ cars: this.cars.known }, true);
    }
    buffer.push(m.snap);
  };

  private drop = (peer: string) => {
    if (!this.buffers.delete(peer)) return;
    this.g.remotes.remove(peer);
    this.cars.remove(peer, this.now);
  };

  /** One frame of `dt` s at `now` (ms, on the clock the players share): sends when it is time, and shows the others. */
  update(dt: number, now: number) {
    const { g, cars, out } = this;
    this.now = now;
    this.sendIn -= dt;
    if (this.sendIn <= 0) {
      this.sendIn = 1 / SEND_HZ;
      this.send({ snap: { ...g.local(), car: cars.local(now), t: now } }, false);
    }
    for (const [peer, buffer] of this.buffers) {
      if (now - buffer.newest > SILENT_MS) this.drop(peer);
      else if (buffer.sample(now - INTERP_DELAY_MS, out)) {
        cars.show(peer, out);
        g.remotes.show(peer, out);
      }
    }
  }
}
