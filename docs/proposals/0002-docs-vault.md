---
status: draft
author: MikaelJohnAndersson
related: ["#214", "#37", "#4", "#74"]
---

# 0002: A docs vault for proposals, decisions, research and lore

*Draft for the team to discuss. Nothing here is decided until this PR merges.*

## Problem

The repo has a lot of writing, spread across a few big files (AGENTS.md, ARCHITECTURE.md, DESIGN.md in #214) and PR descriptions. Proposals have no home of their own: #214's ticket list lives in a PR description, and the reasoning behind a decision is hard to find once the PR is merged. Content such as characters, dialogue and quests (#37, #4) will need a format that people who don't write code can edit.

## Proposal

A `docs/` folder of plain Markdown that is also an [Obsidian](https://obsidian.md) vault. It reads fine on GitHub and in any editor; Obsidian is a nicer way in, not a requirement.

```
docs/
  README.md        what's where, how to open the vault
  proposals/       one file per proposal: 0001-..., 0002-...
  decisions/       short records of settled choices, one per file
  research/        comparisons and investigations
  assets/          one note per model, sound or font: source, licence, where it's used
  lore/            Vrigstad's characters, places and quests (see below)
  attachments/     images the notes embed
```

### Proposals

- One file per proposal, numbered, with frontmatter: `status` (`draft`, `discussing`, `accepted`, `rejected`), `author`, `related` issues.
- A proposal is discussed in its PR, and **accepted by merging it** with `status: accepted`. A rejected one can be merged as `rejected`, so the reasoning stays findable.
- #214 would become `0001-game-design.md`; this file is `0002`.

### Decisions

The "Decisions" list in ARCHITECTURE.md, as one short file each, linking to the proposal or issue behind it. ARCHITECTURE.md keeps a one-line summary per decision and links to the file.

### Research

Comparisons like the tone routes in #214, engine choices (#58), local AI models for the experiments. Written once, linked from proposals.

### Assets

AGENTS.md requires every third-party asset's licence in `LICENSE`. A note per asset (source, author, licence, files that use it) makes that checkable, and `LICENSE` can be generated from the notes later.

### Lore: notes the game reads

The most fun part. A map's authored layer (#214, "Maps") is written as Markdown notes: one per character, place or quest, with game data in the frontmatter and text in the body.

```md
---
kind: character
home: torget               # a map anchor (#74)
appearance: { hair: grey, hat: keps }
---
# Pastorn

Has lost his bible again.

## Dialogue
- Har du sett min bibel?
- Den låg här i går, jag lovar.
```

The data pipeline turns `docs/lore/` into game data, the way `tools/process.py` turns OSM into `data/vrigstad.json`. So:

- anyone can add a character, a line or a quest without touching code: the "dialogue is data" that #37 and #4 already ask for;
- Obsidian's graph shows how characters, places and quests connect, and links between notes (`[Pastorn](pastorn.md)` in a quest) become references in the data;
- a custom map, or a mod later, can be a folder of notes.

Whether lore lives in `docs/lore/` or next to the map data (`data/vrigstad/lore/`) is open: docs is easier to browse, data is clearer about what ships in the game.

## Working with it

- **Links:** normal relative Markdown links, not Obsidian's `[[wikilinks]]`, so they work on GitHub too. The committed `docs/.obsidian/app.json` sets Obsidian to write them that way.
- **Diagrams:** Mermaid, which renders on GitHub and in Obsidian. Canvas boards (`.canvas`, plain JSON) for mood boards and flows.
- **Shared config only:** `app.json` is committed; each person's workspace layout is in `.gitignore`. Plugins are suggestions in `docs/README.md`, not committed.
- **Suggested plugins:** Dataview (index pages that fill themselves: every proposal under discussion, every quest that starts at Torget), Excalidraw (sketches), Git.

## Publishing: the wiki

The vault is also the project's wiki: a site built from `docs/` and served next to the game, at `/vrigstad-joyride/wiki/`. People who never open the repo, players included, can read the lore, the proposals and the decisions there.

- **On `main`, not a branch of its own.** The game reads `docs/lore/`, so lore has to change together with the code that reads it. A separate wiki branch, or GitHub's built-in wiki (a separate repo, with no PR review), would drift from the code.
- **Built by [Quartz](https://quartz.jzhao.xyz).** It is made for publishing Obsidian vaults: backlinks, a graph view, tags and callouts come out much as they look in Obsidian, and for lore the links between characters, places and quests are the point. VitePress would match our Vite build but has no backlinks or graph. Quartz is set up by cloning its repo, not installed from npm, so CI clones a pinned tag.
- **Deployed with the game.** `pages.yml` builds the wiki in the same job as the game and puts it in `site/wiki/`, so one push to `gh-pages` carries both. A second workflow pushing to `gh-pages` would race the first.
- **Previews for docs PRs.** A PR that changes `docs/` gets its wiki built into its preview (`pr-preview/pr-<n>/wiki/`), so a writer sees the rendered page before merging.
- **Lore is checked.** Once the game reads lore notes, a typo in their frontmatter can break the build. A CI check validates `docs/lore/` frontmatter on every PR. A PR that changes only prose outside `lore/` skips the game's e2e tests.
- **Easy for writers.** CODEOWNERS gives the lore writer `docs/lore/`, so they review lore PRs. A `lore` commit scope lets `docs(lore): add Pastorn` pass the PR title check. The GitHub web editor or Obsidian's Git plugin is enough to make a PR without a terminal.
- **Public.** The site is public, and so is every draft in `docs/`. Spoilers and half-written lore are visible to anyone who looks.

## Done when

- `docs/` exists with its README and folders, and opens as an Obsidian vault with working links.
- #214 has moved to `docs/proposals/0001-game-design.md`, and this proposal is accepted or rejected in its file.
- AGENTS.md says where proposals, decisions and research go.

Lore read by the game is its own follow-up issue, once dialogue (#37) is being built. Publishing the wiki is another, filed when this is accepted.

## Open questions

- Do we move DESIGN.md into the vault, or keep it at the root next to ARCHITECTURE.md and put only proposals in `docs/`?
- Lore in `docs/lore/` or next to the map data?
- Numbered proposals (`0002-`) or dated ones (`2026-11-docs-vault`)?
- Is a public wiki fine for lore drafts, or do drafts stay out of the build until they are ready (a `draft: true` in their frontmatter, which Quartz can skip)?
- Quartz, or VitePress to stay on one build tool?
