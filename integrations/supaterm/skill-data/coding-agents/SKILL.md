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
sp pane send --submit <pane-uuid> - < "$prompt_file"
```

`--submit` pastes the complete prompt, preserves embedded newlines, then presses Enter separately. This avoids interactive paste-burst handling that can turn Enter into another newline.

Do not use `--newline`, typed bracketed-paste escape sequences, or timing sleeps to submit a prompt.

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
