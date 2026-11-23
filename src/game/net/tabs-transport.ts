// Multiplayer prototype (lab: multiplayer, docs/multiplayer.md): the tabs connector. Every tab of this browser with
// the same room is in it, over a BroadcastChannel: nothing leaves the computer, and every message arrives, in order.
// Page code: it uses the channel and the page's events.
import type { Transport } from './transport';

type Envelope = { from: string; data?: unknown; bye?: true };

/**
 * Joins the room of that name. Each build has its own: every page of the site, the PR previews included, is one
 * origin, and a car's id or a message can mean something else in another build.
 */
export function tabsTransport(room: string): Transport {
  const me = crypto.randomUUID(),
    channel = new BroadcastChannel('joyride:' + __BUILD__ + ':' + room);
  let open = true;
  const post = (e: Envelope) => {
    if (open) channel.postMessage(e);
  };
  const transport: Transport = {
    me,
    send: data => post({ from: me, data }),
    receive: () => {},
    left: () => {},
    close: () => {
      post({ from: me, bye: true });
      open = false;
      channel.close();
    },
  };
  channel.onmessage = e => {
    const m = e.data as Envelope | null;
    if (typeof m?.from !== 'string') return;
    if (m.bye) transport.left(m.from);
    else transport.receive(m.from, m.data);
  };
  // a page the browser keeps to come back to with Back says goodbye, and stays in the room: its next snapshot,
  // when it is back, shows it to the others again. Closed, its channel would throw on every send
  addEventListener('pagehide', e => {
    if (e.persisted) post({ from: me, bye: true });
    else transport.close();
  });
  return transport;
}
