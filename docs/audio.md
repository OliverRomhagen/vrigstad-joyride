# Audio: sounds as data, and a studio to build them

A proposal, not yet decided. It says how the game could get its sounds without audio files, and how a dev tool in the
console could let anyone build and tune them. The tickets it would become are drafted at the end.

## The idea in short

- **A sound is a small piece of plain data**, a _patch_: which waveforms and noise it is made of, how its loudness and
  pitch move over time, how it is filtered, and which values from the game drive it while it plays.
- **One player** turns a patch into Web Audio nodes when the sound starts. No audio files, so nothing to license or
  download, and a sound can follow the game live: the engine's pitch follows the car's speed.
- **A studio in the console** edits the same patches the game plays. You build a board from modules and wires, a
  change is heard at once, in the game, and Copy gives the patch as code to paste into the repo.

The game makes no sound today. The only synthesis in the repo is the trailer's offline tool (`tools/trailer/synth.js`),
which writes WAV files from functions; its timbres (it has a siren) are worth borrowing, its shape isn't reusable.

## Why our own format

Every existing effect generator looked at (sfxr, jsfxr, ZzFX, bfxr2, rFXGen) computes a finished clip and then plays
it. That is right for a coin pickup and wrong for an engine: a clip can't change while it plays. Reading the game's
code for what needs a sound gives these requirements, and a fixed sfxr-style list of knobs fails the ones marked ✗:

| A patch must be able to say | Needed by | sfxr-style list |
|---|---|---|
| Several layers, each an oscillator or noise with its own gain | crash (burst + thump + glass), engine | ✗ |
| An envelope on gain, and on pitch or filter cutoff | every one-shot | partly |
| A filter per layer: type, cutoff, resonance | engine, crash, wind | one, fixed |
| A slow oscillator (LFO) routed to pitch, gain or cutoff | siren's two tones, a damaged engine's wobble | vibrato only |
| **A value bound to a named game input, through a curve** | engine (speed, throttle, damage), skid (slip) | ✗ |
| Random ranges per value, rolled each play | crash, footsteps | one global |
| Loop or one-shot, with a release when a loop stops | engine, siren, skid | ✗ |
| A start delay per layer | glass after the crash | ✗ |
| Variants that override a base patch | five engines from one | ✗ |
| Mix data: bus, gain, 3D or flat, distances, voice limit, cooldown, priority | all | ✗ |

So: our own format with live nodes, using sfxr's and ZzFX's words for the knobs (attack, sustain, release, slide,
vibrato) so their presets can be ported by hand.

### A patch is a board: modules and wires

A fixed list of layers, each with one filter and one LFO, would cover the table above and stop there: the first sound
that needs two filters in a row, or one LFO slowing another, would need the format changed. So a patch is a small
graph instead, the way a modular synth is a board of modules joined by cables:

- **A module** is one box that makes or shapes a signal: an oscillator, noise, a filter, a gain, an envelope, an LFO,
  a delay, a distortion, a game input, the output.
- **A wire** joins one module's output to another module's input, or to one of its knobs. An LFO wired to an
  oscillator's frequency is vibrato; wired to a gain it is tremolo; a game input wired to a filter's cutoff is the
  engine opening up with throttle.

This is what Web Audio is underneath, so the player stays thin, and anything can be chained to anything.

**Module kinds are a registry**, like commands and tunables. A kind declares its knobs the way a tunable is declared
(a unit, a range, a line of help) and its inputs and outputs; the audio code has a builder for it. The studio draws a
module from that declaration, so a new kind gets its knobs, its wiring and its `sound` commands without any studio
code, and a plugin can add a kind of its own. Bit crush, duty sweep and phaser would arrive that way later, as kinds
built on an AudioWorklet.

A sketch, to show the size of it, not to fix the names:

