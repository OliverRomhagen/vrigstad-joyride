# Audio: sounds as data, and a studio to build them

A proposal: two points are decided (see "Decided so far"), the rest is open. It says how the game could make most of
its sounds without audio files, and how a dev tool in the console could let anyone build and tune them. The tickets it
would become are drafted at the end.

## The idea in short

- **A sound is a small piece of plain data**, a _patch_: which waveforms and noise it is made of, how its loudness and
  pitch move over time, how it is filtered, and which values from the game drive it while it plays.
- **One player** turns a patch into Web Audio nodes when the sound starts. A synthesized sound has no audio file, so
  nothing to license or download, and it can follow the game live: the engine's pitch follows the car's speed.
- **Voices are a made-up language** that sounds Swedish without being it, synthesized like everything else (see
  "Voices"). The text on screen carries the meaning.
- **Recordings stay possible.** A recording would be one more kind of module, one that plays a file, so it goes
  through the same mix; it brings a loader and a `LICENSE` entry per file, and isn't part of the first ticket. The
  same slot would take a voice generated when the game is built, or one arriving live from a model in the browser,
  both of which the design doc proposal (PR #214, still open) mentions. Neither is designed here.
- **Everything is reachable from the console**, as the tunables and the time of day are: playing a sound, changing a
  knob, building a patch, saying a line. The studio's panel only runs those commands.
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
export const KIND = { OSCILLATOR: 'oscillator', NOISE: 'noise', FILTER: 'filter', LFO: 'lfo', INPUT: 'input' /* … */ } as const;
export const WAVE = { SINE: 'sine', TRIANGLE: 'triangle', SAW: 'sawtooth', SQUARE: 'square' } as const;
export const FILTER = { LOWPASS: 'lowpass', HIGHPASS: 'highpass', BANDPASS: 'bandpass' } as const;
export const CURVE = { LINEAR: 'linear', EXPONENTIAL: 'exponential' } as const;
export const GAME_INPUT = { REVS: 'revs', THROTTLE: 'throttle', SPEED: 'speed', DAMAGE: 'damage' } as const;
/** the knobs a wire can end at; the values are the names typed in the console */
export const KNOB = { FREQUENCY_HZ: 'frequency-hz', CUTOFF_HZ: 'cutoff-hz', GAIN: 'gain' /* … */ } as const;
/** where every patch ends: its bus */
export const OUT = 'out';

interface Patch {
  /** another patch's id: this one starts as a copy of it, and its `modules` and `mix` override knob by knob */
  base?: string;
  /** id → module: a union by `kind`, so each kind has exactly its own knobs and the compiler checks them */
  modules: Record<string, Module>;
  /** a module's output into another module's signal input, or into one of its knobs when `knob` is given;
   *  `OUT` is always there and isn't listed in `modules` */
  wires: { from: string; to: string; knob?: Knob }[];
  /** a loop holds its envelopes open until it is stopped, then lets them release; a one-shot runs them once */
  loops: boolean;
  /** share of a knob's value that is rolled per play: { module: 'thump', knob: KNOB.FREQUENCY_HZ, share: 0.15 } */
  variation?: { module: string; knob: Knob; share: number }[];
  mix: {
    bus: Bus;
    gainDb: number;
    positional: boolean;
    referenceM?: number;
    maxM?: number;
    maxVoices: number;
    cooldownS?: number;
    /** higher is kept longer when the voices run out */
    priority: number;
  };
}

// a siren: an LFO switches a square oscillator between two tones
// `definePatch` returns the patch as it is, and makes TypeScript check each wire against this patch's own modules
const siren = definePatch({
  modules: {
    tone: { kind: KIND.OSCILLATOR, wave: WAVE.SQUARE, frequencyHz: 760 },
    // an LFO's depth is in the unit of the knob it is wired to: here Hz, so 650 to 870 Hz
    swing: { kind: KIND.LFO, wave: WAVE.SQUARE, rateHz: 1.1, depth: 110 },
    band: { kind: KIND.FILTER, type: FILTER.BANDPASS, cutoffHz: 1200 },
  },
  wires: [
    { from: 'swing', to: 'tone', knob: KNOB.FREQUENCY_HZ },
    { from: 'tone', to: 'band' },
    { from: 'band', to: OUT },
  ],
  loops: true,
  mix: { bus: BUS.EFFECTS, gainDb: -6, positional: true, referenceM: 15, maxM: 400, maxVoices: 3, priority: 9 },
});

// the part of an engine that opens up with throttle: a game input is a module too, with the range it maps to
const engineLoad = {
  throttle: { kind: KIND.INPUT, input: GAME_INPUT.THROTTLE, toMin: 300, toMax: 2500, curve: CURVE.LINEAR, smoothS: 0.05 },
  load: { kind: KIND.FILTER, type: FILTER.LOWPASS, cutoffHz: 300 },
  // wires: { from: 'throttle', to: 'load', knob: KNOB.CUTOFF_HZ }
};
```

What the sketch settles and what it leaves:

- **A value from the game is an `input` module.** It names the input (`revs`, `throttle`, `damage`), the range it maps
  to, a curve and a smoothing time. The wiring writes the inputs each frame; a patch can't read anything it isn't
  given.
- **Timing lives in the envelope kind:** attack, sustain, release and a start delay, so glass can come 300 ms after
  the crash.
- **An octave down** is an oscillator's `ratio` knob (0.5) on the frequency it is wired to. More arithmetic than
  that would be a kind of its own.
- **Bussing inside a patch needs nothing extra.** Any number of wires can end at the same module, and Web Audio adds
  them together: three oscillators into one filter is a bus. One module can feed several others.
- **Side-chaining is a wire to a knob:** one signal steering another's gain or cutoff. A `follower` kind, which turns
  a signal's loudness into a control value, would let one part of a patch duck another.
- **Feedback goes through a delay.** Web Audio allows a loop in the graph only with a delay in it, so an output wired
  back to an earlier module through a `delay` module gives echo, comb filters and plucked strings. A loop without one
  is refused when the patch is registered.
- **A module has one signal input** in the first version, so a wire's target is either a module or one of its knobs.
  That only limits a kind that treats two inputs differently (a ring modulator, a crossfader), which would need a
  third form, left open.
- **A mix bus is a board too.** Each bus (engine, effects, voice) is built from the same modules, so it can carry a
  filter or a reverb that every patch on it shares, and one bus can duck another: voices over the engine, or the
  whole world muffled inside a safehouse. Not in the first ticket, which has plain buses, but the format shouldn't
  rule it out.
- **Names:** no fixed set is a bare string: kinds, waves, filter types, curves and game inputs are `as const` maps.
  A knob is an ordinary camelCase property (`frequencyHz`), and where a wire or a variation names one it is a
  constant (`KNOB.FREQUENCY_HZ`), as is the patch's end (`OUT`). The dotted path `tone.frequency-hz` exists only where
  someone types it, in the console and the tunables, as `topSpeed` is `top-speed` for the cars.
- **One kind of string remains:** the module names a patch's author picks (`tone`, `swing`). They are made up per
  patch, like variable names, so no shared map can list them. `definePatch` makes the compiler check them all the
  same: a wire to a module the patch doesn't have fails the typecheck. A patch built in the studio or loaded from a
  link is checked the same way when it is registered.

## How the engine would work

The sim has speed and throttle but no engine revs, so the patch's inputs are derived in the wiring:

- **Pretend revs.** Revs climb with speed inside a gear and drop at each "gear change" (three steps over the car's
  top speed). That rise and drop is most of what makes it read as a car.
- **Tone.** Two detuned sawtooths and a square an octave down, about 45 Hz at idle to 180 Hz, following the revs
  (one `input` module mapped to that range, wired to all three; the square has a `ratio` of 0.5).
- **Load.** A low-pass filter that opens with throttle (300 to 2500 Hz): foot down is bright, coasting is muffled.
- **Air.** Filtered noise whose gain follows speed, for wind and tyres.
- **Damage.** A 25 Hz wobble in loudness whose depth grows with damage.

The five car types are the same patch with different numbers. The player's car gets all layers; the nearest three
other cars get a one-oscillator variant. Each frame the game only writes a handful of numbers.

This is not how big games do it: they play recordings of real engines, sliced and matched to the revs. Synthesis suits
a stylized game and costs no assets. **Its cost on a phone is not known**: Google's Racer tried a live engine synth in
2013 and shipped recorded loops instead, because phones of the time couldn't afford it. Measuring it on a phone is part
of the first ticket, and three recorded loops are the fallback.

## Voices: a made-up language

People in the game speak a jabber that reminds you of Swedish, the way the Minions, the Sims and the villagers of
Animal Crossing speak theirs. The voice carries mood and character; the Swedish line on screen carries the meaning,
which #132 asks for anyway. It settles how voice lines are made: no recordings, no licences, no real person's voice,
and it works for any line, also one written later.

- **The sound.** A buzzy tone through filters that jump between vowel shapes, one per syllable, with short bursts of
  noise as consonants. That needs one new kind of module, a vowel filter.
- **Why it sounds Swedish.** Mostly the melody: the two-peak word accent that makes Swedish sing, long and short
  syllables, and the vowel shapes of å, ä and ö.
- **Driven by the real line.** The syllables and rhythm are taken from the written Swedish text, so a long line
  sounds long and a shout sounds like one. The same text always gives the same jabber.
- **A voice per character.** One patch, with a pitch, a speed and a roughness per person, as the cars share an engine.
- **A small sequencer** turns a line into timed syllables that play the patch. It is the piece music would need too.
- **From the console:** `sound say <voice> <line>` speaks any line in any voice, and a voice's numbers are tunables.

The risk is that it grates. It needs tuning by ear, short lines, a cooldown per speaker, and its own volume setting.
None of it is built or heard yet. It would be a ticket of its own, under #132, after the first one.

## Where the code goes

| Piece | Where | Why |
|---|---|---|
| Patches and their types | `src/game/sim/sounds/` | Plain data: unit-tested in Node, copied over a network, edited by commands |
| The player (Web Audio) | `src/game/audio/`, a **new zone** | ARCHITECTURE.md already plans the folder, but under today's rules a new folder in `src/game/` is sim code, where `AudioContext` is banned. It needs its own zone: may import sim and world, not page code, like render |
| What triggers a one-shot | a listener on a sim event | ARCHITECTURE.md's example: the sim says a star was added, and audio plays a siren. No call from gameplay code |
| What drives a loop | a read of sim state each frame | As render reads it: the engine loop reads the car's speed and throttle. ARCHITECTURE.md only says audio "reacts to sim events", so this adds to it, and that line would be updated |
| The studio panel | a page module, loaded with `import()` behind a lab flag | The panel contract in `docs/console.md` |

Rules the player follows from the first sound:

- The audio context is made on the Start button (browsers need a gesture), suspended when the tab is hidden, and
  resumed on iOS's `interrupted` state.
- Buses (engine, effects, voice, ambience, UI) into a master with a limiter.
- A voice budget (a first guess: 16 on desktop, 8 on phones). When full, the voice with the lowest priority stops,
  the most distant one first among equals. The siren has the highest priority of the world's sounds, so it is the last
  to go.
- A loop past its maximum distance is stopped, not muted. The siren's is 400 m, well past the 170 m it takes to evade.
- Variation uses its own `makeRnd` stream: it is cosmetic and must not shift gameplay rolls.
- Positional sound uses a `PannerNode` with equal-power panning, not the costlier HRTF model that three.js's
  `PositionalAudio` picks by default (not checked against the three.js version in use).

## The studio

The studio is where you build your own board: add modules, wire them, turn their knobs, and hear the result in the
game. Because a patch already is a board, each step below is a new way to see and edit the same data, and none of
them changes the format.

1. **Commands.** `sound list`, `sound play <id>`, `sound set <id> <knob> <value>`, `sound add <id> <kind>`,
   `sound wire <id> <from> <to>`, `sound copy <id>`, `sound reset`. The split is the one the weapon lab (#511)
   plans: a patch's numeric knobs also go in the tunables registry (`tune set sound.siren.tone.frequency-hz 800`), so
   `?tune=` and a tunables panel reach them for free, and the `sound` commands add what the registry can't hold, which
   is building: modules, wires, wave types. This works in today's console.
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

What is shared is an extension of what the tunables already have, not a new abstraction. A tunable declares a number
with a unit, a range and a line of help. That description grows to cover a choice from a fixed set (a wave, a filter
type), and later an on/off; a module kind declares its knobs with it, and a panel needs one piece of code that draws a
control from a description, whoever declared it. A general registry of "kinds" for sounds, weapons and tunables alike
is not proposed: they store different things, and with one user its shape would be a guess. If the weapon lab ends up
declaring kinds the way sounds do, the common part is extracted then, with two real cases to fit.

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

- **Problem:** the game is silent, and the tickets under #12 each need a mix and a way to describe a sound.
- **Proposal:** the patch format (modules and wires), the registry of module kinds with the first handful
  (oscillator, noise, gain, filter, envelope, LFO, game input), the player, where it sits in the architecture checks
  (open question 1), buses, limiter, voice budget, the unlock on Start, a mute and volume setting, and the `sound`
  commands. Two sounds prove it: a menu click (one-shot, flat) and the player's engine (a loop driven by speed and
  throttle). The engine is the first "done when" line of #130, which keeps the horn, the doors, the crash and the
  siren.
- **Done when:**
  - both sounds play on desktop and a phone, and stop when the tab is hidden;
  - a patch can be changed with `sound set`, heard at once, and `sound copy` gives it as code;
  - the patch types, the voice budget and the priority order have unit tests (the budget with a stub player, since
    two sounds can't fill it);
  - the engine's cost on a mid-range phone is measured and written in the PR, with the decision to keep it or fall
    back to recorded loops (which would bring the recording kind into this ticket);
  - muting works, and with sound off nothing is created;
  - `npm run check` passes with the player where the open question puts it.
- **Not in it:** crash and siren (they wait for #367), voices, recordings, the panel, music.

### 2. Crashes and sirens are heard, as listeners on game events

Not a new ticket: this is the rest of #130, which would be marked blocked by ticket 1 and #367. The crash (several
sources, variation, scaled by impact) and the siren (positional, moving, the last to be dropped when voices run out).

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
