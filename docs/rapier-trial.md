# Rapier trial: a physics engine for what gets hit

A proposal for [#54](https://github.com/OliverRomhagen/vrigstad-joyride/issues/54). We find out whether Rapier earns a place in the game. Then we either keep it, or drop it and write down why.

## Why now

Today nothing in Vrigstad reacts when it is hit. Cars and people are pushed out of walls by hand-written circle tests (`BuildingIndex.collide`), and that is all the physics there is. Several stories now want more, all at once:

- **Weapons** ([#17](https://github.com/OliverRomhagen/vrigstad-joyride/issues/17)): a shot that hits something should knock it, splat it or blow it over.
- **Street furniture** ([#432](https://github.com/OliverRomhagen/vrigstad-joyride/issues/432)): mailboxes and bins fly off when you drive into them.
- **People who fall** ([#326](https://github.com/OliverRomhagen/vrigstad-joyride/issues/326), [#342](https://github.com/OliverRomhagen/vrigstad-joyride/issues/342)), with joints that bend the right way.
- **Real crashes** ([#40](https://github.com/OliverRomhagen/vrigstad-joyride/issues/40)).

And the next weapons step, [#510](https://github.com/OliverRomhagen/vrigstad-joyride/issues/510), is about to build a grid and ray tests of its own to find what a shot hits. Rapier has both built in. If we build our own first and adopt Rapier later, we build that part twice. So we decide before #510 starts, and #510 waits for this.

## What Rapier is

[Rapier](https://rapier.rs) is a physics engine written in Rust and compiled to WebAssembly, published as `@dimforge/rapier3d`. It gives us bodies that fall, collide and stack; shapes for the world to collide with; ray casts ("what is the first thing along this line?"); and events when two things touch. Threlte wraps it as `@threlte/rapier`, but the game doesn't use Threlte, so we would call it directly.

Bullets are not physics bodies either way: a shot is too fast to simulate, so it is a ray cast along its path each frame. What Rapier would add is what happens after the hit, and one shared world that every cast and collision asks.

## What we build

One lab experiment, `?lab=rapier`. With the flag off, the game runs exactly as today. Four steps:

1. **Load it only for those who ask.** The ready-to-use package (`rapier3d-compat`) has the engine baked into its JavaScript: 4.3 MB, 1.65 MB compressed. Our pages are built as single files, so an ordinary import would put all of that inside every player's page, even with the flag off (AGENTS.md, Lab experiments). The trial therefore fetches the engine as a separate file (the `.wasm` alone is 1.2 MB compressed), only when the flag is on. That's the first thing to get working. Then we measure the download and the start-up time.
2. **The village as shapes.** The ground and the buildings' walls become fixed shapes in a Rapier world. The cars and the player become shapes that Rapier moves where our own code says, so driving and walking feel exactly as they do now. Today's hand-written collisions stay in charge. Rapier only watches, for now.
3. **Something falls over.** The mailboxes, wheelie bins, waste bins and street lamps (from `src/world/furniture/`) become real bodies. A lamp collides as its pole, with its arm and head as a second box at the top, not one box round the whole model. A car that drives into one sends it flying, and it lands and rolls. Their meshes follow the bodies.
4. **Shots through it.** On top of the weapons branch ([#514](https://github.com/OliverRomhagen/vrigstad-joyride/pull/514)), the pickadoll finds its hits with Rapier's ray cast instead of stepping, and a hit knocks a mailbox too. We fire about 500 shots at once (a minigun's worth for eight players) and time it.

Steps 1 to 3 are one draft PR from `main`. Step 4 needs the pickadoll, which only exists on the weapons branch, so it is a branch that merges the weapons branch into the trial's (`54-rapier-shots`), and runs with both flags: `?lab=rapier,pickadoll`.

## Where the code goes

- The Rapier world is simulation: no three.js, no DOM, so it goes in `src/game/sim/`, and the architecture checks apply from the first commit.
- Drawing reads body positions from it and never writes to them (architecture rule 2).
- Rapier wants a fixed time step, and our loop has none yet ([#49](https://github.com/OliverRomhagen/vrigstad-joyride/issues/49)). The trial steps it at a fixed 1/60 s, catching up when a frame is long. What that teaches us goes into #49.

## What we measure

| | Desktop | Mid-range phone |
|---|---|---|
| Extra download with the flag on | | |
| Page size with the flag off (must be unchanged) | | |
| Time from page load until Rapier is ready | | |
| Frame time added by the village's shapes, at Torget | | |
| Frame time for 500 shots in the air (#510's budget: under 1 ms on the phone) | | |

And by eye: does a mailbox you drive into look and feel right? Screenshots or a short video go in the PR.

## Found so far (steps 1 to 3)

- **Loading:** Rapier is served as its own file, `vendor/rapier.mjs` (`vite.config.ts`), and imported by its address only with the flag on. The game's page grows by about 4 KB compressed with the flag off: only the trial's own code, none of Rapier. The ready-made package carries its WebAssembly inside its JavaScript, 1.65 MB compressed; the plain package's `.wasm` is 1.2 MB and compiles while it downloads. So the download and load times measured here are higher than they need to be.
- **Rapier's ground is the terrain's elevation grid**, split into triangles as the drawn terrain is: about 15,000 triangles. A first version sampled the ground every 2 m, 1.2 million heights, most of the time to build the world; a second used the drawn mesh's own triangles, whose finer cells by the water came to 230,000 and took Rapier's memory to 48 MB. By the water Rapier's ground is now the coarser one.
- **Props join the world only near a moving car.** Rapier pairs every body with any shape whose bounds overlap its own, and on uneven ground the ground's bounds overlap everything, so 1,660 mailboxes and bins sleeping in the world all woke on the first step. Instead a prop joins when a moving car comes within 12 m, and leaves again once nothing has been within 32 m of it for a second, unless it has been knocked. Kept for good, traffic had brought 277 props into the world after 90 s, and the step had grown by a quarter.
- **A prop is anchored until a car reaches it.** A tall, narrow box on a slope tips over by itself once it can move. So a prop joins as a fixed body, exactly where it is drawn, as a mailbox on its post. It comes loose one physics step before a car's capsule reaches it, so the car pushes it. Loosened only once the car touched it, a fast or glancing hit found the car already inside the box, and Rapier pushed it out sideways: at 90 km/h, 0.6 m off the car's middle, the mailbox didn't move. Untouched props never move and stay in their batch of street furniture, so they cost no extra draw calls.
- **The player knocks nothing loose.** A person is a kinematic body to Rapier, so it can't be pushed back: walking into a mailbox laid it flat and shoved it 3 m. Walking past one now leaves it standing; one already down still gets pushed.
- **A frame's move is spread over its steps.** Below 60 fps the world runs two or three steps a frame (the loop caps a frame at 0.05 s), and Rapier gives a car the whole frame's move in the first of them. A car going 15 m/s at 15 fps threw a mailbox 50 m instead of 15 m. Each car and the player now cover their move evenly over the frame's steps, and one that is put far away (a respawn, *Gripen!*, getting out of a car) jumps there instead of sweeping across the village.
- **Measured** (`performance-analyst`, headless Chromium; "slowed" is the CPU slowed 4× as a rough stand-in for a phone, which leaves out a phone's GPU and network):
  - Rapier's file is 1.65 MB compressed and takes about 26 ms to load and start on its own (57 ms slowed). In the game it is ready about 2.5 s after the page's `load` event, behind the game's own start-up; the flag doesn't delay the first frame or Start.
  - Building the world took 66 ms (309 ms slowed) with the 2 m grid. With the grid ground the walls, 12,318 triangles, are most of what is left.
  - The physics step took 0.3 to 0.5 ms a frame (1.1 to 1.9 ms slowed) at Torget and on a drive, running three steps a frame in headless Chrome's slow frames.
  - Rapier's memory was 10 MB with the 2 m grid, 48 MB with the drawn mesh's triangles; the JS heap grows about 6 MB.
  - Traffic brings about 470 props into the world in a minute. A loose prop on screen costs about 1.3 draw calls (its mesh and its shadow).
  - The page with the flag off grows 3.8 to 4.5 KB compressed.
- **Drawn smoothly at any frame rate.** Physics steps at 60 Hz. A knocked prop or a target is drawn between its last two steps, as far as the frame is into the next one (`PhysicsWorld.drawnPose`), so on a 120 Hz screen it moves every frame, not every other one. It's drawn up to one step, 17 ms, behind Rapier.
- **Tunable while you play:** with `?dev&lab=rapier`, the console's `tune` changes `physics.gravity`, `physics.prop-join-distance`, `physics.prop-respawn-time` and `physics.prop-respawn-distance` at once (`src/game/sim/physics-tunables.ts`), and `?tune=physics.gravity:3` sets one at load. These are the first numbers a sandbox mode would hand to players.
- **By eye:** a Volvo at 60 km/h throws a mailbox several metres, turning over. Traffic knocks over the odd mailbox too.

## Found in step 4: shots through Rapier

- **The weapons ask one question.** What a shot can hit (`ShotWorld` in `src/game/sim/shots.ts`) gained an optional ray cast: what the line from here to there meets first. With both flags on, `src/game/sim/shot-physics.ts` answers it through Rapier (`PhysicsWorld.castSegment`), so each step of a shot is one ray cast instead of a check every 0.25 m, and the line of sight is one cast instead of 640. Without Rapier the weapons' own checks find the hit, unchanged. The ground as the game draws it still stops a shot that Rapier's coarser ground would let through.
- **The people near the player are in the world**, as capsules of their size, moved where the game puts them, out to 160 m (the line of sight). Like the player, they push what is loose but knock nothing loose. One knocked down leaves, as the ragdolls have them. At Torget that was 36 to 39 people.
- **A shot passes through the shooter and the car they sit in**, and hits other cars, people, walls, the ground and street furniture. A prop is a new kind of hit: it knocks the prop loose with a push of 40 N·s for each point of the weapon's power. A pickadoll shot sends a mailbox over and only rocks a 120 kg street lamp; nothing splats on a prop, as the mark would hang in the air once it falls.
- **Props near the player join too**, within 40 m, anchored as before, so a shot meets one that no car has been near.
- **Measured** in Node, against the real village with 42 people and 20 cars, 500 shots kept in the air: 0.55 to 0.6 ms a frame through Rapier, against 0.9 to 1.2 ms for the weapons' own checks. Not yet measured in a browser or on a phone.

## The shooting range

A place to try the weapons on targets that fall (#545), with `?lab=rapier,pickadoll`: adding `&at=622,-1,3.1416` starts you on its firing line, in the 10 m lane, looking down the range. It stands south of Stockarydsvägen, east of the village, after the range Vrigstads skytteförening built opposite Hoåsen in 1949 (`src/game/sim/shooting-range.ts`, drawn by `src/game/render/shooting-range.ts`).

- **Seven lanes, 4 m apart, one target each**, at 50, 10, 35, 100, 25, 75 and 15 m from west to east: from any lane, no board hides another. A target is a thin post with a 0.7 m board on top, a body in Rapier's world from the start: a hit knocks it over, and it stands up again 4 s later, once nothing stands on its spot (`tune set physics.target-reset-time 10`).
- **The earth bank** behind the targets and **the pavilion** at the west end of the firing line are fixed boxes in Rapier's world, so a shot stops at them. The game's own collisions don't know them: you walk through the pavilion.
- **Not yet:** the timed programs, a score, and the bank and the pavilion as things you bump into.

## Known limits of the trial

- **Two grounds.** Rapier's ground is the terrain. The furniture is drawn on the game's ground, which adds curbs, road lifts and floors. So a knocked prop drops up to a curb's height and can rest partly in a sidewalk. The car and player shapes don't follow bridge decks either.
- **Missing shapes.** Only the buildings' walls are in Rapier's world, not the fences at Skroten or the kiosk.
- **Knocked props go back after 90 s.** Traffic knocks props over anywhere in the village, and each one down is a draw call of its own, two with its shadow. So a knocked prop goes back to its stand, anchored and back in its batch, 90 s after it was knocked, once the player is more than 100 m from both where it lies and where it stood. That is distance only, not what the camera sees: walls aren't asked.
- **A prop pressed by a car never sleeps.** A mailbox that ends up under or against a car that has stopped stays awake for as long as the car stands there: Rapier doesn't let a body sleep while something presses on it. Each costs a little every step.
- **A hit costs the car nothing.** A 40 kg mailbox stand at 90 km/h doesn't slow the car or damage it: Rapier's cars are moved by the game and can't be pushed back.
- **The file has no version in its name.** `vendor/rapier.mjs` can be cached for a few minutes past an upgrade.
- **Shots meet only the props that have joined.** Past 40 m from the player, a shot passes through a prop no car has been near.
- **Only a direct hit knocks a prop.** A grenade's blast throws people and shoves cars, but leaves the props standing.
- **Each ray cast that meets something allocates** a few small objects in Rapier's JavaScript: the aiming arc of a throw casts up to 64 times a frame.
- **People and the props near the player join only with both flags.** `?lab=rapier` alone holds only the cars and the player, as in steps 1 to 3.
- **People stand on the terrain** in Rapier's world, not on the curbs and floors the game draws them on: a shot at their feet can meet the ground first.
- **The time step is a stand-in for #49.** The trial keeps its own clock and spreads each frame's move over its steps only because the game's cars don't move on a fixed step yet. Once #49 gives the sim its steps, Rapier steps inside them and both go.

## Questions for the decision

- **Should a hit come back to the game?** Crashes (#40), damage and a star for wrecking a neighbour's mailbox all need the physics world to say what it hit, as the `knocked-over` event ARCHITECTURE.md names for the event bus (#367). Is that part of "keep"?
- **The same everywhere?** #510 asks that a hit never depend on the frame rate, and under multiplayer (#411) every browser runs its own world. Knocked props differ between players and with the frame rate today: fine while they are only for show, not if one can block a road or a shot.
- **Is traffic knocking props everywhere wanted?** They go back after 90 s out of sight. Measure how many props are joined and loose after ten minutes of play, not only after a short drive.
- **Measure what the decision needs:** on a phone, the load with the plain `.wasm`, the memory Rapier holds, and the step with the village's 80 cars.

## How we decide

- **Keep Rapier** if the shots fit #510's budget, the mailbox feels right, and the download is acceptable on a phone. Then #510 uses Rapier's casts instead of its own grid, and the crashes, the flying furniture and the falling people build on it.
- **Drop it** if the download or the frame time costs a phone too much, or if keeping its bodies in step with our arcade cars is a fight. Then #510 goes ahead as written, and collisions stay hand-written for now.

Either way, the numbers go in #54, and the decision replaces "No physics engine yet" in ARCHITECTURE.md (Decisions).

## Not in the trial

- Cars driven by physics: the arcade driving stays as it is.
- Falling people and ragdolls: those come after the decision.
- Replacing today's collisions: Rapier runs beside them.
- Multiplayer: Rapier gives the same results on every machine only with the same build and the same order of steps. We note what that would need, and that's all.
