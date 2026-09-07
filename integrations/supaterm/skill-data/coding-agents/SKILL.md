---
name: coding-agents
description: Launch supported coding agents in Supaterm tabs or panes and deliver multiline prompts safely. Use when starting Codex or another supported coding agent in Supaterm, choosing between a tab and split pane, sending a follow-up prompt, or verifying an agent launch.
---

# Coding agents

Use a new tab for an independent task and a split pane for work beside an existing terminal. Keep repository setup and task policy outside the launch command.

## Initial prompt

Read a multiline prompt from a file into one argument, then pass that argument to the agent executable. Supaterm launches the agent directly, resolves it with the caller's `PATH`, preserves every argument exactly, and skips shell startup files. The initial prompt travels through process arguments instead of terminal input.

```bash
prompt_file=/tmp/task-prompt.md
workspace="$PWD"
prompt="$(cat "$prompt_file")"

pane_id="$(
  sp tab new \
    --plain \
    --cwd "$workspace" \
    -- codex -- "$prompt"
)"
sp pane wait-ready "$pane_id" --timeout 10 --quiet
printf 'paneID=%s\n' "$pane_id"
```

The first `--` ends `sp` options. The second ends Codex options so prompt text such as `resume`, `review`, or a leading dash remains a prompt. Use the equivalent end-of-options form with another supported `<agent>` executable. New tabs and panes leave focus unchanged by default. Use `--focus` when the new terminal should become active.

When the agent exits, the tab or pane closes.

## Split pane

Target a tab or pane with `--in` and retain the returned pane UUID for follow-up commands:

```bash
prompt_file=/tmp/task-prompt.md
workspace="$PWD"
prompt="$(cat "$prompt_file")"
agent_executable="<agent>"
target="t:6bfc889d"

pane_id="$(
  sp pane split right \
    --plain \
    --in "$target" \
    --cwd "$workspace" \
    -- "$agent_executable" -- "$prompt"
)"
sp pane wait-ready "$pane_id" --timeout 10 --quiet
printf 'paneID=%s\n' "$pane_id"
```

Run each block in one shell invocation. Shell variables do not survive separate agent tool calls. For a later call, paste the printed pane UUID as a literal target. If you use `--instance` or `--socket`, repeat it on every `sp` call; the CLI retains no connection state.

Agent-panel forks use a different launch mode. Supaterm starts the account login shell and enters the agent's native fork command visibly. Claude and Codex forks keep supported launch options from the source process. The pane returns to that same shell when the forked agent exits.

## Follow-up prompt

Submit follow-up text through paste-aware transport:

```bash
prompt_file=/tmp/task-prompt.md
pane_id=<pane-uuid>
ready="$(sp agent wait "$pane_id" --expect-agent codex --until idle --timeout 120 --json)" || exit $?
process="$(printf '%s' "$ready" | jq -r '.identity.process | "\(.processID):\(.startTimeMicroseconds)"')"
sp pane send --submit --expect-agent codex --expect-process "$process" "$pane_id" - < "$prompt_file"
```

Use the actual agent kind (`claude`, `codex`, or `pi`). Keep the returned process identity for later
submissions to this agent. The guard refuses input if that process exited, was replaced, lost the
foreground, needs input, or has unknown state. Omitting the guard sends raw terminal input and can
reach a shell after the agent exits.

`--submit` pastes the complete prompt, preserves embedded newlines, then presses Enter separately. This avoids interactive paste-burst handling that can turn Enter into another newline.

Do not use `--newline`, typed bracketed-paste escape sequences, or timing sleeps to submit a prompt.

## Wait for observed state

```bash
sp agent wait <pane-uuid> --until idle --until needs_input --timeout 120 --json
```

A wait binds to the first detected supported agent process, or the process supplied with
`--expect-agent` and `--expect-process`. It can wait for startup detection. Repeat `--until` to
accept multiple states: `idle`, `running`, `needs_input`, or `exited`. Defaults are `idle` and
`needs_input`, with a 60-second timeout. The maximum timeout is 3600 seconds.

The result contains `paneID`, `outcome`, `matched`, and the bound `identity` when available. A match
exits 0. An unexpected exit, replacement, unknown state at the deadline, or timeout exits 1 while
preserving the result on stdout, including in JSON mode. A missing pane before binding is an error.
Unknown state is allowed to settle until the deadline; it never counts as idle. Closing a bound
pane reports `exited`. Exiting does not prove success and does not report an exit code.

Waits observe current lifecycle state, not the completion of a particular prompt. An already-idle
agent satisfies an idle wait immediately, including before a just-submitted prompt is accepted.
For results, inspect the response or have the agent write a task-specific artifact. CLI reads and
waits do not change focus or acknowledge the UI's completion marker.

## Interrupt

Send Ctrl-C to a coding agent through the native key route:

```bash
sp pane key ctrl-c <pane-uuid>
```

## Verify

Capture the agent pane after launch or submission:

```bash
sp pane capture --scope scrollback --lines 160 <pane-uuid>
```

Use the UUID printed by `sp tab new --plain` or `sp pane split --plain`; do not rediscover the pane by title.
