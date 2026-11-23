// Multiplayer prototype (lab: multiplayer, docs/multiplayer.md): the webrtc connector. Two browsers talk straight to
// each other, with no server of ours in between. To find each other they need to swap a description of how to be
// reached; here the players carry it by hand, as a code one pastes to the other and a reply code back.
// Page code: it uses RTCPeerConnection.
//
// What a player gives away: the codes hold their network addresses, and the friend they connect to sees the address
// they connect from. To be reached from outside their home network a browser asks a STUN server what its public
// address is; that server sees the address, and nothing of the game. ?stun=off asks none (same network only), and
// ?stun=host:port asks another one.
import type { Invites, Transport } from './transport';

// Cloudflare's public one: its docs say anyone may use it, free. Ours to pick again when the game has a server
const DEFAULT_STUN = 'stun.cloudflare.com:3478';
const CODE_PREFIX = 'vj1.'; // a code of another version is refused, not misread
const MAX_CODE_CHARS = 20_000,
  MAX_SIGNAL_BYTES = 64_000, // what a code may unpack to: a pasted code is input from outside
  MAX_MESSAGE_CHARS = 256_000;
const GATHER_MS = 4000; // wait this long for the browser to find its addresses, then go with what it has
const FAST_BACKLOG_BYTES = 64_000; // with this much unsent, a snapshot is skipped: a newer one follows

/** What a code holds. `invite` ties a reply to its invite, so a host can have several out at once. */
type Signal = { from: string; invite: string; type: 'offer' | 'answer'; sdp: string };
type Link = { pc: RTCPeerConnection; reliable: RTCDataChannel; fast: RTCDataChannel };

const b64 = (bytes: Uint8Array) =>
  btoa(String.fromCharCode(...bytes))
    .replaceAll('+', '-')
    .replaceAll('/', '_')
    .replaceAll('=', '');
const unb64 = (s: string) => Uint8Array.from(atob(s.replaceAll('-', '+').replaceAll('_', '/')), c => c.charCodeAt(0));

// through a compression stream, reading at most `max` bytes of what comes out
async function pipe(bytes: Uint8Array<ArrayBuffer>, through: CompressionStream | DecompressionStream, max: number) {
  const reader = new Blob([bytes]).stream().pipeThrough(through).getReader(),
    chunks: Uint8Array[] = [];
  let size = 0;
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    size += value.length;
    if (size > max) {
      void reader.cancel();
      throw new Error('too big');
    }
    chunks.push(value);
  }
  const out = new Uint8Array(size);
  let at = 0;
  for (const c of chunks) {
    out.set(c, at);
    at += c.length;
  }
  return out;
}

async function pack(signal: Signal) {
  const bytes = new TextEncoder().encode(JSON.stringify(signal));
  return CODE_PREFIX + b64(await pipe(bytes, new CompressionStream('deflate-raw'), MAX_SIGNAL_BYTES));
}

async function unpack(code: string, type: Signal['type']): Promise<Signal> {
  const wrong = new Error(
    type === 'offer' ? 'That is not an invite code.' : 'That is not a reply code. Paste the code your friend got.',
  );
  const text = code.trim();
  if (!text.startsWith(CODE_PREFIX) || text.length > MAX_CODE_CHARS) throw wrong;
  let s: Signal;
  try {
    const bytes = await pipe(
      unb64(text.slice(CODE_PREFIX.length)),
      new DecompressionStream('deflate-raw'),
      MAX_SIGNAL_BYTES,
    );
    s = JSON.parse(new TextDecoder().decode(bytes));
  } catch {
    throw wrong;
  }
  const isStr = (v: unknown) => typeof v === 'string' && v.length < 80;
  if (!s || !isStr(s.from) || !isStr(s.invite) || s.type !== type || typeof s.sdp !== 'string') throw wrong;
  return s;
}

/** The STUN server to ask, as host:port, or '' for none. */
function stunServer() {
  const stun = new URLSearchParams(location.search).get('stun') ?? DEFAULT_STUN;
  return stun === 'off' ? '' : stun;
}

function iceServers(): RTCIceServer[] {
  const stun = stunServer();
  return stun ? [{ urls: 'stun:' + stun }] : [];
}

