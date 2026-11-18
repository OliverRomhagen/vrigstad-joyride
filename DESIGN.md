# Game design

What kind of game Vrigstad Joyride is, and the choices that shape the features. [ARCHITECTURE.md](ARCHITECTURE.md) is how the code is built; this file is what it builds. Read it before adding a mode, a big mechanic, or anything that changes how the game feels.

Like the decisions in ARCHITECTURE.md, each section is short and settled. Change one in a PR, so the team sees it.

## The aim

An open, easy-to-get-into and above all fun game, for (almost) everyone. And a game that's fun to make: if a feature stops being fun to build, that's worth saying.

## Form: how rough the game gets

*Open: the team picks a route here.* Whatever we pick, some things hold: the humour is affectionate toward Vrigstad (AGENTS.md, "Language and tone"), it has detail and love (little jokes and local in-jokes, things that reward poking around, #115), and it isn't a children's game: adult humour and the funny Småland kind of swearing belong.

| Route | Touchstone | Violence | What it gives us | What it costs |
|---|---|---|---|---|
| **A. Toy box** | LEGO games | Slapstick: shoves, snowballs, knockdowns, no real weapons | Charm, a broad audience, little risk around a real village | Less edge; guns (#17) don't fit |
| **B. Witty and rough** | Borderlands | Over-the-top guns that feel good to fire; you shoot people, but nothing is taken seriously | Fun combat, guns on your car, humour with teeth | Needs combat, enemies and damage (#80); harder to keep the affection for a real place |
| **C. Chaos sandbox** | Goat Simulator | Physics mayhem with no stakes | Cheap to build, very shareable moments | Thin story and progression |
| **D. Crime satire** | GTA, Saints Row | Realistic-ish crime and violence | Familiar open-world loop | Clashes with a real village and its people; the tone we've been avoiding |

The routes mix: B with A's care for detail (a LEGO-made world with Borderlands guns) is one option, A with C's mayhem another.

Leaning, to discuss: **B with A's care**. Rocket launchers that *ballar ur*, a minigun on the EPA-traktor, enemies that are over the top rather than people you feel bad about. Grimmer or more realistic play would belong in mods: if the base game stays softer than you'd like, a "Gore and Guns" mod pack is the way to get it (#17).

## Look: stylised, not photoreal

Stylised and more or less low-poly, in the direction of Borderlands' cel-shaded look with outlines (#206). It suits a game that runs in the browser:

- **Performance:** simple shapes and flat colour run on phones and old laptops, and leave room in the graphics quality tiers (#72).
- **Accessibility:** clear shapes, strong silhouettes and outlines are easier to read than realistic detail (#82).
- **Feeling:** it matches the tone, ages better than near-realism, and makes the world look made with love rather than scanned.

Photographic touches (grain #124, colour grading #140) stay optional extras, not the default look.

**Effects are slottable, Lego-style.** Each visual effect is isolated in its own module and turned on or off with one switch, without touching the rest of the game. Then trying a look costs nothing, and dropping it costs nothing either.

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

### Activities: a mode within a mode

An activity is a smaller set of rules that takes over for a while, inside any mode, and can change how the game plays: less action, different goals. Ideas:

- **A case:** a mystery to solve, in the spirit of noir detective stories, Mansions of Madness and Cluedo. Question people (#37), find clues, accuse someone. Dark and raw, sometimes ironic, against a cosy village.
- **A party night:** Mario Party-style, friends play a board of short minigames around the village (the trisslott, bowling, the arcade; #86).
- **Races, cops and robbers:** Versus mode is a playlist of competitive activities.

The tone of an activity can differ from the rest of the game: a case can be darker than driving around.

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
