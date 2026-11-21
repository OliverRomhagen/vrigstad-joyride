# The console

How in-game commands work, and how the console grows into the base for dev tools: the contract every module
registers against, what is built, and what comes next. The player-facing story is
[#218](https://github.com/OliverRomhagen/vrigstad-joyride/issues/218).

## The shape

```
 sources                     registry (sim code: no DOM)                 modules
 ───────                     ───────────────────────────                 ───────
 DevConsole (typed, Tab) ─┐
 ?cmd= at start*    (url) ├─► Commands.run(line, source) ─► hooks ─► Command.run ─► wallet, pets, police, …
 binds, exec*    (script) │     │ access check                 (outermost first)        (their own API)
 tests             (test) ┘     │ alias → name
                                └─► one line back ─► the console's output (the Log tab, later)
```

`*` not built yet: step 6 of [What comes next](#what-comes-next).

- **`Commands`** (`src/game/commands.ts`) is the one registry. It is sim code, so it runs in a unit test, a worker
  or a server, and it knows nothing about the box you type into.
- **`DevConsole`** (`src/game/devconsole.ts`) is page code: the DOM box, its keys, history and focus. It sends lines
  to the registry and prints what comes back. Svelte replaces it after #51; the registry doesn't change.
- **Modules own their commands.** Each module that has some exports `registerCommands(commands: Pick<Commands,
  'register'>)` (or a method of that name), and `main.ts` calls it once, as it does for the wallet and the pets now.

## The contract

### A command

```ts
commands.register('go', command({
  help: 'go to a place, in the car if you are in one',
  aliases: ['tp'],
  access: 'dev',                                        // the default; 'player' runs outside dev mode too
  args: [choice('place', () => [...spots.keys()]), optional(int('speed', { min: 0, max: 200 }))],
  run: ({ place, speed }, call) => goTo(place, speed),  // place: string, speed: number | undefined
}));
```

- `command()` (`src/game/command-args.ts`) builds a `Command` from typed arguments: `int`, `num` (a Swedish comma
  works), `word`, `toggle` (on/off, ja/nej), `choice` and `rest`, each `optional()` at the end. From that one list come
  the parsing, the usage line (`<place> [speed]`), the error lines (`No place called gnosjö. Usage: go <place>
  [speed]`) and Tab completion. `run` gets the values by name, typed: a choice is its own union of words.
- A `choice` given a function reads it on every use, so a list that grows while the game runs (car models, unlocked
  places) completes and parses without registering again.
- The plain shape still works: `register(name, { usage, help, run(words) })`, throwing `UsageError` for bad
  arguments. The existing commands (`kr`, `mynt`, `adopt`, `clear`) use it, and move over when someone touches them.
- **A command is thin.** It reads its arguments and calls the module's own API, and the rule lives in the module,
  where a unit test reaches it without the console. `run` returns one line to show (English: it is UI text), or ''.
- `register` returns a function that takes the command out again, for a lab experiment that stops or a module that
  goes away.

### Access

`new Commands({ allowed: access => access === 'player' || DEV })`, once the console opens outside dev mode; `main.ts`
passes no `allowed` yet, so everything runs, and the console only opens with `?dev`. A command is `dev` unless it says `player`. One
that isn't allowed is left out of `help` and completion, and typing it says it needs dev mode, rather than pretending
it doesn't exist. Multiplayer (#1) adds its own question here (host only, or a vote) without touching the commands.

### Hooks

```ts
const stop = commands.use((call, next) => {    // call: { name, args, source }
  if (call.source === 'url' && call.name === 'kr') return 'Not from a link.';
  return next();                               // run the command and the hooks inside this one
});
```

A hook wraps every command that runs: it can look at the call, refuse it, change or record the result. The first one added is the
outermost. This is where cross-cutting work goes, so no command has to know about it:

| Hook | What it does | Issue |
|---|---|---|
| Log | writes each line and its result to the Log tab | #218 |
| Record | keeps the lines that changed the sim, with the step they ran in, for replays | #49 |
| Network | sends a host's commands to the other players, refuses a guest's dev command | #1 |

The `source` on the call says where the line came from: `console`, `url`, `script` or `test`. An unknown command, or
one that isn't allowed, is answered before the hooks, so a hook never sees it; the Log tab takes those lines from the
console itself.

### Completion

`commands.complete(line)` gives the words that could finish the last word of the line: command names first, then the
command's `complete(index, before)`, which `command()` fills from the arguments' choices. The console's Tab is UI work
on top of it (below). Only names complete, not aliases, so Tab offers each command once.

### Words

A line is split on spaces; there is no quoting. A `rest` argument gets the words left joined by single spaces, so
`say hej   då` arrives as `hej då`.

### Commands that take time

Planned, and built with the first command that needs it (`bench`, step 5), so no code waits unused:

- A command defines one of `run(values, call): string` or `runAsync(values, call): Promise<string>`; `command()` takes
  either, so typed arguments work the same.
- The registry offers both: `commands.run(line)` stays synchronous and answers an async command with a pointer to
  `runAsync`; `commands.runAsync(line)` runs either kind, a sync one as an answer that is already there. The console box
  calls `runAsync`; tests and `?cmd=` lines can call `run` for commands they know are sync.
- A hook's `next()` then returns `string | Promise<string>`. A hook that only looks at the call or refuses it doesn't
  change; one that reads the result (timing, the Log) handles both.
- An async answer lands between frames, whenever the job ends. With #49, a replay records the intent the command
  queued, never when its answer came back.

Until then, a long job answers "started" at once and reports through the Log.

## What comes next

Each step is a PR of its own, in this order; the first two are what #218 asks for.

1. **Tab and a hint in the box.** Tab completes from `complete()` (twice shows the choices), and the input shows the
   usage line of the command being typed. Page code in `devconsole.ts`; a smoke step types a command and checks it ran.
2. **The core dev commands**, each in the module that owns the state, with `command()`: `god`, `stars <0-3>` (police),
   `go <place>` (from #346's spots), `car <model>`, `fps`. Each one's rule gets a unit test in its module.
3. **Tunables** (#217). One adapter turns the registry's entries into `set <key> <value>`, `get <key>`, `list
   [prefix]` and `reset [key]`, with the key as a `choice` and the value as a `num` with the entry's range and unit. A
   tunable never registers a command of its own.
4. **The Log tab.** A small `Log` in sim code (a ring buffer of `{ level, text, at }`) that any module writes to, and
   that the console shows beside the Dev tab. Warnings that go to `console.warn` today go there too. Chat (#7) is a
   third tab later.
5. **Performance.** A small `Perf` module in sim code that the frame loop and the systems write marks to, timed with a
   clock passed in (`performance.now()` in the page, a fake in tests), so a test or a replay stays deterministic.
   `perf on|off`, `perf top` and `perf mark <name>` read it into the Log tab or the debug overlay (#257). A timing hook
   (`commands.use`) times the commands themselves. Heavy measuring, such as `bench pathfind 1000`, runs as a job in a
   worker (or WebAssembly) that the command only starts: `run` answers at once ("started"), and the job posts its result
   to the Log when it is done.
6. **Lines from outside the box.** `?cmd=god;go torget` runs at start in dev mode, with source `url`, so a preview
   link or a smoke test starts where it needs to; `exec <name>` and `bind <key> <line>` (dev) follow when someone
   wants them. `;` separates lines in all of them.
7. **Commands into the sim step** (with #49). Today a command changes state the moment it runs, between frames. Once
   the sim steps on a fixed timestep, a command that changes sim state queues an intent that the next step applies,
   which is what replays and multiplayer need. The contract above stays; only what `run` does inside changes.

## Open questions

- **Test writes.** The test hook (`window.__joyride`) is read-only by rule. Smoke tests can type into the console
  instead, or start with `?cmd=`. A write path in the hook only if that proves too slow.
- **Who sees the console in a release build.** Today it opens in dev mode only. With the Log tab and `player`
  commands, it could open for everyone, with dev commands still behind `?dev`.
- **Lab flags** (#227) could get `lab on <id>` once experiments can start and stop without a reload.