// the description with every address the browser found in it, so one code carries all of it
async function described(pc: RTCPeerConnection) {
  if (pc.iceGatheringState !== 'complete')
    await new Promise<void>(done => {
      const check = () => {
        if (pc.iceGatheringState !== 'complete') return;
        clearTimeout(timer);
        pc.removeEventListener('icegatheringstatechange', check);
        done();
      };
      const timer = setTimeout(done, GATHER_MS);
      pc.addEventListener('icegatheringstatechange', check);
    });
  return pc.localDescription!.sdp;
}

/** A room of browsers connected straight to each other. Nobody is in it until an invite is swapped. */
export function webrtcTransport(): Transport & { invites: Invites } {
  const me = crypto.randomUUID(),
    links = new Map<string, Link>(), // the players connected, by id
    pending = new Map<string, Link>(); // invites out, by invite id, waiting for their reply

  // both ends make the same two channels, so neither waits for the other to open them
  function makeLink(): Link {
    const pc = new RTCPeerConnection({ iceServers: iceServers() });
    return {
      pc,
      reliable: pc.createDataChannel('reliable', { negotiated: true, id: 0 }),
      fast: pc.createDataChannel('fast', { negotiated: true, id: 1, ordered: false, maxRetransmits: 0 }),
    };
  }

  // who the other end is comes from the code they sent, never from a message: nobody can speak as someone else
  function connect(link: Link, peer: string) {
    const { pc, reliable, fast } = link;
    const gone = () => {
      if (links.get(peer) !== link) return;
      links.delete(peer);
      pc.close();
      transport.left(peer);
    };
    const hear = (e: MessageEvent) => {
      if (typeof e.data !== 'string' || e.data.length > MAX_MESSAGE_CHARS) return;
      let data: unknown;
      try {
        data = JSON.parse(e.data);
      } catch {
        return;
      }
      transport.receive(peer, data);
    };
    reliable.onmessage = fast.onmessage = hear;
    reliable.onopen = () => {
      links.get(peer)?.pc.close(); // the same player connecting again
      links.set(peer, link);
    };
    reliable.onclose = gone;
    pc.onconnectionstatechange = () => {
      if (pc.connectionState === 'failed' || pc.connectionState === 'closed') gone();
    };
  }

  const stun = stunServer();
  const invites: Invites = {
    notice: stun
      ? 'Making a code asks ' + stun + ' for your public address. Your friend sees your address too.'
      : 'Making a code asks no server, so it only works on the same network. Your friend sees your address.',
    async invite() {
      const link = makeLink(),
        invite = crypto.randomUUID();
      await link.pc.setLocalDescription(await link.pc.createOffer());
      pending.set(invite, link);
      return pack({ from: me, invite, type: 'offer', sdp: await described(link.pc) });
    },
    async accept(code) {
      const offer = await unpack(code, 'offer');
      if (offer.from === me) throw new Error('That is your own invite. Send it to a friend.');
      const link = makeLink();
      try {
        await link.pc.setRemoteDescription({ type: 'offer', sdp: offer.sdp });
        await link.pc.setLocalDescription(await link.pc.createAnswer());
      } catch {
        link.pc.close();
        throw new Error('That invite code is damaged. Ask for a new one.');
      }
      connect(link, offer.from);
      return pack({ from: me, invite: offer.invite, type: 'answer', sdp: await described(link.pc) });
    },
    async finish(code) {
      const answer = await unpack(code, 'answer'),
        link = pending.get(answer.invite);
      if (!link) throw new Error('That reply is to another invite. Make a new invite and try again.');
      try {
        await link.pc.setRemoteDescription({ type: 'answer', sdp: answer.sdp });
      } catch {
        throw new Error('That reply code is damaged. Ask your friend to make it again.');
      }
      pending.delete(answer.invite);
      connect(link, answer.from);
    },
  };

  const transport: Transport & { invites: Invites } = {
    me,
    invites,
    send(data, reliable) {
      const text = JSON.stringify(data);
      for (const link of links.values()) {
        const channel = reliable ? link.reliable : link.fast;
        if (channel.readyState !== 'open' || (!reliable && channel.bufferedAmount > FAST_BACKLOG_BYTES)) continue;
        try {
          channel.send(text);
        } catch {
          // the channel closed under us: `gone` follows
        }
      }
    },
    receive: () => {},
    left: () => {},
    close() {
      for (const link of [...links.values(), ...pending.values()]) link.pc.close();
    },
  };
  addEventListener('pagehide', transport.close);
  return transport;
}
