# AGENTS.md

Instructions for AI coding agents (and a quick start for humans) working on Vrigstad Joyride. Read [ARCHITECTURE.md](ARCHITECTURE.md) before changing structure; read [README.md](README.md) for what the game is.

## The project in one paragraph

A browser open-world driving game set in the real village of Vrigstad, Sweden, built from OpenStreetMap data and elevation tiles, plus a 3D map of the same area. Rendering is three.js. The codebase is in transition from a single-file prototype to a modular Vite + TypeScript app; the plan is tracked in [#61](https://github.com/OliverRomhagen/vrigstad-joyride/issues/61). **Check which side of the transition you're on** (is there a `vite.config.*`?) and follow the matching instructions below.

## Commands

Today (before Vite; `package.json` only holds the smoke tests):

```sh
python3 tools/build.py      # rebuild index.html and map.html from src/ and data/
tools/fetch.sh              # re-download OSM + elevation (rarely needed; hits public APIs)
python3 -m http.server      # then open http://localhost:8000 (opening index.html from disk also works)
npm install && npx playwright install chromium   # once, for the smoke tests
npm run test:e2e            # Playwright smoke tests against the built index.html and map.html; rebuild first
```

Live site: https://oliverromhagen.github.io/vrigstad-joyride/ (GitHub Pages, from `main`).

After the move to Vite ([#44](https://github.com/OliverRomhagen/vrigstad-joyride/issues/44)), use the npm scripts instead and update this section in the same PR:

```sh
npm run dev                 # dev server with hot reload
npm run check               # typecheck + lint + unit tests; run before every commit
npm run test:e2e            # Playwright smoke tests
npm run build               # production build into dist/
```

## Workflow

- Work on a branch and open a PR; don't push to `main`. For work on an issue, start the branch with `gh issue develop <n> --checkout`: GitHub then links the branch, and the PR made from it, to the issue.
- Keep a PR to one concern. Don't mix a refactor with a feature, and don't reformat code you aren't otherwise changing.
- Reference the issue in the PR (`Closes #12`, or `Part of #12` if it doesn't fully close it). Say in the PR what is *not* done. The PR template (`.github/pull_request_template.md`) asks for that.
- PRs that build on each other are a stack. Prefer `gh stack` (`gh extension install github/gh-stack`): `gh stack init` or `add` builds the stack, `gh stack submit` pushes it and opens the PRs, and `gh stack sync` rebases what's left after a lower PR merges. Merge from the bottom up.
- Until [#45](https://github.com/OliverRomhagen/vrigstad-joyride/issues/45) lands, the built `index.html` and `map.html` are committed. Rebuild them in the same commit as the `src/` change, and never edit them by hand.
- Big structural moves conflict with every open feature branch. Check open PRs first, and coordinate rather than rebasing someone else's work.

### Commits and PR titles: Conventional Commits

Every commit message **and every PR title** follows [Conventional Commits](https://www.conventionalcommits.org/):

```
<type>(<optional scope>): <imperative summary, lower case, no period>
```

- Types: `feat` (new gameplay or feature), `fix`, `perf`, `refactor` (no behaviour change), `docs`, `test`, `build` (Vite, npm, `tools/build.py`), `ci`, `style` (formatting only), `chore`, `data` for changes to `data/` or the map pipeline, and `revert`.
- Scopes are optional and name the area. They are the same list as the `scope:` labels (see Tickets): `world`, `npc`, `police`, `vehicles`, `player`, `hud`, `audio`, `minigames`, `architecture`.
- Examples: `feat(police): add roadblocks at three stars`, `fix(hud): keep street sign inside safe area on iPhone`, `refactor(world): share terrain code between game and map`, `data: refresh OSM extract`.
- Summary under ~70 characters. Add a body for the *why* when it isn't obvious.
- Release notes are generated from PR titles (see "Releases" in the README), and the type sets the version bump: `feat` → minor, `fix` / `perf` → patch.
- Merge PRs with **squash**. The PR title should become the commit subject, so it must follow the same format. (This needs the repo's squash setting to use the PR title; until the owner changes that, check the squash commit title when merging.)
- The `PR title` check (`.github/workflows/pr-title.yml`) enforces the types, the scopes and the lower-case summary with no period. Until the squash setting uses the PR title, a PR with a single commit squashes to that commit's message, so the check validates it too. The summary length isn't checked. A summary can't start with a capital, so rephrase one that would start with a place name (`fix(world): fill Slättsjön to the shore`, not `fix(world): Slättsjön fills to the shore`), and retitle a GitHub "Revert" PR as `revert: …`.

### Tickets

GitHub issues are the backlog: every bug, idea and piece of work is one issue.

- **Write** the outcome in the title ("Police lose you after 18 s out of sight", not "police fix"). The body says the problem, the proposal and when it's done; the issue forms in `.github/ISSUE_TEMPLATE/` ask for exactly that.
- **Type** every issue in GitHub's Type field, not with a label: `Bug`, `Feature` (new gameplay or content) or `Task` (tech, tooling, docs, or improving an existing feature). The forms set it; from the CLI, `gh issue create --type Feature`. A PR has no type field: its Conventional Commits title is its type.
- **Label** every issue when you file it, and every PR when you open it:
  - **A priority**, on issues: `prio:high`, `prio:mid` or `prio:low`. Use `status:future` for options to decide on later. A collaborator who files an issue picks the priority they think fits; for issues from people who can't set labels, triage adds it. The maintainers change it when they rank differently.
  - **At most one scope**, if one fits: `scope:world`, `npc`, `police`, `vehicles`, `player`, `hud`, `audio`, `minigames`, `architecture` (`.github/labels.yml` says what each covers). If two fit, the issue is probably two issues.
- **Labels live in `.github/labels.yml`.** Add or rename one there, in a PR: the PR shows what would change, and the merge applies it. Rename with `from_name: <old name>` on the entry, or a new label is created and the old one stays on its issues. The sync never deletes a label: to delete one, remove it from the file and run `gh label delete`. A label made in GitHub's settings or with `gh label create` isn't in the file; add it there. Add a new `scope:<area>` only when several issues need it, with a one-line description, and add it to the commit scopes above and to `scopes` in `.github/workflows/pr-title.yml` in the same PR. Don't create one-off labels for a single issue or PR.
- **Link** issues by what the link means:
  - `#12` in text is a mention: it shows in #12's timeline and nowhere else. Use it for "related" and "see also".
  - `Closes #12` in a PR description links the PR to the issue and closes it when the PR merges.
  - A tracking issue holds its parts as **sub-issues** (`gh issue edit 61 --add-sub-issue 43,44`). An issue has at most one parent.
  - When an issue can't start before another is done, mark it **blocked by** that one (`gh issue edit 44 --add-blocked-by 43`). "Easier after" or "should come first" stays in the body as a mention.
- When you split an issue, the new issues mention the old one, and the old one is closed or becomes their parent.
- To check issues against these rules, run the read-only `ticket-triage` agent ([.claude/agents/ticket-triage.md](.claude/agents/ticket-triage.md)). To file one from a sentence, use `/new-ticket` ([.claude/skills/new-ticket/SKILL.md](.claude/skills/new-ticket/SKILL.md)): it drafts, checks for duplicates, and creates the issue once you confirm. Another agent can follow either file's instructions directly.

### Several agents at once

- One branch (and worktree) per agent and task. Bring your branch up to date with `main` before opening a PR and again before merging.
- Until #44 splits the code, every feature edits `src/game.html`, so expect conflicts. Keep changes in their own section of the file where you can.
- On a conflict in `index.html` or `map.html`, never merge the built files by hand: resolve `src/` only, then rerun `python3 tools/build.py`.
- Say how you tested in the PR, and be honest about what wasn't tested ("not played by hand on a phone").

## Code style

- **Match the surrounding code.** Same naming, comment density and idiom as the file you're in.
- Current single-file code is dense: 2-space indent, single quotes, semicolons, short local names for hot math (`x`, `z`, `h`, `v`, `dt`), sections marked `// ---------- name ----------`. Keep that style inside `src/*.html` until it is migrated.
- New TypeScript code (after #44): formatted by Biome, so don't hand-format. Prefer clear names over the dense style, small modules with one responsibility, named exports, no default exports, `strict` types, no `any` without a comment saying why.
- Comments explain *why* and non-obvious units or conventions, not what the next line does.
- No new runtime dependency without saying why in the PR. Dev dependencies (tooling, tests) are fine.
- Gameplay numbers (speeds, radii, timers) go in named constants near the top of their module, with units in the name or a comment (`EVADE_DIST_M = 170`).
- Avoid per-frame allocations in the game loop: reuse vectors (`const _v = new THREE.Vector3()` at module level) as the existing code does.

## Architecture rules (summary; details in ARCHITECTURE.md)

1. **World code is shared.** Terrain, roads, buildings, water and spatial queries live in one place and are used by both the game and the map. Don't copy them into either page.
2. **Simulation doesn't know about rendering.** Gameplay state and rules are plain data and functions: no three.js, no DOM. Rendering reads sim state; it never changes it.
3. **Input becomes intents.** Gameplay reads `throttle / steer / brake / action`, never key codes or touch events.
4. **UI is DOM over the canvas.** The HUD and menus are HTML/CSS (Svelte after [#51](https://github.com/OliverRomhagen/vrigstad-joyride/issues/51)). They read from a store and send intents; they never reach into game objects.
5. **Deterministic where it matters.** Use the seeded `rnd()`, not `Math.random()`, in anything gameplay-related, so tests and future replays and multiplayer work. Adding `rnd()` calls changes every later random value, so world generation will shift; that's expected. (Known exception: the trisslott odds still use `Math.random()`.)

Until the migration reaches a given rule, don't make the existing code worse in that direction (for example, don't add more three.js calls inside gameplay rules).

## Tests

- **Smoke tests** (Playwright, [#43](https://github.com/OliverRomhagen/vrigstad-joyride/issues/43)): the pages load without console errors, Start works, the player can move and get into a car. Every PR keeps them green. When you add a major feature, add one smoke step for it.
- **Unit tests** (Vitest, [#52](https://github.com/OliverRomhagen/vrigstad-joyride/issues/52)): game rules and pure helpers such as height lookup, driving model, wanted level, police AI and spatial queries. Write them for new gameplay rules; use the seeded RNG for deterministic scenarios.
- **No pixel-diff tests.** Headless WebGL output varies. Assert on state exposed through the test hook instead, and attach screenshots to the PR when visuals change.
- The smoke tests live in `tests/e2e/` and run in CI on every PR (`.github/workflows/e2e.yml`), which also fails if the committed `index.html` / `map.html` are stale and uploads screenshots of both pages as the `e2e-screenshots` artifact. They read game state from `window.__joyride.state()` (defined at the end of `src/game.html`); add a field there when a new smoke step needs one, and keep the hook read-only.
- Until the unit-test tooling exists, also test gameplay changes in a browser and describe what you did in the PR.

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
