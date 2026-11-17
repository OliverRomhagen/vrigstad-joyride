# Game design

What kind of game Vrigstad Joyride is, and the choices that shape the features. [ARCHITECTURE.md](ARCHITECTURE.md) is how the code is built; this file is what it builds. Read it before adding a mode, a big mechanic, or anything that changes how the game feels.

Like the decisions in ARCHITECTURE.md, each section is short and settled. Change one in a PR, so the team sees it.

## Form: a toy, not a crime simulator

The game is playful, toy-like and a little whimsical: closer to a box of Lego set in a real village than to a gritty open-world crime game. You can still steal an EPA-traktor and lose the police; it just stays funny.

- **Violence is slapstick.** Shoves, snowballs, water balloons, knockdowns and getting back up. No blood, no realistic weapons, no dying in pain. Health and damage (#80) are about falling over and dented cars.
- **Creative over grim.** Given a choice, a mechanic that lets players make or mess around with things beats one that only punishes.
- **Grittier play belongs in mods**, if the game becomes moddable, not in the base game.

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

## Worlds

The real Vrigstad, built from OpenStreetMap, is the heart of the game and always the default. Other worlds are options next to it, mainly in Sandbox:

- **Seeded, not truly random.** A generated world comes from a seed you can share, test against, and send to other players instead of the whole world.
- **One seam.** Terrain, roads, buildings, NPCs and police read one world data shape. Anything that produces it (the OSM file, a test fixture, a generator) can stand in.
- **In order:** a generated Småland village the size of Vrigstad, then Småland that goes on past the map edge in chunks, and "play your own village": any place in Sweden, built from OSM the way Vrigstad is.
- **Everything can be procedural**, through its own random stream (#73): appearance, names, routines, interiors, errands. Hand-made content stays the default where we have it.

## Experiments

Some ideas are worth trying without promising them. An experiment:

- is **opt-in**, behind a setting marked *experimentellt*, and the game works the same without it;
- **can't break determinism or the rules**: anything non-deterministic (such as an AI model) only proposes, and ordinary game rules decide what happens;
- reports in its PR what it costs (download size, speed, which devices) and whether it's good enough to keep.

The first candidate is talking to NPCs with speech-to-text and a small language model running in the browser on WebGPU: for example, talking your way out of *Gripen!*. Scripted voice lines don't need this: they are generated from text at build time and shipped as plain audio (#132).
