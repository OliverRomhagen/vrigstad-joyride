---
name: asset-audit
description: "Audits the game's assets (models, textures, images, sounds, fonts): each has its licence in LICENSE, is used somewhere, and fits a size budget."
argument-hint: "[models|images|audio|fonts|all, default all]"
disable-model-invocation: true
---

# Asset audit

Read-only: report, then propose fixes; change nothing.

## 1. Find the assets and the rules

- **Assets:** list every binary asset in the repo with `git ls-files` (models `*.glb`/`*.gltf`, images, audio, fonts), skipping `data/raw/` (map source data, not assets). Today they're mostly `src/public/media/` and `media/`.
- **Licences:** `LICENSE` (third-party section) and any `NOTICE` or source doc it points at, such as `docs/vehicle-fleet.md` for the car models.
- **Budgets:** the size budget the relevant issue or doc states. If none is stated, the size column is **not assessed — no budget set**; report the sizes and propose a budget, never invent one as if it existed.

If there are no assets of a category, say so: an empty category is **nothing to audit**, not a pass.

## 2. Check each asset

Measure with commands (`wc -c`, `file`); a value you couldn't measure is **not assessed**, never an estimate.

| Check | How |
|---|---|
| **Licence** | Covered by an entry in `LICENSE` (directly or by its folder), with author, licence and source. Missing is the most serious finding: `AGENTS.md` requires one for every third-party asset |
| **Used** | Referenced from `src/` (`git grep` the file name). Unreferenced files are orphans; a referenced path with no file is broken |
| **Size** | Bytes, against the budget. For GLBs, also triangle count and embedded texture sizes if a quick script can read them; otherwise not assessed |
| **Format** | Textures a power of two; GLB rather than glTF + loose files; audio compressed (`.ogg`/`.mp3`), not `.wav` |
| **Naming** | Lower-case kebab-case, matching the neighbouring files |

## 3. Report

A table per category: file, size, licence entry, used by, findings. Then, ranked: missing licences, broken references, orphans, over-budget files, the rest. End with what was not assessed and why.

Adapted from Claude Code Game Studios (MIT); see `LICENSE`.
