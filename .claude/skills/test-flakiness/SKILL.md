---
name: test-flakiness
description: "Finds flaky and slow tests from the CI history of the smoke and unit test workflows, and says what to do with each."
argument-hint: "[number of runs, default 30]"
disable-model-invocation: true
---

# Test flakiness

1. **Collect runs.** List recent runs of `e2e.yml` and `unit.yml` (`gh run list --workflow <file> --limit <n> --json databaseId,conclusion,headBranch,createdAt`), then each run's per-test results from its log (`gh run view <id> --log`; Playwright prints one line per test with its time, and `retry #1` on a retry). Include PR runs, not only `main`.
2. **Find the flaky ones.** A test is flaky when it failed and passed on the same commit (a retry that passed counts: CI retries once), or failed on a run where nothing near it changed. One failure is a signal, not a verdict: say how many runs back each claim.
3. **Find the slow ones.** Per test: median and slowest time. The same test swinging a lot between runs points at the runner, not the test (software WebGL is CPU-bound).
4. **Classify the cause** from the failure text: timing (a fixed wait or a frame count that isn't enough on a slow runner), order (state left by an earlier test), network (fonts or a CDN), or a real intermittent bug in the game.
5. **Recommend** per test: fix the wait (poll a state with `expect.poll` instead of counting frames), move the rule it checks to a unit test (#241), or open a bug.

## Report

A table of flaky tests (failures / runs, cause, recommendation), a table of the slowest tests (median, max), and the data limits (how many runs, which branches). Offer to file the fixes as issues with `/new-ticket`.

Adapted from Claude Code Game Studios (MIT); see `LICENSE`.
