---
name: playtest-report
description: "Turns playtest notes into a structured report, or gives a blank one to fill in while playing a preview."
argument-hint: "[PR number or notes]"
disable-model-invocation: true
---

# Playtest report

With notes, sort them into the template below; with none, give the blank template for the build being tested. Keep the tester's words for feelings and quotes; put numbers where they exist. A section with nothing in the notes says "not covered", so the gaps show.

For a PR, the build is its preview link (in the PR's comments) and the focus is what the PR changes. Post the report as a comment on the PR, or as a new issue for findings that outlive it, once the person confirms.

```markdown
## Playtest: <what was tested>
- **Build:** <PR #n preview / main at <sha>>
- **Tester, date, time played:**
- **Device and input:** <desktop + keyboard / phone + touch / …>
- **Focus:** <what this session was meant to test>

### First minutes
- Understood what to do? Understood the controls? First reaction?

### What worked
### Pain points (each with severity: high / mid / low)
### Confusing moments (where, and why)
### Moments of delight

### Tuning (the numbers that felt off)
| What | How it felt | Suggestion |

### Bugs
| What happened | Steps | Every time? |

### Top 3 for the next change
1.
```

Each bug or pain point that needs work becomes its own issue: offer to file it with `/new-ticket`.

Adapted from Claude Code Game Studios (MIT); see `LICENSE`.
