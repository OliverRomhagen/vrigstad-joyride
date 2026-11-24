// Multiplayer prototype (lab: multiplayer, docs/multiplayer.md): joins the room the page's address names and connects
// the session to the game. ?net= picks the connector (tabs by default, or webrtc) and ?room= the room (torget).
// Page code: it reads the address, and shows the invite panel for a connector that joins by codes.
import type { Car } from '../cars';
import { RemotePlayers, type RemotePlayersDeps } from '../render/remote-players';
import type { GameState } from '../state';
import { connect } from './connectors';
import { Session } from './session';
import type { CarLook } from './snapshots';

/** What multiplayer reads from the game, and the few things it does to it. */
export interface MultiplayerDeps {
  stage: HTMLElement;
  game: Pick<GameState, 'inCar' | 'pcar'>;
  player: { x: number; z: number; h: number; speed: number; y: number; phase: number };
  /** whether the player is inside a safehouse */
  inside: () => boolean;
  cars: readonly Car[];
  /** the cars parked when the village was built, taken before anyone could drive one */
  seeded: readonly Car[];
  remotes: RemotePlayersDeps;
  /** the vehicle id of a car's model, if it wears one */
  modelOf: (c: Car) => string | null;
  /** makes a car nobody drives, as another player's looks, and adds it to the village */
  addCar: (look: CarLook, x: number, z: number, h: number) => Car;
  removeCar: (c: Car) => void;
  placeCar: (c: Car) => void;
  /** puts the player back on their feet */
  getOut: () => void;
  toast: (text: string, seconds: number) => void;
}

/** This player in a room, as the game's loop sees it. */
export interface Multiplayer {
  /** one frame of `dt` s */
  update(dt: number): void;
  /** how many other players are shown */
  readonly peers: number;
}

/** Joins the room, and shows the invite panel when the connector needs one. */
export async function startMultiplayer(g: MultiplayerDeps): Promise<Multiplayer> {
  const query = new URLSearchParams(location.search),
    transport = await connect(query.get('net') || 'tabs', query.get('room') || 'torget'),
    driven = () => (g.game.inCar ? g.game.pcar : null);
  const session = new Session({
    clock: Date.now,
    transport,
    remotes: new RemotePlayers(g.remotes),
    local: () => {
      const c = driven(),
        p = g.player;
      return c
        ? { x: c.x, z: c.z, h: c.h, vh: c.vh, v: c.v, y: 0, phase: 0, hidden: false }
        : { x: p.x, z: p.z, h: p.h, vh: p.h, v: p.speed, y: p.y, phase: p.phase, hidden: g.inside() };
    },
    cars: {
      cars: g.cars,
      seeded: g.seeded,
      driven,
      look: c => ({ type: c.type, model: g.modelOf(c), color: c.color }),
      addCar: g.addCar,
      removeCar: g.removeCar,
      placeCar: g.placeCar,
      lostCar: () => {
        g.getOut();
        g.toast('Someone else got in first.', 2);
      },
    },
  });
  const { invites } = transport;
  if (invites)
    (await import('./invite-panel')).showInvitePanel({ stage: g.stage, invites, peers: () => session.peers });

  let running = true;
  return {
    // A throw turns multiplayer off with a warning: thrown every frame, it would stop each frame before the drawing.
    // Leaving lets go of the cars the others drove.
    update(dt) {
      if (!running) return;
      try {
        session.update(dt);
      } catch (err) {
        running = false;
        console.warn('Lab: multiplayer stopped', err);
        try {
          session.leave();
        } catch (e) {
          console.warn('Lab: multiplayer could not leave', e);
        }
      }
    },
    get peers() {
      return running ? session.peers : 0;
    },
  };
}
