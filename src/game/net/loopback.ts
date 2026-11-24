// Multiplayer prototype (lab: multiplayer, docs/multiplayer.md): the loopback connector, a room in memory. It can
// be as bad as a real network (late, uneven, lossy), on a clock the caller moves, so a test of two sessions in one
// process gives the same result every run.
import { makeRnd } from '../../world/random';
import type { Transport } from './transport';

/** How bad the room's network is. */
export interface Link {
  lagMs: number; // every message is at least this late
  jitterMs: number; // and up to this much later, so messages that aren't reliable overtake each other
  loss: number; // the share (0–1) of messages that aren't reliable that never arrive
}

type Packet = { due: number; n: number; from: string; to: string; data: unknown };

/** A room in memory. `join` gives each player a transport; `advance` delivers what is due. */
export class LoopbackHub {
  private readonly link: Link;
  private readonly rnd: () => number;
  private readonly ends = new Map<string, Transport>();
  private readonly lastReliable = new Map<string, number>(); // when the last reliable message from → to is due
  private queue: Packet[] = [];
  private now = 0;
  private sent = 0;

  constructor(link: Partial<Link> = {}, seed = 1) {
    this.link = { lagMs: 0, jitterMs: 0, loss: 0, ...link };
    this.rnd = makeRnd(seed);
  }

  join(me: string): Transport {
    const end: Transport = {
      me,
      send: (data, reliable) => this.send(me, data, reliable),
      receive: () => {},
      left: () => {},
      close: () => {
        if (!this.ends.delete(me)) return;
        for (const other of this.ends.values()) other.left(me);
      },
    };
    this.ends.set(me, end);
    return end;
  }

  private send(from: string, data: unknown, reliable: boolean) {
    const { lagMs, jitterMs, loss } = this.link,
      wire = JSON.stringify(data); // what crosses is a copy, and only what is plain data
    for (const to of this.ends.keys()) {
      if (to === from) continue;
      if (!reliable && this.rnd() < loss) continue;
      let due = this.now + lagMs + this.rnd() * jitterMs;
      if (reliable) {
        const pair = from + '>' + to;
        due = Math.max(due, this.lastReliable.get(pair) ?? 0); // reliable messages keep their order
        this.lastReliable.set(pair, due);
      }
      this.queue.push({ due, n: this.sent++, from, to, data: JSON.parse(wire) });
    }
  }

  /** Moves the room's clock to `now` (ms) and delivers every message due by then, in the order they are due. */
  advance(now: number) {
    this.now = now;
    const due = this.queue.filter(p => p.due <= now).sort((a, b) => a.due - b.due || a.n - b.n);
    this.queue = this.queue.filter(p => p.due > now);
    for (const p of due) this.ends.get(p.to)?.receive(p.from, p.data);
  }
}
