// Multiplayer prototype (lab: multiplayer, docs/multiplayer.md): the tabs connector. Every tab of this browser with
// the same room is in it, over a BroadcastChannel: nothing leaves the computer, and every message arrives, in order.
// Page code: it uses the channel and the page's events.
import type { Transport } from './transport';

type Envelope = { from: string; data?: unknown; bye?: true };

/** Joins the room of that name. */
export function tabsTransport(room: string): Transport {
  const me = crypto.randomUUID(),
    channel = new BroadcastChannel('joyride:' + room),
    post = (e: Envelope) => channel.postMessage(e);
  const transport: Transport = {
    me,
    send: data => post({ from: me, data }),
    receive: () => {},
    left: () => {},
    close: () => {
      post({ from: me, bye: true });
      channel.close();
    },
  };
  channel.onmessage = e => {
    const m = e.data as Envelope | null;
    if (typeof m?.from !== 'string') return;
    if (m.bye) transport.left(m.from);
    else transport.receive(m.from, m.data);
  };
  addEventListener('pagehide', transport.close);
  return transport;
}
