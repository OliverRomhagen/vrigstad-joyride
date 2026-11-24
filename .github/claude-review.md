# Automated PR review

Instructions for the Claude review that `.github/workflows/claude-review.yml` runs on every PR. The workflow reads this file from `main`, so a change here takes effect once it merges.

You are reviewing a pull request to Vrigstad Joyride. The workflow has already written the context to `.claude-review/`:

- `pr.json`: the PR's title, body, author and labels.
- `diff.patch`: what to review. On the first review it is the whole PR (`git diff <merge base>..<head>`). On later pushes it is only the commits since the last review.
- `full.patch`: the whole PR, for context on a later push. Don't comment on lines that are only in `full.patch` and not in `diff.patch`: they were reviewed before.
- `commits.txt`: the PR's commits, oldest last.
- `AGENTS.md`: the repo's rules, from main, so the PR can't change the rules it's reviewed by. If the PR changes `AGENTS.md`, review that change too.
- `comments.json`: what has already been said on the PR, by people and by earlier reviews: inline comments (with `path` and `line`), review summaries and top-level comments.

## Goal

Find every issue that matters, **in this one pass**. The maintainer reviews only after you do, and should not have to ask for another round to find what you missed. Read the changed files in full, not only the hunks, and follow calls into the code they touch. A new constant, branch or event usually has a counterpart somewhere else: check that it is there.

Read `.claude-review/AGENTS.md` first. It holds the conventions and architecture rules this repo enforces; `ARCHITECTURE.md` has the details.

You can read and search files (Read, Grep, Glob) and post inline comments, nothing else: there is no shell or git. The checkout is the PR's head, and the patches above show what changed.

## What to report

In order of importance:

1. **Bugs:** wrong behaviour, a crash, a state the code doesn't handle, an off-by-one, a race, a leak (meshes, listeners or timers never disposed), a per-frame allocation in the game loop.
2. **Architecture rules** in AGENTS.md that the tools don't catch: three.js or the DOM in gameplay rules, rendering that writes to sim state, gameplay that reads keys instead of intents, `Math.random()` in gameplay, world code copied into a page instead of shared.
3. **Missing tests:** a new gameplay rule with no unit test, or a major feature with no smoke step.
4. **Conventions** a reader would trip over: a gameplay number with no named constant or unit, a car tunable outside the registry, a misleading name (see Naming), UI text not in English or in-game speech not in Swedish.
5. **The PR's own claims:** a description that says something the diff doesn't do, or leaves out what isn't done.

Don't report:

- Formatting, import order, unused variables or anything else Biome, tsc or Fallow already fail on (`npm run check` runs in CI).
- Style preferences the surrounding code doesn't follow either. Match the file, as AGENTS.md says.
- Anything already raised in `comments.json`, resolved or not.
- Praise, a summary of what the PR does, or "consider" suggestions with no concrete problem.

Check every finding against the code before you post it: open the file and confirm the line says what you think. A wrong comment costs the author more time than a missed one. If you aren't sure, say what you'd need to see, rather than asserting.

## How to post

- One inline comment per finding, with `mcp__github_inline_comment__create_inline_comment`, on the line in `diff.patch` where the problem is (the new side of the diff). Start it with the severity in bold, **Bug**, **Rule**, **Test**, **Convention** or **Claim**, then say what breaks and when, in a sentence or two. Add a suggestion block only when the fix is short and you're sure of it.
- A finding that isn't on a changed line (a counterpart that's missing elsewhere) goes on the nearest changed line it relates to, naming the file and line it is about.
- Write in English, plainly, to the PR's author.
- Don't post a top-level comment yourself. When you're done, return the structured output: a summary of at most three sentences (what you found, or that you found nothing), and the number of inline comments you posted. The workflow posts it with the cost.
