---
name: pr-review
description: "Reviews a pull request in this repo the same way for everyone. It questions the approach first, then checks the change against AGENTS.md and for bugs, and verifies every finding before reporting it. Use when asked to review a PR, a branch or a diff here."
argument-hint: "[PR number or branch]"
---

# PR review

## 1. Read it whole

The PR's description, linked issue and earlier reviews and replies (`gh pr view <n> --comments`, plus inline comments via `gh api repos/{owner}/{repo}/pulls/<n>/comments`), then the diff on its **current head** (`gh pr diff <n>`). Read the code around each change, not only the hunks: callers, the loop it runs in, the state it touches. A point an earlier review raised counts as open until the current head fixes it; check, and credit the fix when it's there.

## 2. Question the approach

State the problem the PR solves in one line, then ask whether this is the best way to solve it. If a real alternative is better, it's the first finding: what it is, why it's better, and the rough cost to switch. If the approach holds, say so in one line ("Considered X; the PR's approach is better because …"). Only real alternatives, and one that widens the issue's scope is a follow-up, not a change to this PR.

## 3. Check

**Correctness:** walk the changed paths with concrete inputs: the edge cases, each vehicle type, on foot vs in a car, with and without stars, `dt` at both ends of its clamp. Look for state that never resets, values read before they're set (`main.ts` is `@ts-nocheck`, so the typecheck won't catch an undeclared name), and two changes that conflict with open PRs.

**AGENTS.md:**
- One concern per PR, and a Conventional Commits title.
- Gameplay numbers as named constants with units.
- Seeded `rnd()` (or its own `makeRnd()` stream) for anything gameplay-related, never `Math.random()`.
- No three.js or DOM inside gameplay rules; rendering reads sim state and never changes it.
- No per-frame allocations in the game loop.
- In-game speech in Swedish, everything else in English.
- Tests at the right level: a unit test for a new rule, a smoke step only for wiring a unit test can't reach (#241). The PR says how it was tested and what wasn't.
- New third-party assets have their licence in `LICENSE`.

Hand rendering-heavy changes to the `threejs-specialist` agent, and changes to gameplay numbers to `/balance-check`.

## 4. Verify every finding

Report a finding only with its file:line, the quoted code or the concrete input that triggers it, and how you confirmed it. A claim you couldn't confirm is marked **unverified**, or dropped; confident wording isn't evidence. A check you couldn't run (the PR isn't playable headless, the code it calls isn't on the branch) is reported as **not assessed**, never as passed.

## 5. Report

Open with the verdict and the approach line. Then the findings, worst first, split into **before merging** and **fine as follow-ups**, so the author knows exactly what blocks. Say what you didn't do ("not played by hand"). A concrete one-line fix on a changed line goes inline as a GitHub suggestion block. Post the review, and approve or request changes, only when the person asks; until then, show it.

Adapted from the `/code-review` skill in Claude Code Game Studios (MIT), keeping its "not assessed" and "verify every finding" rules; see `LICENSE`.
