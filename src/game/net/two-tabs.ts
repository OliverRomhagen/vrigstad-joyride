// Multiplayer prototype (lab: multiplayer, docs/multiplayer.md): the two-tab connector and its session in one file.
// Every tab of this browser with the same room sends its own player on a BroadcastChannel and draws the others'.
// Page code: it uses the channel and the page's clock. A throwaway: the real thing splits transport from session.
import type { RemotePlayers } from '../render/remote-players';
import { VEHICLE_SPECS } from '../sim/vehicle-spec';
import { type RestingCar, SharedCars, type SharedCarsDeps } from './shared-cars';
import { blankSnapshot, type CarLook, INTERP_DELAY_MS, SEND_HZ, type Snapshot, SnapshotBuffer } from './snapshots';

const SILENT_MS = 3000; // a tab not heard from this long has gone (closed, or in the background, where frames stop)
const MAX_CARS = 500; // more resting cars than this in one message is not a village

type Message = { id: string; snap?: Snapshot; cars?: RestingCar[]; bye?: true };

/** What the two-tab session reads from the game. */
export interface TwoTabsDeps {
  room: string;
  /** this tab's player now, or the car they drive; `t` and `car` are filled in here */
  local(): Omit<Snapshot, 't' | 'car'>;
  /** draws a remote player at a state, and takes one away */
  remotes: Pick<RemotePlayers, 'show' | 'remove'>;
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
  isStr(m.id) &&
  (m.snap === undefined || isSnap(m.snap)) &&
  (m.cars === undefined || (Array.isArray(m.cars) && m.cars.length <= MAX_CARS && m.cars.every(isResting)));

/** Joins the room. `update` runs every frame; `peers` is how many other tabs are shown. */
export function startTwoTabs(g: TwoTabsDeps) {
  const id = crypto.randomUUID(),
    channel = new BroadcastChannel('joyride:' + g.room),
    peers = new Map<string, SnapshotBuffer>(),
    out = blankSnapshot(),
    send = (m: Omit<Message, 'id'>) => channel.postMessage({ id, ...m } satisfies Message),
    cars = new SharedCars({ ...g.cars, me: id, tell: list => send({ cars: list }) });
  let sendIn = 0;

  const drop = (peer: string) => {
    if (!peers.delete(peer)) return;
    g.remotes.remove(peer);
    cars.remove(peer, Date.now());
  };
  channel.onmessage = e => {
    const m = e.data as Message;
    if (!valid(m) || m.id === id) return;
    if (m.bye) return drop(m.id);
    if (m.cars) cars.hear(m.cars);
    if (!m.snap) return;
    let buffer = peers.get(m.id);
    if (!buffer) {
      buffer = new SnapshotBuffer();
      peers.set(m.id, buffer);
      // someone new: every tab says where cars were left, and the newest word about each car wins
      if (cars.known.length) send({ cars: cars.known });
    }
    buffer.push(m.snap);
  };
  addEventListener('pagehide', () => send({ bye: true }));

  return {
    get peers() {
      return peers.size;
    },
    update(dt: number) {
      const now = Date.now(); // tabs of one browser share the computer's clock, so no clock sync yet
      sendIn -= dt;
      if (sendIn <= 0) {
        sendIn = 1 / SEND_HZ;
        send({ snap: { ...g.local(), car: cars.local(now), t: now } });
      }
      for (const [peer, buffer] of peers) {
        if (now - buffer.newest > SILENT_MS) drop(peer);
        else if (buffer.sample(now - INTERP_DELAY_MS, out)) {
          cars.show(peer, out);
          g.remotes.show(peer, out);
        }
      }
    },
  };
}
