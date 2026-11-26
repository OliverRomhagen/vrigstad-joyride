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
3. **Something falls over.** The mailboxes and wheelie bins (from `src/world/furniture/`) become real bodies. A car that drives into one sends it flying, and it lands and rolls. Their meshes follow the bodies.
4. **Shots through it.** On top of the weapons branch ([#514](https://github.com/OliverRomhagen/vrigstad-joyride/pull/514)), the pickadoll finds its hits with Rapier's ray cast instead of stepping, and a hit knocks a mailbox too. We fire about 500 shots at once (a minigun's worth for eight players) and time it.

Steps 1 to 3 are one draft PR from `main`. Step 4 needs the pickadoll, which only exists on the weapons branch, so it is a small second PR on top of #514.

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

- **Loading:** Rapier is served as its own file, `vendor/rapier.mjs` (`vite.config.ts`), and imported by its address only with the flag on. The game's page grows by 2.5 KB compressed with the flag off: only the trial's own code, none of Rapier.
- **Props join the world only near the action.** Rapier pairs every body with any shape whose bounds overlap its own, and on uneven ground the ground's bounds overlap everything, so 1,660 mailboxes and bins sleeping in the world all woke on the first step. Instead a prop joins when a car or the player comes within 12 m, and stays.
- **A prop is anchored until touched.** A tall, narrow box on a slope tips over by itself once it can move. So a prop joins as a fixed body, exactly where it is drawn, as a mailbox on its post, and the first touch by a car or the player sets it loose. Untouched props never move and stay in their batch of street furniture, so they cost no extra draw calls.
- **First numbers,** from a local build in headless Chrome, which renders in software and is much slower than a real device:
  - the world (ground, walls and anchoring) is built in about 70 ms;
  - about 100 of 1,660 props had joined after a short drive round Torget;
  - the physics took about 0.4 ms a frame;
  - loading and starting Rapier took 7 to 9 s here. A real device is needed to judge that one.
- **By eye:** a Volvo at 60 km/h throws a mailbox several metres, turning over. Traffic knocks over the odd mailbox too.
- **A frame's move is spread over its steps.** Below 60 fps the world runs two to four steps a frame, and Rapier gives a car the whole frame's move in the first of them. At 15 fps a car threw a mailbox 50 m instead of 15 m. Each car and the player now cover their move evenly over the frame's steps.

## Known limits of the trial

- **Two grounds.** Rapier's ground is the terrain, sampled every 2 m. The furniture is drawn on the game's ground, which adds curbs, road lifts and floors. So a knocked prop drops up to a curb's height and can rest partly in a sidewalk. The car and player shapes don't follow bridge decks either.
- **Missing shapes.** Only the buildings' walls are in Rapier's world, not the fences at Skroten or the kiosk.
- **Knocked props add up.** Traffic knocks props over anywhere in the village. Each knocked prop is a draw call of its own from then on, and props never leave the world once they have joined. A long session would show it in the numbers.
- **The file has no version in its name.** `vendor/rapier.mjs` can be cached for a few minutes past an upgrade.

## How we decide

- **Keep Rapier** if the shots fit #510's budget, the mailbox feels right, and the download is acceptable on a phone. Then #510 uses Rapier's casts instead of its own grid, and the crashes, the flying furniture and the falling people build on it.
- **Drop it** if the download or the frame time costs a phone too much, or if keeping its bodies in step with our arcade cars is a fight. Then #510 goes ahead as written, and collisions stay hand-written for now.

Either way, the numbers go in #54, and the decision replaces "No physics engine yet" in ARCHITECTURE.md (Decisions).

## Not in the trial

- Cars driven by physics: the arcade driving stays as it is.
- Falling people and ragdolls: those come after the decision.
- Replacing today's collisions: Rapier runs beside them.
- Multiplayer: Rapier gives the same results on every machine only with the same build and the same order of steps. We note what that would need, and that's all.
