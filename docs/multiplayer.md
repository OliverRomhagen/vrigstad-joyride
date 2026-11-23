# Multiplayer: a first design to argue with

**Status: draft for discussion. Nothing here is decided or built.** It is the baseline for #1: what the code allows
today, the direction proposed, and the questions still open. Claims about outside services and libraries are marked
*(unverified)* where nobody has checked them against current documentation.

## Goals

- **First: a few friends in one Vrigstad**, joined by a link, the way a party game works. Drop in, drop out, no lobby.
- **Then: see how far it scales**, towards large lobbies, without redesigning.
- **Plug and play.** How players connect is a connector that can be swapped: two tabs, WebRTC, a relay, a backend.
  The same pattern as the console's command registry and hooks (`docs/console.md`).
- **A backend is opt-in.** The game works without one. When one is attached, it adds abilities; nothing depends on it.
- **Single player is unchanged**, and costs nothing: no network code loads until a player joins a room.

Not goals for now: strangers in a public village (moderation, cheating), text chat (#7), voice (#84), accounts,
anything saved between sessions.

## Where the code stands

What helps:

- Cars are plain data with no meshes (`Car` in `src/game/cars.ts`), and the rules have no three.js or DOM.
- The world is built from a seed, so every client has the same roads, buildings and parked cars without sending them.
- Height never has to travel: every client has the same heightfield.
- The day cycle and the clouds run on time and a seed, so a shared clock syncs the sky for free.
- The lab (`?lab=<id>`) lets this ship switched off.

What is in the way:

- **"The player" is singular everywhere.** One `player`, one `game.inCar` and `game.pcar` (`src/game/state.ts`), one
  `Wanted.stars`. Traffic, pedestrians, cats and the police each take one target `T` ("spawn 260 m from you", "chase
  you"). This is the largest piece of work, and it is independent of every network choice.
- **The loop steps on the frame time** (`src/game/loop.ts`), not a fixed step (#49).
- **World generation and runtime rolls share one `rnd()` stream.** Traffic spawned while playing differs per client.
- **No backend exists.** The game is a static page on GitHub Pages; three.js is the only runtime dependency.

## How state is kept in step

Three models, and why the second-simplest is proposed.

| Model | How | Verdict |
|---|---|---|
| Deterministic lockstep | Only commands travel; every client runs the same sim | Not as the sync model |
| Server authority | A server runs the sim; clients predict and correct | Later, as an opt-in backend ability |
| **Ownership** | Each thing has one owner who simulates it and sends it; the rest draw it | **Proposed** |

**Why not lockstep.** `ARCHITECTURE.md` says multiplayer "needs only the commands in". That holds for a replay on one
machine. Between machines it is fragile: the rules call `Math.sin`, `Math.cos` and `Math.hypot` about 40 times, and
the language does not promise the same last bit from every browser, so one differing bit is a permanent desync. A
late joiner needs a full snapshot anyway, and the slowest phone sets everyone's pace. The commands and determinism
work (#49, #361, #366) stays worth doing for replays, tests and tutorials; the sentence in `ARCHITECTURE.md` should say
that multiplayer sends state, not only commands.

**Why not a server first.** It needs hosting, and prediction code so your own car doesn't feel late. Cheating doesn't
matter among friends. It fits later, as one ability a backend can offer (below).

### Ownership

Every moving thing has exactly one owner. The owner simulates it with the code we have, and sends its state about 15
times a second. Everyone else draws it, a little in the past, and never changes it.

| Thing | Owner | Notes |
|---|---|---|
| A player on foot | That player | |
| A car being driven | Its driver | A passenger just follows the driver's car |
| A car left standing | Its last driver, until someone else takes it | |
| Parked cars | Nobody | Same on every client from the seed; "I took car 37" is one message |
| Police | The player they chase | No host needed, and little change to `Wanted` |
| Traffic | Local at first | Becomes shared the moment someone steals it; see "Known rough edges" |
| Pedestrians, cats, confetti | Local | Share later, if ever |
| Time of day, clouds | The shared clock | |

**When two players want the same thing** (both press E at one car): someone has to order the requests. With a relay
or backend, its message order decides. Without one, the peer with the lowest id decides. The loser's client puts them
back on foot.

**Crashes between players.** Each client resolves its own car against the other's drawn car. The two sides see
slightly different crashes. That is accepted for now; a later fix is the hitter sending "I hit you this hard".

### What travels

- **Snapshots**, unreliable, about 15 Hz: a car is `x, z, h, vh, v, slip` and a few flags, about 20 bytes; a player
  on foot is less. A lost one is skipped.
- **Events**, reliable and in order: joined, left, took a car, got out, new car (type and colour), crashed, emote.
- **Hello**, once: the build, the world seed and the protocol version. Peers on different builds have different
  worlds, so they don't share a room: the room key includes the build hash. Pages deploys on every merge to `main`,
  so this will happen.

**Drawing remote things.** Each is drawn 100 to 150 ms in the past, between its two nearest snapshots, so movement is
smooth when packets arrive unevenly. When snapshots stop, it coasts briefly on its last speed, then stands still.

**The clock.** Each client estimates its offset to a shared time by ping (against the relay, or the oldest peer).
Snapshots carry that time.

## The layers

```
 game modules ──► session ──► hooks ──► transport (a connector)
 (player, cars,   (ownership,  (lag, log,  loopback · tabs · WebRTC · relay · backend
  police)          snapshots,   limits,
                   clock)       checks)
```

### Transport: the connector

A connector moves bytes between the peers of a room, and knows nothing about the game.

```ts
export interface Transport {
  readonly selfId: PeerId;
  readonly peers: readonly PeerId[];
  send(to: PeerId | 'all', data: Uint8Array, reliable: boolean): void;
  receive(fn: (from: PeerId, data: Uint8Array) => void): () => void;
  peerJoined(fn: (id: PeerId, capabilities: readonly string[]) => void): () => void;
  peerLeft(fn: (id: PeerId) => void): () => void;
  close(): void;
}

transports.register('webrtc', room => import('./webrtc').then(m => m.connect(room)));
```

Connectors register by name, as commands do, and load with `import()`, so one that isn't used is never downloaded.
A player picks one with the link (`?room=torget&net=webrtc`) or a console command (`join torget`).

| Connector | Needs | Good for | Limits |
|---|---|---|---|
| `loopback` | Nothing | Unit tests, with fake lag and loss | One process |
| `tabs` (`BroadcastChannel`) | Nothing | Development, the first demo, smoke tests | One browser on one machine |
| `webrtc` | Signalling; TURN for some networks | Friends, no server in the data path, unreliable channels | About 8 to 10 peers as a mesh; peers see each other's IP |
| `relay` (WebSocket) | One small always-on service | The dependable default; hides IPs | Reliable only, so a lost packet delays those behind it |
| `backend` | Our own server | Large lobbies, authority, persistence | Hosting and upkeep |

### Session

The session owns what is in "Ownership" and "What travels": who owns what, encoding and decoding, the buffers for
drawing remote things, the clock. It talks to a `Transport` and never knows which one. Encoding and decoding are pure
functions over plain data, so they are unit-tested without a browser.

### Hooks

Every message passes through hooks, in both directions, the way every command passes through `commands.use()`:

```ts
const stop = net.use((msg, next) => {   // msg: { from, to, kind, data, direction }
  if (msg.direction === 'in' && tooFast(msg)) return; // drop it
  next();
});
```

| Hook | What it does |
|---|---|
| Lag | Delays and drops messages (`?lag=150&loss=5`), to feel a bad connection on a good one |
| Stats | Feeds a Net tab in the console: peers, ping, bytes a second |
| Limits | Caps message size and rate per peer |
| Checks | Refuses what can't be true: a car at 400 km/h, a jump across the map, a snapshot for a thing the peer doesn't own |
| Record | Keeps a session for replaying a bug |

### Capabilities: how a backend stays opt-in

A backend joins a room as a peer, and says what it can do. A feature asks for a capability and falls back without it.

| Capability | With it | Without it |
|---|---|---|
| `relay` | Messages go through it; peers don't see each other's IP | Peers connect directly |
| `turn` | WebRTC works on networks that block direct connections | Those players can't join by WebRTC |
| `authority` | It orders contested requests, and can check claims | The lowest peer id orders them |
| `world` | It simulates traffic, police and pedestrians for everyone (needs #49) | Each owner simulates their own |
| `persistence` | Scores and rooms outlive a session | Nothing is saved |

A player's own browser can offer a capability too: a "host" is a peer with `authority`.

## WebRTC

Worth exploring as its own piece of work, though probably not the default connector.

- **For it:** unreliable data channels, so a lost snapshot never delays the next; no server carries the game's data;
  the traffic is encrypted between peers; voice (#84) would reuse the same connections.
- **Signalling is still needed** to introduce two peers. Options, cheapest first: copy and paste an invite code
  between friends (no infrastructure at all); a library that borrows public networks for signalling, such as Trystero
  *(unverified)*; our own small endpoint.
- **Some networks block direct connections**, mobile data often among them. Those need a TURN relay, which costs
  traffic and so is a backend capability. How many players this hits is worth measuring, not guessing.
- **Mesh size.** Everyone connected to everyone is `n × (n − 1) / 2` connections: 28 for 8 players, 1 225 for 50. Past
  roughly 8 to 10, traffic goes through a hub.
- **Privacy.** Peers learn each other's IP address. Fine among friends who chose each other; not for strangers. Say so
  where a player picks the connector.

## Security and privacy

A first list, for whoever takes this part:

- **Trust.** In the ownership model a client can lie about its own things, and only those. The Checks hook bounds the
  lies. Real protection needs the `authority` capability. Among friends, the first is enough.
- **Rooms.** A room code long enough not to be guessed. No list of open rooms at first.
- **Input from peers is hostile input.** Fixed-size binary messages, length checked before reading, nothing from a
  peer ever reaches the DOM as HTML or the console as a command line.
- **Dev commands.** `docs/console.md` already plans this: the registry's `allowed` refuses a guest's dev command.
- **Names.** A player's name is shown to others. Keep AGENTS.md's rule on real people in mind, and cap and clean it.
- **IP addresses** with WebRTC, above. With a relay, the relay's operator sees the traffic instead.
- **Third parties.** A signalling network or hosted relay is a new service that sees who plays with whom; name each
  in the README.

## Scaling

- **Bandwidth is not the limit.** 50 players at 15 Hz and about 40 bytes with overhead is roughly 30 kB/s down each.
- **Interest management** is the main tool: nearby players at full rate, far ones at 2 Hz for the minimap. The map
  is 2.2 km wide, so a coarse grid is enough. The session does this; connectors don't change.
- **Drawing is a limit**: 50 cars with models, on a phone.
- **Local traffic stops being believable** in a big lobby: fifty players each with their own eighteen cars. That is
  where the `world` capability is needed, and it needs the sim to run outside the page (#49).
- **Topology** changes with size: mesh for a few, a hub beyond that. The `Transport` interface hides which.

## Gameplay notes

- **Finding each other comes first.** Minimap markers, name tags, a horn, an arrow to friends, a shared start at
  Torget.
- **Riding along** in a friend's car is cheap to build and most of the fun.
- **Share what two players would talk about**: each other, cars, damage, police, the time of day. The rest can wait.
- **Modes that fit the village**: one of you drives the Polis; tag; a race between two real places; hide and seek.
  Short rounds, no lobby.
- **Light punishment.** Run over by a friend is a ragdoll and a laugh: a quick return, a few seconds of protection.
- **No pause.** The kiosk and the trisslott happen while the world goes on.
- **Stars**: your own at first. Whether a crew shares a wanted level is a design question for co-op.
- **Talking**: Discord and emotes (#296) before any chat of our own.

## Where the code goes, and tests

- `src/game/net/`: the session, encoding, the registry and hooks, as sim code (plain data, no DOM), so the
  architecture checks apply from the first commit. The connectors that touch `WebSocket`, `RTCPeerConnection` or
  `BroadcastChannel` are page modules, listed as AGENTS.md's Tests section says.
- Drawing remote players and cars: `src/game/render/`.
- Gated by `lab.on('multiplayer')`, loaded with `import()`.
- **Unit tests** with the `loopback` connector: two sessions in one process, with lag, loss and reordering.
- **A smoke test** with the `tabs` connector: two pages in one browser see each other move. The test hook gets a
  read-only list of remote players.

## Stages

1. **Two tabs.** The session, the `loopback` and `tabs` connectors, drawing a remote player and car. No
   infrastructure, and no decision about services needed. Behind the lab flag.
2. **Across the internet.** One real connector: `webrtc` with pasted invites, or the `relay`. Then the other.
3. **Playing together.** Riding along, finding each other, shared police chases, one simple mode.
4. **A shared world.** `T` becomes a list of players; a peer or a backend with `world` simulates traffic and
   pedestrians. Needs #49.
5. **Scale.** Interest management, a hub, the backend's capabilities.

## Worth doing now, whichever way this goes

- New code takes the player or target as an argument, instead of reading the one global.
- Keep a player's state (stars, health, treats, cash) apart from the world's.
- Give world generation its own `rnd()` stream, apart from runtime rolls, so "the same world from the seed" stays
  true whatever happens while playing.
- Change the "only the commands in" sentence in `ARCHITECTURE.md` once this direction is agreed.

## Known rough edges

- With local traffic, a friend swerves around cars you can't see, and can be stopped by one you can't see.
- Crashes look different on each side.
- A peer in a background tab stops stepping: its car freezes for the others. Anything that peer owns for everyone
  (a host with `authority` or `world`) needs handing over when the tab hides.
- A build mismatch splits friends until both reload.

## Open questions

- Which real connector first: `webrtc` with pasted invites (no service, more to learn) or the `relay` (one service,
  dependable)? To be decided once the two-tab stage works.
- Which relay service, and who pays and holds the account? PartyKit, which #1 suggests, is now part of Cloudflare
  *(unverified: current state and pricing)*. Netlify functions, also in #1, don't hold WebSocket connections
  *(unverified)*.
- Is a runtime dependency acceptable for a connector (a WebRTC or signalling library), given it loads only on use?
- How many players do we test for first: 4, or 8?
- Does a crew share a wanted level?
- What does a player see of others' names, and where do names come from?
