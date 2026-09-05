# Process-tree verification

The port scanner captures one process tree per scan and queries descendants for each
pane's native, foreground, and fallback scopes. Build the parent-to-children index
once in that immutable snapshot instead of regrouping all processes per query.
PID lookup still keeps the last entry for a duplicate PID; the child index uses
those same deduplicated entries. Traversal and process-start-time validation are
unchanged. The index lives only as long as its snapshot.

## Reproduce

On macOS 26 with Xcode 26.6 selected:

```sh
bash apps/mac/scripts/check-process-tree.sh test
bash apps/mac/scripts/check-process-tree.sh benchmark
```

These commands use a temporary Swift package with symlinks to the actual three
production support files and existing `ProcessTableTests.swift`. They require no
Tuist authentication, submodules, app launch, or external Swift packages. Temporary
build products are removed on exit. This is a focused verification loop, not a
replacement for `make mac-test` and socket E2E checks in CI.

The benchmark uses a Release build, 2,000 synthetic processes, five-process chains,
and 1, 10, or 50 root scopes. Each iteration constructs a fresh snapshot and queries
all scopes. It discards a warm-up batch and reports seven batches of 200 iterations.
A checked result count prevents unused work from being optimized away. Compilation
is excluded from timings.

To measure a baseline, run the same harness with
`TerminalAgentProcessTreeSnapshot.swift` from commit `a34e5401e`. Use a separate
worktree when comparing so concurrent source edits cannot affect a measurement.

## Measurements

Local arm64 Mac, Xcode 26.6 (17F113), 2026-09-05. Milliseconds per complete synthetic
scan, including snapshot construction:

| Root scopes | Before median (range) | After median (range) |
| --- | --- | --- |
| 1 | 0.138 (0.136–0.142) | 0.137 (0.135–0.139) |
| 10 | 1.484 (1.329–1.700) | 0.150 (0.138–0.310) |
| 50 | 7.139 (6.909–8.092) | 0.240 (0.160–0.315) |

This demonstrates less repeated indexing work for multiple scopes. It does not
measure app-wide CPU, memory, `sysctl` capture, or `lsof` latency. Single-scope cost
is approximately unchanged; a captured snapshot with no descendant queries now
pays for an unused index. The scanner normally queries at least one scope after
capturing. A Time Profiler recording of an isolated app with many active panes is
the next step for quantifying the end-to-end effect.