```ts
export const BUS = { ENGINE: 'engine', EFFECTS: 'effects', VOICE: 'voice', AMBIENCE: 'ambience', UI: 'ui' } as const;

interface Patch {
  /** id → module; `kind` is a key in the registry of module kinds, the rest are its knobs */
  modules: Record<string, { kind: ModuleKind; [knob: string]: number | string }>;
  /** from a module's output to a module's input (`'filter'`) or to one of its knobs (`'filter.cutoff-hz'`) */
  wires: [from: string, to: string][];
  loops: boolean;
  /** share of a knob's value that is rolled per play: { 'thump.frequency-hz': 0.15 } */
  variation?: Record<string, number>;
  mix: { bus: Bus; gainDb: number; positional: boolean; referenceM?: number; maxM?: number; maxVoices: number; priority: number };
}

// a siren: an LFO switches a square oscillator between two tones
const siren: Patch = {
  modules: {
    tone: { kind: 'oscillator', wave: 'square', 'frequency-hz': 760 },
    swing: { kind: 'lfo', wave: 'square', 'rate-hz': 1.1, depth: 110 },
    band: { kind: 'filter', type: 'bandpass', 'cutoff-hz': 1200 },
  },
  wires: [['swing', 'tone.frequency-hz'], ['tone', 'band'], ['band', 'out']],
  loops: true,
  mix: { bus: BUS.EFFECTS, gainDb: -6, positional: true, referenceM: 15, maxM: 400, maxVoices: 3, priority: 1 },
};
```

Knob paths (`tone.frequency-hz`) are the same dotted kebab-case as tunable keys, so they can be typed in the console.
The wave and filter names would be `as const` maps in the real code, not bare strings.

## How the engine would work

The sim has speed and throttle but no engine revs, so the patch's inputs are derived in the wiring:

- **Pretend revs.** Revs climb with speed inside a gear and drop at each "gear change" (three steps over the car's
  top speed). That rise and drop is most of what makes it read as a car.
- **Tone.** Two detuned sawtooths and a square an octave down, about 45 Hz at idle to 180 Hz, following the revs.
- **Load.** A low-pass filter that opens with throttle (300 to 2500 Hz): foot down is bright, coasting is muffled.
- **Air.** Filtered noise whose gain follows speed, for wind and tyres.
- **Damage.** A 25 Hz wobble in loudness whose depth grows with damage.

The five car types are the same patch with different numbers. The player's car gets all layers; the nearest three
other cars get a one-oscillator variant. Each frame the game only writes a handful of numbers.

This is not how big games do it: they play recordings of real engines, sliced and matched to the revs. Synthesis suits
a stylized game and costs no assets. **Its cost on a phone is not known**: Google's Racer tried a live engine synth in
2013 and shipped recorded loops instead, because phones of the time couldn't afford it. Measuring it on a phone is part
of the first ticket, and three recorded loops are the fallback.

## Where the code goes

| Piece | Where | Why |
|---|---|---|
| Patches and their types | `src/game/sim/sounds/` | Plain data: unit-tested in Node, copied over a network, edited by commands |
| The player (Web Audio) | `src/game/audio/`, a **new zone** | ARCHITECTURE.md already plans the folder, but under today's rules a new folder in `src/game/` is sim code, where `AudioContext` is banned. It needs its own zone: may import sim and world, not page code, like render |
| What triggers a one-shot | a listener on a sim event | "The sim says a star was added; audio plays a siren" (ARCHITECTURE.md). No call from gameplay code |
| What drives a loop | a read of sim state each frame | As render reads it: the engine loop reads the car's speed and throttle |
| The studio panel | a page module, loaded with `import()` behind a lab flag | The panel contract in `docs/console.md` |

Rules the player follows from the first sound:

- The audio context is made on the Start button (browsers need a gesture), suspended when the tab is hidden, and
  resumed on iOS's `interrupted` state.
- Buses (engine, effects, voice, ambience, UI) into a master with a limiter.
- A voice budget (a first guess: 16 on desktop, 8 on phones). When full, the lowest-priority, most distant voice stops.
- A loop past its maximum distance is stopped, not muted.
- Variation uses its own `makeRnd` stream: it is cosmetic and must not shift gameplay rolls.
- Positional sound uses a plain `PannerNode` with equal-power panning; three.js's `PositionalAudio` forces the costly
  HRTF model.

## The studio

The studio is where you build your own board: add modules, wire them, turn their knobs, and hear the result in the
game. Because a patch already is a board, each step below is a new way to see and edit the same data, and none of
them changes the format.

1. **Commands.** `sound list`, `sound play <id>`, `sound set <id> <knob> <value>`, `sound add <id> <kind>`,
   `sound wire <id> <from> <to>`, `sound copy <id>`, `sound reset`. The tunables registry holds numbers only, and a
   patch has wave types and wires, so patches get their own commands rather than `tune set`, as the weapon lab plans
   `weapon set`. This works in today's console.
