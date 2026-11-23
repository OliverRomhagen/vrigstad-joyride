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
 panels*          (panel) │     │ alias → name
 tests             (test) ┘     │
                                └─► one line back ─► the console's output (the Log tab, later)
```

`*` not built yet: steps 4 and 7 of [What comes next](#what-comes-next).

- **`Commands`** (`src/game/commands.ts`) is the one registry. It is sim code, so it runs in a unit test, a worker
  or a server, and it knows nothing about the box you type into.
- **`DevConsole`** (`src/game/devconsole.ts`) is page code: the DOM box, its keys, history and focus. It sends lines
  to the registry and prints what comes back. Svelte replaces it after #51; the registry doesn't change.
- **Modules own their commands.** A command is registered in the module that owns the state it changes, next to the
  rule it calls, and `main.ts` calls the module's register function once. It takes `Pick<Commands, 'register'>`:
  - a class registers its own with a `registerCommands` method (`Pets`, `Wanted`);
  - a module of plain data and functions exports `register<Area>Commands` (`registerWalletCommands` in
    `src/game/economy.ts`, `registerHealthCommands` in `src/game/health.ts`).

  The one exception is an adapter that makes commands for every entry of a registry, such as the tunables' `set` and
  `get` (#357): it gets a `*-commands.ts` file of its own beside the registry, since no one entry owns those commands.

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
- **A group** holds commands under one name: `group({ help, subcommands: { set, get } })` registers `tune`, and
  `tune set driving.grip 8` runs its `set`. Use one for a family of commands with names that other areas could want
  (`list`, `reset`). The registry follows the subcommands for help, `--help`, Tab and the usage line, so
  `tune set --help` and `help tune set` both work; hooks see the group's name, with the subcommand as the first
  argument. A subcommand's examples start with the whole path (`tune set …`).
- **Every command explains itself.** `help` is required: one line of up to 80 characters (`HELP_MAX`) saying what it
  does, and `register` refuses a command without it. Commands register at start-up, so a refused one stops the whole
  page: a module that registers commands calls its register function in a unit test (`registerWalletCommands` in
  `tests/unit/game/economy.test.ts`), which catches it in seconds. `details` (a few lines), `examples` (whole lines, each starting
  with the command's name or an alias) and a line per argument (`described(int('speed'), 'km/h')`) are optional.
  `help <command>` shows all of it, and so does `<command> --help` or `-h`, which the registry answers for every
  command before it runs: no command handles `--help` itself. Only `--help` or `-h` on its own after the name counts
  (`kr 3 --help` runs `kr`), so no command can take `-h` as its only value. Like an unknown command, the answer doesn't
  pass through the hooks: it changes nothing.
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

The `source` on the call says where the line came from: `console`, `url`, `script` (binds, `exec`), `panel` or `test`. An unknown command, or
one that isn't allowed, is answered before the hooks, so a hook never sees it; the Log tab takes those lines from the
console itself.

What a hook can rely on, and what it can't yet:

- **`next()` runs the command once.** A hook that calls it twice (a retry, a timing hook that measures twice) gets the
  same line back the second time, or the same error if the command threw; the command doesn't run again.
- **A hook can't tell a failed run from a good one.** A `UsageError` reaches the hooks as a finished "… Usage: …" line,
  and a command that throws skips the code after `next()` in every hook. The Record hook needs to know which runs
  changed the sim, so it brings a result that says so (`{ ok, text }` or similar) when it is built.
- **A command that runs another line** through the registry starts a call of its own, with source `console` unless it
  passes one. Record and Network would take that line as typed by a person and keep it twice. A command that runs lines
  passes `call.source` on, and the Record hook keeps only the outermost call; both come with the Record hook.

### Completion

`commands.complete(line)` gives the words that could finish the last word of the line: command names first, then the
command's `complete(index, before)`, which `command()` fills from the arguments' choices. The console's Tab is UI work
on top of it (below). Only names complete, not aliases, so Tab offers each command once.

### Words

A line is split on spaces; there is no quoting. A `rest` argument gets the words left joined by single spaces, so
`say hej   då` arrives as `hej då`.

### Commands that take time

Planned, and built with the first command that needs it (`bench`, step 6), so no code waits unused:

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

## Panels and plugins

The registry is the shell, and it stays pure: it knows nothing about panels. UI that does more than a line of text,
such as a tuning board with sliders, is a **panel**: page code that the console box hosts, in a tab of its own or a
section of one.

```ts
const stop = consoleUi.addPanel({
  id: 'tune-cars',
  title: 'Cars',
  mount(el) {            // a plain DOM element: lil-gui, plain DOM or Svelte (#51) all fit
    …
    return () => { … };  // unmount
  },
});
```

- **A panel changes the game only through commands or the tunables registry** (#217), never by reaching into game
  objects (Architecture rule 4). A slider runs `tune set vehicle.volvo.grip 0.8` with source `panel`; Copy reads
  `tune list vehicle.volvo`. So the hooks see every change: the Log shows it, and the Record hook can replay a tuning session.
- **A panel reads** through the registry too, or through a store the page already has, so it works the same when the
  sim runs in a worker (#49) or on a host (#1).
- **A plugin is a bundle** of commands, hooks and a panel, all optional, installed and taken out as one:

  ```ts
  installPlugin({ id: 'tune-cars', access: 'dev', commands: { … }, hooks: [ … ], panel: { … } });
  ```

  Every part already returns the function that takes it out again, so uninstalling calls them. A plugin turns on
  with `?dev` or a lab flag (#227), and costs nothing until then, loaded with `import()`.
- Not everything has to be a plugin: a core command stays in the module that owns its state (step 2). A plugin is for
  a tool that comes and goes as a whole, such as the car tuning board (#277), the stats and lil-gui view of #53, or a
  workbench nobody has thought of yet.

`consoleUi` and `installPlugin` are page code, built in step 4; their names can change then. A panel library such as
lil-gui would be a new dependency: dev only, loaded with `import()` with its plugin, and its PR says why.

## What comes next

Each step is a PR of its own, in this order; the first two are what #218 asks for.

1. **Tab and a hint in the box.** Tab completes from `complete()` (twice shows the choices), and the input shows the
   usage line of the command being typed. Page code in `devconsole.ts`; a smoke step types a command and checks it ran.
2. **The core dev commands** (#356), each in the module that owns the state, with `command()`: `god [mode]`
   (`health.ts`), `stars <0-3>` (`police.ts`), and `fps [on]` and `errors clear` (the dev overlay,
   `presentation/debug-overlay.ts`) are built; `go <place>` (from #346's spots) and `car <model>` follow. Each one's rule gets a unit test in its module.
3. **Tunables** (#217, built in #357). `src/game/sim/tunable-commands.ts` turns the registry's entries into
   `tune set <tunable> <value>`, `tune get <tunable>`, `tune list [prefix]` and `tune reset [tunable]`, with the key as
   a `choice` and the value as a `num` that the registry checks against the entry's range. They sit under `tune`, so
   `list` and `reset` stay free for other areas. A tunable never registers a command of its own. `?tune=` sets the same
   numbers at load, in dev mode only.
4. **Tabs, panels and the Log tab.** The console box gets the panel contract (see [Panels and
   plugins](#panels-and-plugins)), and the Dev tab and a Log tab are its first two panels. The Log is a small `Log` in
   sim code (a ring buffer of `{ level, text, at }`) that any module writes to; warnings that go to `console.warn`
   today go there too. Chat (#7) is a third tab later.
5. **The first plugin: car tuning** (#277). Sliders over the cars' tunables that change the feel while you drive, and
   a Copy button for the values to paste into code. It needs steps 3 and 4, and shows the plugin shape works.
6. **Performance.** A small `Perf` module in sim code that the frame loop and the systems write marks to, timed with a
   clock passed in (`performance.now()` in the page, a fake in tests), so a test or a replay stays deterministic.
   `perf on|off`, `perf top` and `perf mark <name>` read it into the Log tab or the debug overlay (#257). A timing hook
   (`commands.use`) times the commands themselves. Heavy measuring, such as `bench pathfind 1000`, runs as a job in a
   worker (or WebAssembly) that the command only starts: `run` answers at once ("started"), and the job posts its result
   to the Log when it is done.
7. **Lines from outside the box.** `?cmd=god;go torget` runs at start in dev mode, with source `url`, so a preview
   link or a smoke test starts where it needs to; `exec <name>` and `bind <key> <line>` (dev) follow when someone
   wants them. `;` separates lines in all of them.
8. **Commands into the sim step** (with #49). Today a command changes state the moment it runs, between frames. Once
   the sim steps on a fixed timestep, a command that changes sim state queues an intent that the next step applies,
   which is what replays and multiplayer need. The contract above stays; only what `run` does inside changes.

## Open questions

- **Test writes.** The test hook (`window.__joyride`) is read-only by rule. Smoke tests can type into the console
  instead, or start with `?cmd=`. A write path in the hook only if that proves too slow.
- **Who sees the console in a release build.** Today it opens in dev mode only. With the Log tab and `player`
  commands, it could open for everyone, with dev commands still behind `?dev`.
- **Lab flags** (#227) could get `lab on <id>` once experiments can start and stop without a reload.
