// Multiplayer prototype (lab: multiplayer, docs/multiplayer.md): the connectors by name. Each one is loaded only
// when it is picked, so a connector nobody uses costs no download. A new one (webrtc, relay, a backend) is a file
// that makes a Transport, and a line here. Page code: the connectors use the page's network.
import type { Transport } from './transport';

const CONNECTORS: Readonly<Record<string, (room: string) => Promise<Transport>>> = {
  tabs: async room => (await import('./tabs-transport')).tabsTransport(room),
  webrtc: async () => (await import('./webrtc-transport')).webrtcTransport(), // its room is whoever swapped invites
};

const connectorNames = () => Object.keys(CONNECTORS);

/** Joins `room` over the connector of that name. */
export function connect(name: string, room: string): Promise<Transport> {
  if (!Object.hasOwn(CONNECTORS, name))
    throw new Error('No connector called ' + name + '. There is: ' + connectorNames().join(', ') + '.');
  return CONNECTORS[name](room);
}