2. **The rack.** A panel that lists a patch's modules as boxes, each drawn from its kind's declaration: its knobs as
   sliders, and beside each knob and input a "from" picker that makes a wire. Add a module from the list of kinds,
   remove one, reorder. Play repeats the sound; for a loop, sliders stand in for the game inputs (speed, throttle), or
   it follows the car you are driving. Every action runs a `sound` command with source `panel`, so a typed line and a
   slider do the same thing. Copy gives the patch as code.
3. **The board.** The same modules laid out freely, with cables you drag between them, and a scope on any cable.
   This is the modular-synth view, and the one that makes long chains readable.

Easy to start with comes from what every effect generator does, sitting on top rather than shaping the format:
**starting boards** per kind of sound (hit, blip, engine, siren), **randomize**, and **mutate** (a small nudge of the
current knobs), with a lock per knob so a mutate keeps what you like. Someone new starts from a board and nudges it;
nothing stops them from opening it up and rewiring it.

Music is a different tool (it needs a sequencer and timing) and stays with the radio ticket, though a sequencer could
later be one more module kind that plays other patches.

## What it sets the shape of, and what it waits for

This would be the first sound format, the first audio module, among the first event listeners and one of the first
console panels. Others will copy what it does. The part most likely to be copied is the module-kind registry: a
declared kind that the tool draws itself from is the same idea the weapon lab's characteristics (#511) and the
tunables panel (#277) reach for, and whichever lands first should be built so the others can share it.

- **The event bus isn't built** (#367). The engine and a menu click don't need it: one reads state, the other is page
  code. The crash, the siren's start and stop, and the star sounds do. Proposed: the first slice ships without them,
  and they arrive as the bus's first listeners.
- **The console can't host a panel yet** (#358, which builds on the Svelte console, #386). The studio's commands don't
  wait; its panel does.
- **Weapon sounds** (#512) already ask for synthesized sounds and a voice cap. They would use this format instead of
  making their own.

## Tickets this would become

All would be sub-issues of #12 "Audio events".

### 1. Sounds are data that one player turns into Web Audio

Type Task, `scope:audio`, `prio:mid`. Blocks #130, #131 and #512.

- **Problem:** the game is silent, and three tickets each need loading, a mix and a way to describe a sound.
- **Proposal:** the patch format (modules and wires), the registry of module kinds with the first handful
  (oscillator, noise, gain, filter, envelope, LFO, game input), the player, the `audio` zone, buses, limiter, voice
  budget, the unlock on Start, a mute and volume setting, and the `sound` commands. Two sounds prove it: a menu click (one-shot, flat) and the
  player's engine (a loop driven by speed and throttle).
- **Done when:** both sounds play on desktop and a phone; the patch types have unit tests; the engine's cost on a
  mid-range phone is measured and written in the PR, with the decision to keep it or fall back to loops; muting works;
  with sound off, nothing is created.
- **Not in it:** crash and siren (they wait for #367), the panel, music.

### 2. Crashes and sirens are heard, as listeners on game events

Part of #130, blocked by ticket 1 and #367. The crash (layers, variation, scaled by impact) and the siren (positional,
moving, never dropped when voices run out). Could stay inside #130 rather than be its own ticket.

### 3. A studio in the console builds and tunes sounds live

Type Task, `scope:audio`, `lab`, `prio:low`. Blocked by ticket 1 and #358.

- **Proposal:** the rack described above, behind `?lab=sound-studio`, with starting boards, randomize and mutate.
- **Done when:** a new sound can be built from an empty patch by adding and wiring modules, heard in the game and
  pasted into a PR; a module kind added in code shows up in the rack with no studio change; and someone who has never
  used Web Audio gets a usable crash from a starting board and mutate.
- **What would decide the experiment:** whether the sounds that ship were made in it.
- **Not in it:** the free board with draggable cables, which is its own ticket once the rack is in use.

## Decided so far

- **The first sounds don't wait for the event bus.** The engine and the menu click ship first; the crash and the siren
  arrive when the bus (#367) exists, as its listeners, not through direct calls.
- **The studio is for developers first, with players in mind for later**, like the sandbox mode in #544. It starts
  behind a lab flag, and nothing in the patch format or the commands should assume a developer is the one using it.

## Open questions

1. Does the player get a new `audio` zone (proposed), or is it listed as page code?
