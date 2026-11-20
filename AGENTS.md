# AGENTS.md

Instructions for AI coding agents (and a quick start for humans) working on Vrigstad Joyride. Read [ARCHITECTURE.md](ARCHITECTURE.md) before changing structure; read [README.md](README.md) for what the game is.

## The project in one paragraph

A browser open-world driving game set in the real village of Vrigstad, Sweden, built from OpenStreetMap data and elevation tiles, plus a 3D map of the same area. Rendering is three.js. The codebase is in transition from a single-file prototype to a modular Vite + TypeScript app; the plan is tracked in [#61](https://github.com/OliverRomhagen/vrigstad-joyride/issues/61). The build is Vite ([#44](https://github.com/OliverRomhagen/vrigstad-joyride/issues/44)), and the code is splitting into modules ([#177](https://github.com/OliverRomhagen/vrigstad-joyride/issues/177)): input, the HUD, health, the police, the player on foot, the safehouses and the kiosk, the trisslott, cats, pets, pedestrians, the menu plate, the kiosk and cat menus (`kiosk-cat-menus.ts`) and what pressing E does, getting in and out of cars included (`actions.ts`), have their own files in `src/game/`, the state `main.ts` shares with them is in `src/game/state.ts`, and the car rules are in `src/game/cars.ts`, but the 3D scene, crashes and car damage, the camera and the main loop are still in `src/game/main.ts`. The map is one file, `src/map/main.ts`. Both read the world's data and queries from `src/world/` ([#48](https://github.com/OliverRomhagen/vrigstad-joyride/issues/48)).

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
npm run data:report         # what the streetscape rules infer from data/vrigstad.json (the second half of the coverage report)
tools/fetch.sh              # re-download OSM + elevation (rarely needed; hits public APIs)
```

Live site: https://oliverromhagen.github.io/vrigstad-joyride/ (GitHub Pages, from the `gh-pages` branch, which `.github/workflows/pages.yml` builds and deploys on every push to `main`).

## Workflow

- Work on a branch and open a PR; don't push to `main`. For work on an issue, start the branch with `gh issue develop <n> --checkout`: GitHub then links the branch, and the PR made from it, to the issue. For work that only does part of an issue, make the branch yourself (see **Link** below).
- A `feat` PR gets a playable preview link commented on it; add the `preview` label to get one for any other PR (see "Preview links" in the README).
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
- Until #177 finishes splitting the code, most features edit `src/game/main.ts`, so expect conflicts. Keep changes in their own section of the file where you can.
- Say how you tested in the PR, and be honest about what wasn't tested ("not played by hand on a phone").

## Code style

- **Match the surrounding code.** Same naming, comment density and idiom as the file you're in.
- Current single-file code is dense: 2-space indent, single quotes, semicolons, short local names for hot math (`x`, `z`, `h`, `v`, `dt`), sections marked `// ---------- name ----------`. Keep that style inside `src/game/main.ts` and `src/map/main.ts` until they are split up, and keep the names of code moved out of them (see Naming).
- New TypeScript code: formatted by Biome (`npm run format`), so don't hand-format. When a PR that reformats code merges, its author adds the squash commit to `.git-blame-ignore-revs` in a follow-up PR, so `git blame` skips the reformat. The pages (`src/*.html`, `src/game/main.ts`, `src/map/main.ts`) aren't formatted until #177 splits them (`biome.jsonc`), but the two scripts are still checked for undeclared names, unused variables and unused imports. The repo's `.vscode/` settings make Biome the formatter in VS Code, so a Prettier you set up for other projects doesn't reformat files on save. Prefer clear names over the dense style, small modules with one responsibility, named exports, no default exports, `strict` types, no `any` without a comment saying why.
- Classes, data or functions, by what the thing is:
  - **A class** for something built once and then queried, or that holds state or resources with a lifecycle: a world index (`Heightfield`, `RoadNetwork`, `BuildingIndex`), a controller, an object that owns meshes and disposes them, a Svelte store with `$state` fields. Depend on the narrow part you use (`Pick<Heightfield, 'heightAt'>`), so a test can pass a stub.
  - **Plain data** for simulation state (#49): it has to be copied to a worker or over the network, snapshotted for replays and compared in tests. No methods on entities.
  - **Functions** for pure helpers (`pointInPolygon`).

  A method passed around as a function loses `this`: call it on its object, `bind` it once, or make it an arrow field (`toggle = () => { … }`) when it's meant to be handed out.
- Comments explain *why* and non-obvious units or conventions, not what the next line does.
- No new runtime dependency without saying why in the PR. Dev dependencies (tooling, tests) are fine.
- Gameplay numbers (speeds, radii, timers) go in named constants near the top of their module, with units in the name or a comment (`EVADE_DIST_M = 170`).
- Avoid per-frame allocations in the game loop: reuse vectors (`const _v = new THREE.Vector3()` at module level) as the existing code does.

### Naming

Defaults for new code; review checks them, no linter does.

- **Name a thing for what it is.** If a reviewer has to ask what a name holds ("is `idx` a node or a road?"), rename it. A domain word and a structural word aren't interchangeable: a `car` (the sim object) isn't its `VehicleVisuals` model, and a `footprint` isn't a `building`.
- **Booleans read as a question or a state:** `canDrift`, `inCar`, `dragging`, `menuOpen`. Add `is`, `has`, `can` or `should` when the bare word could be read as a noun or a verb: a flag beside the function `busted()` would be `isBusted`, not `busted`.
- **Handlers and callbacks are named by what they do** (`endDrag`, `closeMenu`, `spawnTraffic`), not by the event (`handleClick`, `onPointerUp`). Pass a named handler by reference when it's used more than once or is longer than a line; a short one-off can stay an inline arrow. The callbacks a module takes in its `*Deps` object are named the same way: `caught`, `spawnCar`, `drawStars` (`src/game/police.ts`).
- **Getters over `getX()` on classes** for a value the object already has (`get dragging()` in `src/game/input.ts`). Sim entities stay plain data with no methods, as above. Keep `getX()` or `loadX()` for work that costs something, such as an async load.
- **Fixed sets of values are `as const` maps with upper-case keys, not enums:** `RoadClass = { PRIMARY: 0, SECONDARY: 1, … } as const` (`src/world/data.ts`). An `Error` subclass only when a caller branches on it.
- **A leading `_`** marks a module-level scratch object (`_v`, above) or an unused parameter (`(_e, i) => …`). For an array slot you skip, leave it out: `const [, x, z] = row`. Biome's unused-variable and unused-parameter rules skip `_` names.
- **Private members** use TypeScript's `private`, as the existing classes do, not `#`.

**When to break them:**
- **Names someone else owns keep their spelling:** three.js and the DOM (`visible`, `castShadow`, `needsUpdate`, `hidden`), OSM tags and the data in `data/vrigstad.json`.
- **Existing code isn't renamed just to follow these.** Rename when you're changing that code anyway; a rename that touches many lines is its own `refactor` PR.
- **Code moved out of a `main.ts` keeps its names** in the PR that moves it (#177), so a reviewer can compare it with the old code. Biome reformats it in its new module, so move it in one commit, changing only what the move needs (exports, imports, reads through its `*Deps`), and run `npm run format` in the next; `git diff --color-moved` on the first commit then shows what really changed. The move commit is the one commit that may fail `npm run check`; the PR's last commit passes it. Clear names can follow in a later PR.
- **Inside `src/game/main.ts` and `src/map/main.ts`, match the surrounding code**, as above, until #177 splits them.
- **When a name reads better another way, use it** and say why in the PR. Consistency with nearby code beats a general rule.

## Architecture rules (summary; details in ARCHITECTURE.md)

1. **World code is shared.** Terrain, roads, buildings, water and spatial queries live in one place and are used by both the game and the map. Don't copy them into either page.
2. **Simulation doesn't know about rendering.** Gameplay state and rules are plain data and functions: no three.js, no DOM. Rendering reads sim state; it never changes it.
3. **Input becomes intents.** Gameplay reads `throttle / steer / brake / action`, never key codes or touch events.
4. **UI is DOM over the canvas.** The HUD and menus are HTML/CSS (Svelte after [#51](https://github.com/OliverRomhagen/vrigstad-joyride/issues/51)). They read from a store and send intents; they never reach into game objects.
5. **Deterministic where it matters.** Use the seeded `rnd()`, not `Math.random()`, in anything gameplay-related, so tests and future replays and multiplayer work. Adding `rnd()` calls changes every later random value, so world generation will shift; that's expected. A self-contained side system that rolls every frame (such as the cats) gets its own stream from `makeRnd(seed)`, so it doesn't shift the rolls of everything else. (Known exception: the trisslott odds still use `Math.random()`.)

Until the migration reaches a given rule, don't make the existing code worse in that direction (for example, don't add more three.js calls inside gameplay rules).

## Tests

- **Smoke tests** (Playwright, [#43](https://github.com/OliverRomhagen/vrigstad-joyride/issues/43)): the pages load without console errors, Start works, the player can move and get into a car. Every PR keeps them green. When you add a major feature, add one smoke step for it.
- **Unit tests** (Vitest, [#52](https://github.com/OliverRomhagen/vrigstad-joyride/issues/52)): game rules and pure helpers such as height lookup, driving model, wanted level, police AI and spatial queries. Write them for new gameplay rules; use the seeded RNG for deterministic scenarios. They live in `tests/unit/`, mirroring `src/`, and run in CI on every PR that changes more than docs, labels, issue forms, agent files or other workflows (`.github/workflows/unit.yml`). Build test worlds small and by hand (`tests/unit/world/fixture.ts`), not from `data/vrigstad.json`, so each expected value can be worked out.
- **No pixel-diff tests.** Headless WebGL output varies. Assert on state exposed through the test hook instead, and attach screenshots to the PR when visuals change.
- For review screenshots, `?at=x,z,yaw,pitch` starts the player at (x, z) looking that way, and `?debug=streetscape` tints the streetscape by its evidence (mapped, derived, inferred).
- The sky's clouds take URL parameters for visual testing: `?clouds=clear|scattered|partly|mostly|off`, `cloudSeed=7`, `wind=250,7` (from degrees, m/s), `cloudSoft=1.3` and `cloudQuality=low|high` (`src/world/clouds.ts`).
- The smoke tests live in `tests/e2e/` and run in CI on every PR that changes more than docs, labels, issue forms, agent files or other workflows (`.github/workflows/e2e.yml`), which also fails if the committed `data/vrigstad.json` is stale and uploads screenshots of both pages as the `e2e-screenshots` artifact. They read game state from `window.__joyride.state()` (defined at the end of `src/game/main.ts`); add a field there when a new smoke step needs one, and keep the hook read-only.
- **Static analysis** ([Fallow](https://github.com/fallow-rs/fallow), [#107](https://github.com/OliverRomhagen/vrigstad-joyride/issues/107)), configured in `fallow.toml`, is the last step of `npm run check`, so it runs before every commit and in CI (`.github/workflows/check.yml`), and takes well under a second:
  - The gate (`fallow dead-code`) fails on: an unused file, export, class member or dependency; a circular import; an import across the layers in `fallow.toml` (`world` imports only `world`; `sim` only `sim` and `world`; `render` anything but the page code).
  - Biome (`biome.jsonc` and `tools/biome/`) and tsc check the architecture rules Fallow can't see, on the same zones. Rule 2, in `world` and `sim` code: `tsconfig.sim.json` leaves out the DOM library, so tsc rejects every page global and type there (`window`, `innerWidth`, `HTMLElement`, …); Biome flags the common ones as you type, `addEventListener` on any object, and a `three` import outside `src/world/mesh/` and `three-legacy.ts`. Rule 3: Biome flags the keyboard, mouse, pointer, touch, wheel and gamepad event types and event names in `world`, `sim` and `render` code. Rule 5: Biome flags `Math.random` anywhere in `src/` but the map, and any other use of `Math` than reading a property such as `Math.floor`, since `const { random } = Math` or `const M = Math` hands it on. Two names aren't flagged, since they name other things as often: `"wheel"` and `"click"`. They still miss an event name built at runtime (`` `key${'down'}` ``) and a raw key read such as `keys.run`, which looks like any other property without types.
  - A new module in `src/game/` is `sim` code by default, so the rules above apply from its first commit. A page module, one that uses the DOM or the HUD, goes in the `page` list in `fallow.toml`, the rule-2 override's negated list in `biome.jsonc` and the `exclude` list in `tsconfig.sim.json` instead (`tests/unit/zones.test.ts` fails until the three match), until #177 gives the rules their own `src/game/sim/`.
  - The exceptions for code that breaks a rule today are listed in `fallow.toml` and `biome.jsonc`, each with what ends it, except the trisslott's `Math.random`, a `biome-ignore` on its line in `main.ts`. Remove an entry when its code is fixed; don't add one for new code: fix the finding, or say in the PR why the rule is wrong. For a single line, `// fallow-ignore-next-line <rule>` with a reason works too, with the name Fallow prints (`unused-export`, `boundary-violation`), and `// biome-ignore lint/<group>/<rule>: <reason>` for Biome, such as `lint/plugin/no-math-random` at the trisslott. When an export is only used by a test, that counts as used.
  - `npm run analyze:report` prints copied code (`fallow dupes`) and the files where complexity meets churn (`fallow health --hotspots`). Read it before refactoring; it doesn't fail.
- **Before a commit**, run `npm run check` and `npm test` in full: they take seconds. The smoke tests render WebGL in software and keep every core busy for minutes, so run only the ones for what you changed, plus the ones that load the page and get into the Volvo, on one or two workers, after a build, since they test `dist/`: `npm run build && npx playwright test -g "kiosk|loads with no console errors|gets you in" --workers=2`. CI runs the whole suite on every PR. Until #177 splits `src/game/main.ts`, a change there can break another feature's test, so a red CI run after a green subset is expected now and then, not a reason to run everything locally.
- Much of the gameplay still lives in `src/game/main.ts`, out of the unit tests' reach until #177 moves it into modules: test changes there in a browser too, and describe what you did in the PR.

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

Update this file when a convention changes. If you notice the instructions are wrong or out of date, fix them in your PR.
