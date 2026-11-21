---
name: perf-profile
description: "Profiles the game's frame cost (draw calls, triangles, shadow pass, JS per frame) in a built page and ranks fixes by gain and effort. Use for low fps, stutter, a performance budget, or checking a change for a performance regression."
argument-hint: "[scene or change, e.g. 'Torget on foot' or a PR number]"
---

# Performance profile

Measure; never guess. Hand the work to the `performance-analyst` agent with the scope below, or do it yourself following that agent's measuring rules (`.claude/agents/performance-analyst.md`).

1. **Scope:** which scene (intro, on foot at Torget, driving, a chase with three stars) and which build. For a regression, profile `main` and the branch the same way.
2. **Measure** each scene for a few seconds: draw calls and triangles per frame, the shadow pass's share, JS time per frame. Use a scratch worktree for any debug hook; nothing measured gets committed.
3. **Compare** against the budget in #72 when it exists; until then, against `main`.
4. **Report:** the numbers per scene (with viewport and pixel ratio), the top bottlenecks ranked by gain per effort, each with a concrete fix and the file it touches, and what couldn't be measured headless (GPU fill rate, real phones, Retina screens).

A fix worth doing becomes an issue under #72 (`/new-ticket`), with the numbers in it.

Adapted from Claude Code Game Studios (MIT); see `LICENSE`.
