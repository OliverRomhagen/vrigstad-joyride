---
name: balance-check
description: "Checks the game's numbers for balance problems: outliers, things that can never happen or always happen, one choice that beats every other, money that only drains or piles up. Use when asked whether something is balanced or tuned right, e.g. \"can the tractor ever be wrecked?\", or before merging a PR that changes gameplay numbers."
argument-hint: "[system, file, or PR number]"
---

# Balance check

Gameplay numbers are named constants near the top of their module (`AGENTS.md`, Code style): `src/game/*.ts`, and `src/game/main.ts` until it's split. For a PR, read its diff (`gh pr diff <n>`) and the description's stated intent.

## 1. Collect the numbers and the intent

List every constant the system uses, with its unit, and where the **intended** behaviour is written down: the issue, the PR description, or a comment next to the constant ("three crashes at ~70 km/h leave it running, the fourth wrecks it"). A value with no stated intent can't be judged against a target: list it as **not judged**, never as fine.

## 2. Work the numbers

Compute, don't estimate. Run the formulas for every case that differs, with a table per case:

- **Per vehicle type** (Volvo, Saab, EPA-traktor, traktor, polis): top speeds differ threefold, so a fixed threshold can make a rule impossible for slow vehicles.
- **At both ends** of each range the system allows, not only the typical case.
- **Over a session** for anything that accumulates: money, stars, health, damage.

Then look for:

- **Outliers:** a value far outside its stated intent.
- **Unreachable or unavoidable:** something that can never happen (a vehicle that can't be wrecked) or always happens.
- **Dominant strategies:** one choice better than all others in every case (always drive the Saab, never eat).
- **Broken flows:** money, health or stars that only drain or only pile up; a loop that gives something for nothing.
- **Feedback loops** that run away: a punishment that makes the next one more likely.

## 3. Report

```
## Balance check: <system>
Sources: <files and issue/PR read>
Verdict: HEALTHY / CONCERNS / CRITICAL / NOT ASSESSED

| Case | Value | Intended | Actual | Issue |
Findings, worst first: the problem, the numbers that show it, a fix as a constant change with its new value.
Not judged: values with no stated intent.
```

**CRITICAL** is a dominant strategy, an unreachable outcome the design relies on, or a runaway loop. **NOT ASSESSED** is the honest verdict when the numbers or the intent are missing: say what's missing instead of filling it in. For deeper design questions, hand over to the `systems-designer` or `economy-designer` agent.

Adapted from Claude Code Game Studios (MIT); see `LICENSE`.
