# AGENTS.md

Instructions for AI coding agents (and a quick start for humans) working on Vrigstad Joyride. Read [ARCHITECTURE.md](ARCHITECTURE.md) before changing structure; read [README.md](README.md) for what the game is.

## The project in one paragraph

A browser open-world driving game set in the real village of Vrigstad, Sweden, built from OpenStreetMap data and elevation tiles, plus a 3D map of the same area. Rendering is three.js. The codebase is in transition from a single-file prototype to a modular Vite + TypeScript app; the plan is tracked in [#61](https://github.com/OliverRomhagen/vrigstad-joyride/issues/61). The build is Vite ([#44](https://github.com/OliverRomhagen/vrigstad-joyride/issues/44)), and the game's code is split into modules ([#177](https://github.com/OliverRomhagen/vrigstad-joyride/issues/177)): input, the HUD, health, the police, the player on foot, the safehouses and the kiosk, the trisslott, cats, pets, pedestrians, the menu plate, the kiosk and cat menus (`kiosk-cat-menus.ts`) and what pressing E does, getting in and out of cars included (`actions.ts`), have their own files in `src/game/`, the state `main.ts` shares with them is in `src/game/state.ts`, the car rules are in `src/game/cars.ts`, crashes in `crashes.ts`, the E prompt in `prompt.ts`, the main loop in `loop.ts` and the test hook in `test-hook.ts`, and the 3D scene, the camera and the car meshes and damage are in `src/game/render/`. `src/game/main.ts` only creates the modules and connects them. The map is one file, `src/map/main.ts`. Both read the world's data and queries from `src/world/` ([#48](https://github.com/OliverRomhagen/vrigstad-joyride/issues/48)).

## Commands

```sh
npm install                 # once
npm run dev                 # dev server with hot reload: the game at http://localhost:5173/, the map at /map.html
npm run check               # typecheck, lint and format check (Biome), then the static gate (Fallow); run before every commit, with npm test, and CI runs it on every PR that changes code
npm run format              # apply Biome's formatting and safe lint fixes
npm test                    # unit tests (Vitest), once
npm run analyze:report      # reading passes (Fallow): copied code and complexity hotspots; reported, never fails
npm run build               # production build into dist/ (index.html, map.html)
npm run preview             # serve the built dist/ locally
npx playwright install chromium   # once, for the smoke tests
npm run test:e2e            # Playwright smoke tests against the built pages in dist/; build first. Before a commit, run only yours (see Tests)
npm run data                # rebuild data/vrigstad.json from data/raw/ (Python standard library only); run npm run build after, the data is built into the pages
npm run data:report         # what the streetscape and street furniture rules infer from data/vrigstad.json (the second half of the coverage reports)
tools/fetch.sh              # re-download OSM + elevation (rarely needed; hits public APIs)
```

Live site: https://oliverromhagen.github.io/vrigstad-joyride/ (GitHub Pages, from the `gh-pages` branch, which `.github/workflows/pages.yml` builds and deploys on every push to `main`).

## Workflow

- Work on a branch and open a PR; don't push to `main`. For work on an issue, start the branch with `gh issue develop <n> --checkout`: GitHub then links the branch, and the PR made from it, to the issue. For work that only does part of an issue, make the branch yourself (see **Link** below).
- A `feat` PR gets a playable preview link commented on it; add the `preview` label to get one for any other PR (see "Preview links" in the README).
- A PR into `main` that changes code, a workflow or AGENTS.md gets a review by Claude once it's out of draft ([#469](https://github.com/OliverRomhagen/vrigstad-joyride/issues/469), an experiment), posted as inline comments with a summary comment that shows what it cost.
  - PRs from forks aren't reviewed. Nor are the upper PRs of a stack until they're retargeted to `main`, when the one below them merges, and then pushed again: the push from `gh stack sync` gets the review, so the lower PR's merged code isn't reviewed again.
  - What the review looks for is in `.github/claude-review.md`. Change it there.
  - The workflow, `.github/workflows/claude-review.yml`, runs from `main`, and so does the instructions file. A change to either takes effect once it merges, not in its own PR.
  - A PR by someone with no merged PR here yet waits until a maintainer approves its review, on the run's page (the `claude-review-approval` environment).
  - Files that `.gitattributes` on `main` marks `linguist-generated` or `linguist-vendored` are left out of the review: mark a new generated file there. The summary folds those away. Binary files and very large patches are left out too, and very long lines are cut short; the summary lists these to read by hand.
- Keep a PR to one concern. Don't mix a refactor with a feature, and don't reformat code you aren't otherwise changing.
- Reference the issue in the PR (`Closes #12`, or `Part of #12` if it doesn't fully close it). Say in the PR what is *not* done. The PR template (`.github/pull_request_template.md`) asks for that. When a PR is opened, `.github/workflows/pr-triage.yml` assigns it to its author when they have write access, and comments while the description references no issue.
- PRs that build on each other are a stack. Prefer `gh stack` (`gh extension install github/gh-stack`): `gh stack init` or `add` builds the stack, `gh stack submit` pushes it and opens the PRs, and `gh stack sync` rebases what's left after a lower PR merges or a lower branch is rebased: until then the PRs above it still hold its old commits, and their diffs repeat them. Merge from the bottom up. When a PR outside the stack targets one of its branches, merge one PR at a time, never the whole stack at once: merged together, the stack's branches are deleted together, and GitHub closes that PR instead of moving it to `main`. After a squash merge it still holds the stack's old commits, so its author rebases it onto `main` (`git rebase --onto origin/main <the old tip of the branch it targeted>`).
- Big structural moves conflict with every open feature branch. Check open PRs first, and coordinate rather than rebasing someone else's work.

### Commits and PR titles: Conventional Commits

Every commit message **and every PR title** follows [Conventional Commits](https://www.conventionalcommits.org/):

```
<type>(<optional scope>): <imperative summary, lower case, no period>
```

- Types: `feat` (new gameplay or feature), `fix`, `perf`, `refactor` (no behaviour change), `docs`, `test`, `build` (Vite, npm, `tools/build.mjs`), `ci`, `style` (formatting only), `chore`, `data` for changes to `data/` or the map pipeline, and `revert`.
- Scopes are optional and name the area. They are the same list as the `scope:` labels (see Tickets): `world`, `npc`, `police`, `vehicles`, `player`, `hud`, `audio`, `minigames`, `multiplayer`, `architecture`.
- Examples: `feat(police): add roadblocks at three stars`, `fix(hud): keep street sign inside safe area on iPhone`, `refactor(world): share terrain code between game and map`, `data: refresh OSM extract`.
- The whole first line is at most 72 characters, which is where GitHub cuts a commit subject off with "…". For a PR title, count the ` (#123)` that the squash merge adds: a title can use 72 minus the length of ` (#n)`, so 65 for now (64 from #1000 on). CI checks only the PR title, which is enough while every merge is a squash; keep commit subjects on a branch within 72 too. Use the room, rather than cutting the summary shorter than it needs to be. Add a body for the *why* when it isn't obvious.
- Release notes are generated from PR titles (see "Releases" in the README), and the type sets the version bump: `feat` → minor, `fix` / `perf` → patch.
- Merge PRs with **squash**. The PR title becomes the commit subject, so it must follow the same format.
- The `PR title` check (`.github/workflows/pr-title.yml`) enforces the types, the lower-case summary with no period, and the length of the PR title. A summary can't start with a capital, so rephrase one that would start with a place name (`fix(world): fill Slättsjön to the shore`, not `fix(world): Slättsjön fills to the shore`), and retitle a GitHub "Revert" PR as `revert: …`.

### Tickets

GitHub issues are the backlog: every bug, idea and piece of work is one issue.

- **Write** the outcome in the title ("Police lose you after 18 s out of sight", not "police fix"). The body says the problem, the proposal and when it's done; the issue forms in `.github/ISSUE_TEMPLATE/` ask for exactly that.
- **Type** every issue in GitHub's Type field, not with a label: `Bug`, `Feature` (new gameplay or content) or `Task` (tech, tooling, docs, or improving an existing feature). The forms set it; from the CLI, `gh issue create --type Feature`. A PR has no type field: its Conventional Commits title is its type. The PR triage workflow copies it into a label for the release notes' sections (`type:feat`, `type:refactor` and so on, and `breaking` for a `!`), and keeps the label in step with the title: don't set these by hand.
- **Label** every issue when you file it, and every PR when you open it:
  - **A priority**, on issues: `prio:high`, `prio:mid` or `prio:low`. Use `status:future` for options to decide on later. Use `status:blocked` on a PR that waits for something outside it, such as another PR or a decision; an issue that waits on another gets a **blocked by** link instead (see **Link** below). A collaborator who files an issue picks the priority they think fits; for issues from people who can't set labels, triage adds it. The maintainers change it when they rank differently.
  - **At most one scope**, if one fits: `scope:world`, `npc`, `police`, `vehicles`, `player`, `hud`, `audio`, `minigames`, `multiplayer`, `architecture` (`.github/labels.yml` says what each covers). If two fit, the issue is probably two issues. When a PR is opened, the same workflow adds its scope from the title (`feat(world): …` gives `scope:world`), else from the referenced issue when that has one scope. A retitle changes it while it is still the scope the old title gave; a scope set or removed by hand stays.
  - **`lab`** (an opt-in experiment), **`accessibility`** (a barrier for people with disabilities) and **`security`** (hardening that is fine to discuss in public; not a vulnerability) describe the change itself, so they also carry over from the referenced issue to the PR when it is opened, or when an edit makes the description reference a different issue. Priority and status labels stay on the issue.
- **Labels live in `.github/labels.yml`.** Add or rename one there, in a PR: the PR shows what would change, and the merge applies it. Rename with `from_name: <old name>` on the entry, or a new label is created and the old one stays on its issues. The sync never deletes a label: to delete one, remove it from the file and run `gh label delete`. A label made in GitHub's settings or with `gh label create` isn't in the file; add it there. Add a new `scope:<area>` only when several issues need it, with a one-line description, and add it to the commit scopes above in the same PR. Don't create one-off labels for a single issue or PR.
- **Link** issues by what the link means:
  - `#12` in text is a mention: it shows in #12's timeline and nowhere else. Use it for "related" and "see also".
  - `Closes #12` in a PR description links the PR to the issue and closes it when the PR merges. A branch made with `gh issue develop 12` does the same, even when the description says `Part of #12`: for work that only does part of an issue, make the branch yourself.
  - A tracking issue holds its parts as **sub-issues** (`gh issue edit 61 --add-sub-issue 43,44`). An issue has at most one parent.
  - When an issue can't start before another is done, mark it **blocked by** that one (`gh issue edit 44 --add-blocked-by 43`). "Easier after" or "should come first" stays in the body as a mention.
- When you split an issue, the new issues mention the old one, and the old one is closed or becomes their parent.
- To check issues against these rules, run the read-only `ticket-triage` agent ([.claude/agents/ticket-triage.md](.claude/agents/ticket-triage.md)). To file one from a sentence, use `/new-ticket` ([.claude/skills/new-ticket/SKILL.md](.claude/skills/new-ticket/SKILL.md)): it drafts, checks for duplicates, and creates the issue once you confirm. Another agent can follow either file's instructions directly.

### Several agents at once

- One branch (and worktree) per agent and task. Bring your branch up to date with `main` before opening a PR and again before merging.
- Most features still add a line or two to `src/game/main.ts`, where the modules are connected, so expect small conflicts there. Keep changes in their own section of the file where you can.
- To see whether a branch conflicts with `main`, or with an open PR that may merge first, without touching the worktree or the index: after `git fetch origin`, `git merge-tree --write-tree --name-only --no-messages origin/main <branch>` merges the two. It prints a tree id, then the files that conflict, if any, and exits with 1 when there is a conflict. To compare with an open PR instead, fetch it (`git fetch origin pull/<n>/head`) and pass `FETCH_HEAD` in place of `origin/main`.
- Say how you tested in the PR, and be honest about what wasn't tested ("not played by hand on a phone").

### Lab experiments

An experiment is work that ships switched off for everyone, until a player opts in with `?lab=<id>`. It is written where its code will live once it graduates, behind a flag check ([#323](https://github.com/OliverRomhagen/vrigstad-joyride/issues/323)); why is in ARCHITECTURE.md (Decisions).

- **Start one:** add `{ id, name, cost }` to `LAB_EXPERIMENTS` in `src/lab/flags.ts`; `cost` says in one line what switching it on costs a player (a download, frame time, nothing). Write its code where it belongs, in its own files where possible: rules in `src/game/` or `src/game/sim/` (plain data, no three.js, no DOM), drawing in `src/game/render/`, world code in `src/world/`. A panel or other DOM is a page module: list it as the Tests section says. The architecture checks then apply from the first commit.
- **Gate it where it's wired in:** each gate is a `lab.on('<id>')` check in page code, so `git grep "lab.on('<id>')"` finds every one. `lab` is made in the lab section of `src/game/main.ts`; a page module that gates gets it passed in. Sim and render code can't import the flags (Fallow's zones), so they get the experiment as a constant or a callback when they're built, which also keeps the check out of the hot loops. Load its code with `import()` behind the check, so it doesn't run when the flag is off, and only warn when it fails: `if (lab.on('<id>')) import('./<module>').then(m => m.start…(…)).catch(err => console.warn('Lab: <id> failed', err));`. Import it statically only when it must apply before the page draws, such as a font. It may change the rules, but only behind its flag.
- **Test it:** unit tests go where its code's tests will stay, mirroring `src/`. With the flag off, the game must run exactly as before, so the existing smoke tests need no change; a smoke step with `?lab=<id>` is optional. Try it locally and in the PR's preview with `?lab=<id>`: a `feat` PR gets a preview link by itself; any other PR needs the `preview` label.
- **Its issue and PR:** label the issue `lab`. The PR gets the label too when it references the issue (`Closes #n` or `Part of #n`) or its branch name starts with the issue number. Put the preview link with `?lab=<id>` in the PR, and say in the issue what would decide the experiment.
- **Leaving the lab:** an experiment that works graduates in its own PR: delete its `LAB_EXPERIMENTS` entry, and turn each gate into ordinary wiring (a static import or a direct call, without the check). If a smoke test used its flag, keep one step that checks the old flag is now ignored, as the ragdolls' does. One that doesn't work is dropped: delete its files, its tests, its gates and its entry.

### Reviewing PRs

Claude Code's built-in `/code-review` checks a change against this file, so these rules apply to it as much as to a review by hand:

- Start with the problem the PR solves, in one line, and ask whether this is the best way to solve it. A better alternative is the first finding: what it is, why it's better, and the rough cost to switch. If the approach holds, say so in one line. An alternative that widens the issue's scope is a follow-up.
- Read the earlier reviews first. A point stays open until the current head fixes it; credit the fix when it's there.
- Every finding has its file:line and the code or input that triggers it. A claim you couldn't confirm is marked **unverified**, or dropped; a check you couldn't run (not playable headless, code not on the branch) is **not assessed**, never passed.
- Split the findings into **before merging** and **follow-ups**. A one-line fix goes inline as a suggestion block.
- An agent posts the review only when asked.

### Claude Code in this repo

Shared agents (`.claude/agents/`) and skills (`.claude/skills/`) come with the repo, so every collaborator's Claude Code has them. Agents advise; none edits tracked files, and `performance-analyst` runs commands to build and measure, in a scratch worktree. Some are adapted from [Claude Code Game Studios](https://github.com/donchitos/claude-code-game-studios) (MIT, see `LICENSE`). Each holds only its own expertise and points here for the rules, so a refactor doesn't make it wrong. Try one on a real task before relying on it, and drop one nobody reaches for (#255 lists what was left out). Claude can start any of them on its own when a request matches its description.

| Reach for | When |
|---|---|
| `threejs-specialist` | Rendering code; three.js changes after r176 are in [docs/threejs.md](docs/threejs.md) |
| `performance-analyst`, `/perf-profile` | Low fps, stutter, a performance regression |
| `/balance-check` | Whether the numbers are balanced, e.g. before merging a tuning change |
| `writer` | What people in the game say, in local Swedish |
| `game-designer`, `/quick-design` | Shaping a feature from the player's side; a short spec for a small change |
| `systems-designer`, `economy-designer` | The maths behind a mechanic; money, prices and payouts |
| `ai-programmer` | How police, traffic, pedestrians and animals decide and move |
| `level-designer` | Choosing and laying out a real place for play |
| `technical-artist` | Art styles, post-processing, effects, model and texture budgets |
| `ux-designer`, `ui-programmer`, `accessibility-specialist` | Flows, controls and the HUD; reviewing UI code; barriers for disabled players |
| `sound-designer` | Specifying sounds and the mix before they're made |
| `network-programmer`, `security-engineer` | Multiplayer sync; strings into HTML, saved data, CI permissions, privacy |
| `/playtest-report` | Turning playtest notes on a preview into one shape |
| `/test-flakiness` | Flaky or slow smoke tests in CI |
| `/asset-audit` | Every model, image, sound and font has a licence, is used and fits a budget |
| `/onboard` | A guide for a new collaborator's area |
| `ticket-triage`, `/new-ticket` | Checking and filing issues (Tickets, above) |

## Code style

- **Match the surrounding code.** Same naming, comment density and idiom as the file you're in.
- Current single-file code is dense: 2-space indent, single quotes, semicolons, short local names for hot math (`x`, `z`, `h`, `v`, `dt`), sections marked `// ---------- name ----------`. Keep that style inside `src/game/main.ts` and `src/map/main.ts` until each is reformatted, and keep the names of code moved out of them (see Naming).
- New TypeScript code: formatted by Biome (`npm run format`), so don't hand-format. When a PR that reformats code merges, its author adds the squash commit to `.git-blame-ignore-revs` in a follow-up PR, so `git blame` skips the reformat. The pages (`src/*.html`, `src/game/main.ts`, `src/map/main.ts`) aren't formatted yet (`biome.jsonc`): the game's script until a PR of its own reformats it, the map's until it is split up, but the two scripts are still checked for undeclared names, unused variables and unused imports. The repo's `.vscode/` settings make Biome the formatter in VS Code, so a Prettier you set up for other projects doesn't reformat files on save. Prefer clear names over the dense style, small modules with one responsibility, named exports, no default exports, `strict` types, no `any` without a comment saying why.
- Classes, data or functions, by what the thing is:
  - **A class** for something built once and then queried, or that holds state or resources with a lifecycle: a world index (`Heightfield`, `RoadNetwork`, `BuildingIndex`), a controller, an object that owns meshes and disposes them, a Svelte store with `$state` fields. Depend on the narrow part you use (`Pick<Heightfield, 'heightAt'>`), so a test can pass a stub.
  - **Plain data** for simulation state (#49): it has to be copied to a worker or over the network, snapshotted for replays and compared in tests. No methods on entities.
  - **Functions** for pure helpers (`pointInPolygon`).

  A method passed around as a function loses `this`: call it on its object, `bind` it once, or make it an arrow field (`toggle = () => { … }`) when it's meant to be handed out.
- Comments explain *why* and non-obvious units or conventions, not what the next line does.
- No new runtime dependency without saying why in the PR. Dev dependencies (tooling, tests) are fine.
- Gameplay numbers (speeds, radii, timers) go in named constants near the top of their module, with units in the name or a comment (`EVADE_DIST_M = 170`). The cars' numbers have moved into the tunables registry (#217): a number in the driving model, the steering or a car type's speed and response goes in its object (`DRIVING`, `STEERING`, `VEHICLE_SPECS`) and in `src/game/sim/car-tunables.ts`, with a unit, a range and a line of help, so `?tune=` and the console can change it. The unit and help live only in the registry; a comment beside the value says why it is what it is. Other areas follow.
- Avoid per-frame allocations in the game loop: reuse vectors (`const _v = new THREE.Vector3()` at module level) as the existing code does.

### Naming

Defaults for new code; review checks them, no linter does.

- **Name a thing for what it is.** If a reviewer has to ask what a name holds ("is `idx` a node or a road?"), rename it. A domain word and a structural word aren't interchangeable: a `car` (the sim object) isn't its `VehicleVisuals` model, and a `footprint` isn't a `building`.
- **Booleans read as a question or a state:** `canDrift`, `inCar`, `dragging`, `menuOpen`. Add `is`, `has`, `can` or `should` when the bare word could be read as a noun or a verb: a flag beside the function `busted()` would be `isBusted`, not `busted`.
- **Handlers and callbacks are named by what they do** (`endDrag`, `closeMenu`, `spawnTraffic`), not by the event (`handleClick`, `onPointerUp`). Pass a named handler by reference when it's used more than once or is longer than a line; a short one-off can stay an inline arrow. The callbacks a module takes in its `*Deps` object are named the same way: `caught`, `spawnCar`, `drawStars` (`src/game/police.ts`).
- **Getters over `getX()` on classes** for a value the object already has (`get dragging()` in `src/game/input.ts`). Sim entities stay plain data with no methods, as above. Keep `getX()` or `loadX()` for work that costs something, such as an async load.
- **Fixed sets of values are `as const` maps with upper-case keys, not enums:** `RoadClass = { PRIMARY: 0, SECONDARY: 1, … } as const` (`src/world/data.ts`). An `Error` subclass only when a caller branches on it.
- **Names people type or read as strings are kebab-case:** event names (`star-added`), tunable keys (`vehicle.volvo.top-speed`, with dots between levels), command names, and lab and vehicle ids (`xc70-police`). Hyphens need no Shift on a Swedish keyboard, and keep our names apart from snake_case ones we copy in (OSM tags, GLB node names). Names in code stay camelCase (a property can be `topSpeed` while its tunable key is `top-speed`), and constants `UPPER_SNAKE`.
- **A leading `_`** marks a module-level scratch object (`_v`, above) or an unused parameter (`(_e, i) => …`). For an array slot you skip, leave it out: `const [, x, z] = row`. Biome's unused-variable and unused-parameter rules skip `_` names.
- **Private members** use TypeScript's `private`, as the existing classes do, not `#`.

**When to break them:**
- **Names someone else owns keep their spelling:** three.js and the DOM (`visible`, `castShadow`, `needsUpdate`, `hidden`), OSM tags and the data in `data/vrigstad.json`.
- **Existing code isn't renamed just to follow these.** Rename when you're changing that code anyway; a rename that touches many lines is its own `refactor` PR.
- **Code moved out of a `main.ts` keeps its names** in the PR that moves it (#177), so a reviewer can compare it with the old code. Biome reformats it in its new module, so move it in one commit, changing only what the move needs (exports, imports, reads through its `*Deps`), and run `npm run format` in the next; `git diff --color-moved` on the first commit then shows what really changed. The move commit is the one commit that may fail `npm run check`; the PR's last commit passes it. Clear names can follow in a later PR.
- **Inside `src/game/main.ts` and `src/map/main.ts`, match the surrounding code**, as above, until each is reformatted.
- **When a name reads better another way, use it** and say why in the PR. Consistency with nearby code beats a general rule.

## Architecture rules (summary; details in ARCHITECTURE.md)

1. **World code is shared.** Terrain, roads, buildings, water and spatial queries live in one place and are used by both the game and the map. Don't copy them into either page.
2. **Simulation doesn't know about rendering.** Gameplay state and rules are plain data and functions: no three.js, no DOM. Rendering reads sim state; it never changes it.
3. **Input becomes intents and commands.** What is held every frame becomes an intent, and gameplay reads `throttle / steer / brake`, never key codes or touch events. What happens once, such as pressing E to get into a car, becomes a command (ARCHITECTURE.md, "Commands in, events out").
4. **UI is DOM over the canvas.** The HUD and menus are HTML/CSS (Svelte after [#51](https://github.com/OliverRomhagen/vrigstad-joyride/issues/51)). They read from a store and send intents or commands; they never reach into game objects.
5. **Deterministic where it matters.** Use the seeded `rnd()`, not `Math.random()`, in anything gameplay-related, so tests and future replays and multiplayer work. Adding `rnd()` calls changes every later random value, so world generation will shift; that's expected. A self-contained side system that rolls every frame (such as the cats) gets its own stream from `makeRnd(seed)`, so it doesn't shift the rolls of everything else.

Until the migration reaches a given rule, don't make the existing code worse in that direction (for example, don't add more three.js calls inside gameplay rules).

## Tests

- **Smoke tests** (Playwright, [#43](https://github.com/OliverRomhagen/vrigstad-joyride/issues/43)): the pages load without console errors, Start works, the player can move and get into a car. Every PR keeps them green. When you add a major feature, add one smoke step for it. Each page load costs CI seconds of software WebGL, so a test loads the page once and runs at 640×360 (`page.setViewportSize`), as the clouds and Volvo tests do, unless a screenshot needs the detail of the default 1280×720.
- **Unit tests** (Vitest, [#52](https://github.com/OliverRomhagen/vrigstad-joyride/issues/52)): game rules and pure helpers such as height lookup, driving model, wanted level, police AI and spatial queries. Write them for new gameplay rules; use the seeded RNG for deterministic scenarios. They live in `tests/unit/`, mirroring `src/`, and run in CI on every PR that changes more than docs, labels, issue forms, agent files or other workflows (`.github/workflows/unit.yml`). Build test worlds small and by hand (`tests/unit/world/fixture.ts`), not from `data/vrigstad.json`, so each expected value can be worked out.
- **No pixel-diff tests.** Headless WebGL output varies. Assert on state exposed through the test hook instead, and attach screenshots to the PR when visuals change.
- For review screenshots, `?at=x,z,yaw,pitch` starts the player at (x, z) looking that way, `?debug=streetscape` tints the streetscape by its evidence (mapped, derived, inferred), and `?debug=furniture` tints street furniture by its source (OSM, override, procedural).
- In dev mode (`?dev`), uncaught errors show in a red box over the game (a tap or `errors clear` empties it), and the console's `fps` shows frame times, what the renderer draws and the build's commit, which is also `build` in the test hook (`src/game/presentation/debug-overlay.ts`). A screenshot of it makes a good bug report from a phone.
- The numbers in the tunables registry take `?dev&tune=driving.grip:8,vehicle.volvo.top-speed:45` (keys in `src/game/sim/car-tunables.ts`), in dev mode only; a key or value it can't use is a warning in the browser's console, and the rest still apply. In the console, `tune set`, `tune get`, `tune list` and `tune reset` change them while you play.
- The sky's clouds take URL parameters for visual testing: `?clouds=clear|scattered|partly|mostly|off`, `cloudSeed=7`, `wind=250,7` (from degrees, m/s), `cloudSoft=1.3` and `cloudQuality=low|high` (`src/world/clouds.ts`).
- The smoke tests live in `tests/e2e/` and run in CI on every PR that changes more than docs, labels, issue forms, agent files or other workflows (`.github/workflows/e2e.yml`), split across three runners with Playwright's `--shard` and reported as one `Smoke tests (Playwright)` check. The workflow also fails if the committed `data/vrigstad.json` is stale, and uploads screenshots of both pages as the `e2e-screenshots` artifact. They read game state from `window.__joyride.state()` (defined in `src/game/test-hook.ts`); add a field there when a new smoke step needs one, and keep the hook read-only.
- **Static analysis** ([Fallow](https://github.com/fallow-rs/fallow), [#107](https://github.com/OliverRomhagen/vrigstad-joyride/issues/107)), configured in `fallow.toml`, is the last step of `npm run check`, so it runs before every commit and in CI (`.github/workflows/check.yml`), and takes well under a second:
  - The gate (`fallow dead-code`) fails on: an unused file, export, class member or dependency; a circular import; an import across the layers in `fallow.toml` (`world` imports only `world`; `sim` only `sim` and `world`; `render` anything but the page code).
  - Biome (`biome.jsonc` and `tools/biome/`) and tsc check the architecture rules Fallow can't see, on the same zones. Rule 2, in `world` and `sim` code: `tsconfig.sim.json` leaves out the DOM library, so tsc rejects every page global and type there (`window`, `innerWidth`, `HTMLElement`, …); Biome flags the common ones as you type, `addEventListener` on any object, and a `three` import outside `src/world/mesh/` and `three-legacy.ts`. Rule 3: Biome flags the keyboard, mouse, pointer, touch, wheel and gamepad event types and event names in `world`, `sim` and `render` code. Rule 5: Biome flags `Math.random` anywhere in `src/` but the map, and any other use of `Math` than reading a property such as `Math.floor`, since `const { random } = Math` or `const M = Math` hands it on. Two names aren't flagged, since they name other things as often: `"wheel"` and `"click"`. They still miss an event name built at runtime (`` `key${'down'}` ``) and a raw key read such as `keys.run`, which looks like any other property without types.
  - A new module in `src/game/` is `sim` code by default, so the rules above apply from its first commit. A page module, one that uses the DOM or the HUD, goes in the `page` list in `fallow.toml`, the rule-2 override's negated list in `biome.jsonc` and the `exclude` list in `tsconfig.sim.json` instead (`tests/unit/zones.test.ts` fails until the three match), until #49 gives the rules their own `src/game/sim/`.
  - The exceptions for code that breaks a rule today are listed in `fallow.toml` and `biome.jsonc`, each with what ends it. Remove an entry when its code is fixed; don't add one for new code: fix the finding, or say in the PR why the rule is wrong. For a single line, `// fallow-ignore-next-line <rule>` with a reason works too, with the name Fallow prints (`unused-export`, `boundary-violation`), and `// biome-ignore lint/<group>/<rule>: <reason>` for Biome, such as `lint/plugin/no-math-random` at the trisslott. When an export is only used by a test, that counts as used.
  - `npm run analyze:report` prints copied code (`fallow dupes`) and the files where complexity meets churn (`fallow health --hotspots`). Read it before refactoring; it doesn't fail.
- **Before a commit**, run `npm run check` and `npm test` in full: they take seconds. The smoke tests render WebGL in software and keep every core busy for minutes, so run only the ones for what you changed, plus the ones that load the page and get into the Volvo, on one or two workers, after a build, since they test `dist/`: `npm run build && npx playwright test -g "kiosk|loads with no console errors|gets you in" --workers=2`. CI runs the whole suite on every PR. A change to the wiring in `src/game/main.ts` or to the frame loop can break another feature's test, so a red CI run after a green subset is expected now and then, not a reason to run everything locally.
- The page modules (`main.ts`, `loop.ts`, `prompt.ts`, the HUD) and the rendering are out of the unit tests' reach: test changes there in a browser too, and describe what you did in the PR.

## Data and coordinates

- World units are **metres**. Origin is at 57.3555° N, 14.4756° E (near Torget). **x points east, z points south**, y is up. The playable square is 2200 m × 2200 m, from −1100 to 1100.
- `data/vrigstad.json` is generated by `tools/process.py`. Don't edit it by hand; change the script and rebuild.
- `data/raw/` is the downloaded source data. Only refresh it on purpose (it changes the map).
- Map data is © OpenStreetMap contributors (ODbL). Keep the attribution visible in both pages. Any new third-party asset, model, font or sound needs its licence added to `LICENSE`.

## Language and tone

- UI text, code, comments, commits and issues: **English**.
- What people in the game *say* (NPC lines, police, shouts) is **Swedish**, informal and local. Real place and street names keep their Swedish spelling (Torget, Slättsjön, Gästgivaregatan).
- The humour is affectionate toward Vrigstad. Real *places* are fine. Real, identifiable people (see #9) only with the maintainers' explicit go-ahead, and never in a mean or embarrassing way.

## Glossary

| Term | Meaning |
|---|---|
| Torget | The village square; spawn and respawn point |
| *Gripen!* | "Caught!": the busted screen |
| Stars | Wanted level, 0–3; each star sends a police car |
| Evade | Staying ~170 m from all police for 18 s to clear the stars |
| EPA-traktor | A car converted to a 30 km/h vehicle, a Swedish rural classic |
| Polis | Police car |
| Trisslott | Swedish scratch lottery ticket (kiosk minigame) |
| Safehouse | A house where you can lie low to clear stars |

Code terms, so docs, issues and PRs use one word for one thing:

| Term | Meaning |
|---|---|
| ECS | Entity–component–system: entities are plain data, made of components, and systems are functions over every entity with a given set of components. Not adopted yet (#55). Say ECS, not "component pattern" or "entity system" |
| Entity | One thing in the sim: a car, a cat, a pedestrian. Plain data, no methods |
| ECS component | One named piece of data on an entity (`position`, `police`). Write "ECS component" where "component" could mean a Svelte component |
| System | A function the sim runs every step over the entities it handles (traffic, the chase). With an ECS, the entities that have a given set of components |
| Sim | Gameplay state and rules: plain data and functions, no three.js or DOM (Architecture rules, rule 2) |
| Render | The code that reads sim state each frame and draws it; it never writes to the sim |
| Intent | What held input becomes: `throttle / steer / brake`. Gameplay reads intents, never keys or touches; a one-off action, such as pressing E, is a command (`docs/console.md`) |

Update this file when a convention changes. If you notice the instructions are wrong or out of date, fix them in your PR.
