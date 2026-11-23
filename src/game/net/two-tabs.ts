// Multiplayer prototype (lab: multiplayer, docs/multiplayer.md): the two-tab connector and its session in one file.
// Every tab of this browser with the same room sends its own player on a BroadcastChannel and draws the others'.
// Page code: it uses the channel and the page's clock. A throwaway: the real thing splits transport from session.
import type { RemotePlayers } from '../render/remote-players';
import { blankSnapshot, INTERP_DELAY_MS, SEND_HZ, type Snapshot, SnapshotBuffer } from './snapshots';

const SILENT_MS = 3000; // a tab not heard from this long has gone (closed, or in the background, where frames stop)

type Message = { id: string; snap?: Snapshot; bye?: true };

/** What the two-tab session reads from the game. */
export interface TwoTabsDeps {
  room: string;
  /** this tab's player now; `t` is filled in here */
  local(): Omit<Snapshot, 't'>;
  /** draws a remote player at a state, and takes one away */
  remotes: Pick<RemotePlayers, 'show' | 'remove'>;
}

const isNum = (v: unknown) => typeof v === 'number' && Number.isFinite(v);
// what a peer sends is input from outside: only a snapshot with real numbers gets in
const valid = (m: Message) =>
  !!m && typeof m.id === 'string' && (m.bye || (!!m.snap && isNum(m.snap.t) && isNum(m.snap.x) && isNum(m.snap.z)));

/** Joins the room. `update` runs every frame; `peers` is how many other tabs are shown. */
export function startTwoTabs(g: TwoTabsDeps) {
  const id = crypto.randomUUID(),
    channel = new BroadcastChannel('joyride:' + g.room),
    peers = new Map<string, SnapshotBuffer>(),
    out = blankSnapshot();
  let sendIn = 0;

  const drop = (peer: string) => {
    if (peers.delete(peer)) g.remotes.remove(peer);
  };
  channel.onmessage = e => {
    const m = e.data as Message;
    if (!valid(m) || m.id === id) return;
    if (m.bye) return drop(m.id);
    let buffer = peers.get(m.id);
    if (!buffer) {
      buffer = new SnapshotBuffer();
      peers.set(m.id, buffer);
    }
    buffer.push(m.snap!);
  };
  addEventListener('pagehide', () => channel.postMessage({ id, bye: true } satisfies Message));

  return {
    get peers() {
      return peers.size;
    },
    update(dt: number) {
      const now = Date.now(); // tabs of one browser share the computer's clock, so no clock sync yet
      sendIn -= dt;
      if (sendIn <= 0) {
        sendIn = 1 / SEND_HZ;
        channel.postMessage({ id, snap: { ...g.local(), t: now } } satisfies Message);
      }
      for (const [peer, buffer] of peers) {
        if (now - buffer.newest > SILENT_MS) drop(peer);
        else if (buffer.sample(now - INTERP_DELAY_MS, out)) g.remotes.show(peer, out);
      }
    },
  };
}
