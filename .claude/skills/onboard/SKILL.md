---
name: onboard
description: "Writes a short onboarding guide for a new collaborator, tailored to their role or area (gameplay, world, HUD, vehicles, tests, design)."
argument-hint: "[role or area]"
disable-model-invocation: true
---

# Onboard

Build the guide from what the repo says today; it's a map, not a copy. Point at `AGENTS.md`, `ARCHITECTURE.md` and `README.md` for the rules rather than restating them.

1. **Read** `README.md`, `AGENTS.md` and `ARCHITECTURE.md`, then the area's code (`src/game/`, `src/world/`, `src/map/`, `tests/`).
2. **Read the live state:** open issues with the area's `scope:` label and their priorities (`gh issue list --label scope:<area>`), open PRs touching the area (`gh pr list`), and recent merges (`git log --oneline -20 -- <path>`).
3. **Write the guide:**
   - **Setup:** the first commands (`npm install`, `npm run dev`, `npx playwright install chromium`).
   - **The area in five minutes:** the files that matter and what each holds.
   - **The rules that bite here:** the three or four from `AGENTS.md` people trip on in this area, as pointers.
   - **Right now:** open PRs that will conflict, and the work in progress.
   - **First tasks:** two or three open issues that fit a newcomer (`good first issue` first), each with why.
   - **Who to ask:** the people active in the area, from recent PRs.
   - **Claude Code here:** the shared agents and skills (AGENTS.md, Claude Code in this repo).
4. **Hand it over** in the conversation. Save it to a file only when the person asks for one.

Adapted from Claude Code Game Studios (MIT); see `LICENSE`.
