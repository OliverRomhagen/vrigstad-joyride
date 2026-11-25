---
name: quick-design
description: "Writes a short design spec for a small change (a tuning tweak or a minor mechanic), ready to paste into an issue or PR."
argument-hint: "[the change, in a sentence]"
disable-model-invocation: true
---

# Quick design

For changes too small to need the `game-designer` agent: a new price, a timer, a slightly different rule. If the change touches three or more systems, or adds a new one, say so and suggest the agent instead.

1. **Find what it touches.** The constants and functions involved (search `src/game/`), the issue it belongs to, and any open PR that edits the same lines (`gh pr list`).
2. **Classify it:** a **tuning** change (only numbers change), a **tweak** (a rule changes), or an **addition** (a small new behaviour).
3. **Write the spec:**

```markdown
### <title>
**Change:** <one or two sentences, from the player's side>
**Why:** <the problem it fixes or the feeling it adds>

| Constant | Now | New | Unit | Effect |
<for a tweak or addition: the rule before and after, and the edge cases>

**Done when:** <checkable outcomes, e.g. "a full-speed crash wrecks the tractor in 3 hits">
**Test:** <a unit test for the rule; a smoke step only for new wiring (#241)>
```

4. **Check the numbers** with `/balance-check` when the change moves a balance. Then offer to put the spec in the issue, or to file a new one with `/new-ticket`.

Adapted from Claude Code Game Studios (MIT); see `LICENSE`.
