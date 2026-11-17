# Game design

What kind of game Vrigstad Joyride is, and the choices that shape the features. [ARCHITECTURE.md](ARCHITECTURE.md) is how the code is built; this file is what it builds. Read it before adding a mode, a big mechanic, or anything that changes how the game feels.

Like the decisions in ARCHITECTURE.md, each section is short and settled. Change one in a PR, so the team sees it.

## Form: witty and charming, not grim

The game is light, witty and full of character: not a children's game, and not a gritty crime simulator either. The touchstones are the LEGO games (a playful world made with care, where everything has personality) and Borderlands (whimsical and funny, but allowed to be rough now and then). You can steal an EPA-traktor, swear at the police and lose them on a gravel road; it stays fun.

- **Rough edges are fine, realism isn't the point.** Adult humour, mild cursing (the funny, Småland kind) and the odd tough moment all belong. Violence, when there is some, is over the top and stylised, played for laughs or drama, never realistic or cruel. Health and damage (#80) can hurt, but in a cartoonish way.
- **Detail and love.** Little jokes, local in-jokes, things that reward poking around (#115). A place should feel like someone cared about it.
- **Creative over grim.** Given a choice, a mechanic that lets players make or mess around with things beats one that only punishes.
- **Grimmer or more realistic play belongs in mods**, if the game becomes moddable, not in the base game.

This sits next to "Language and tone" in AGENTS.md: humour that is affectionate toward Vrigstad.

## Modes

Three modes, each playable alone or with friends:

| Mode | What it is | Alone | Together |
|---|---|---|---|
| **Story** | Quests, dialogue, progress | Solo story | Co-op story |
| **Versus** | Rounds with a winner | Time trials, races against a ghost | Cops and robbers, races, later battle royale |
| **Sandbox** | Free roam with toggles | Today's game | A shared world to mess around in |

- **Playing together isn't a mode.** It's a layer (#1) that lets friends join any mode. Co-op quests are Story with friends.
- **A mode is a set of rules over the same simulation**: which systems run, the win and lose conditions, which save it uses. Not a separate game. It builds on the app-flow state machine (#63) and the sim split (#49).
- **Minigames live inside every mode**, not in a mode of their own.

## Saves

- Every mode with progress saves it: Story always, Sandbox if you want to keep a world.
- **A shared world saves too**, like Project Zomboid: the host's world is saved with one section per player, so when the group comes back, the cars are where they left them and each player gets their own money, clothes and quests back.
- One save format for alone and together (#77). Simulation state is plain data (#49), so a save is a snapshot of it.

## Appearance

What a person looks like is one piece of plain data, `{ build, skin, face, hair, top, bottom, hat }`, shared by the player, NPCs and other players.

- NPCs roll it from a seeded random stream, which gives the village its variety (#199).
- The player changes it in game first, in a wardrobe (#137 makes that a disguise). The full character builder (#18) comes later and is mostly UI over the same data.

## Maps

The game is a set of generic systems (driving, police, NPCs, modes) that run on a **map**. Vrigstad is the first map and always the default, but the systems don't know they're in Vrigstad. A map has two layers:

- **Geometry:** terrain, roads, buildings and water, in one world data shape. For Vrigstad it comes from OpenStreetMap through the data pipeline.
- **An authored layer:** what makes a place itself. Named anchors (spawn, safehouses, the kiosk, landmarks; #74), the people who live there and what they say (#37), its quests (#4), its local flavour and easter eggs (#115).

Systems read anchors ("a safehouse", "the spawn point"), never coordinates, so the same game works on any map.

Other maps sit next to Vrigstad, mainly in Sandbox:

- **Generated maps:** a Småland village made from a seed, then Småland that goes on past the map edge in chunks. The authored layer is generated too.
- **Your own village:** any place in Sweden, built from OSM the way Vrigstad is, with a thin authored layer (anchors guessed from the data) that people can add to.
- **Seeded, not truly random.** A generated map comes from a seed you can share, test against, and send to other players instead of the whole map.
- **Everything can be procedural**, through its own random stream (#73): appearance, names, routines, interiors, errands. Hand-made content stays the default where we have it.

A map is content (where things are, who's there); a mod changes rules (what things do). A map can carry its own quests and characters without being a mod.

## Experiments

Some ideas are worth trying without promising them. An experiment:

- is **opt-in**, behind a setting marked *experimentellt*, and the game works the same without it;
- **can't break determinism or the rules**: anything non-deterministic (such as an AI model) only proposes, and ordinary game rules decide what happens;
- reports in its PR what it costs (download size, speed, which devices) and whether it's good enough to keep.

The first candidate is talking to NPCs with speech-to-text and a small language model running in the browser on WebGPU: for example, talking your way out of *Gripen!*. Scripted voice lines don't need this: they are generated from text at build time and shipped as plain audio (#132).
