---
title: Automation recipes
description: Compose sp commands for project workspaces, coding agents, output capture, and notifications.
---

These recipes run inside Supaterm. Examples that extract IDs use `jq`.

## Open a project workspace

```bash
workspace="$HOME/code/project"

space_id="$(sp space new --json --focus Project | jq -r '.target.spaceID')"
sp group new Development --in "$space_id" --color blue
tab="$(sp tab new --json --in "$space_id" --focus --cwd "$workspace" -- npm run dev)"
sp tab move "$(printf '%s' "$tab" | jq -r '.tabID')" --group Development
pane_id="$(printf '%s' "$tab" | jq -r '.paneID')"
sp pane split --in "$pane_id" --no-focus right --cwd "$workspace" -- npm test -- --watch
```

`--focus` changes the app's visible selection. The shell that launched these commands keeps its original ambient IDs, so every later creation targets the captured result explicitly.

Pass startup commands after `--`. Use `--script` for shell script text:

```bash
sp tab new --script 'printf "ready\n"; exec "${SHELL:-/bin/zsh}" -l'
```

## Retain a pane ID

```bash
creation="$(sp tab new --json --no-focus --cwd "$PWD" -- npm test)"
pane_id="$(printf '%s' "$creation" | jq -r '.paneID')"

sp pane capture --scope scrollback --lines 160 "$pane_id"
```

Keep the returned UUID instead of rediscovering the pane by title or position.

## Launch a coding agent with a multiline prompt

```bash
prompt_file=/tmp/task.md
workspace="$PWD"
prompt="$(cat "$prompt_file")"

creation="$(
  sp tab new \
    --json \
    --no-focus \
    --cwd "$workspace" \
    -- codex -- "$prompt"
)"
pane_id="$(printf '%s' "$creation" | jq -r '.paneID')"
```

The first `--` ends `sp` options. The second ends agent options so prompt text remains a prompt.

For a follow-up, submit a complete file through paste-aware transport:

```bash
sp pane send --submit "$pane_id" - < "$prompt_file"
```

`--submit` pastes the text and presses Enter separately. Do not emulate bracketed paste or add timing sleeps.

## Build a split layout by ID

```bash
tab="$(sp tab new --json --no-focus --cwd "$PWD")"
tab_id="$(printf '%s' "$tab" | jq -r '.tabID')"

sp pane split --in "$tab_id" --no-focus right -- npm test
sp pane split --in "$tab_id" --no-focus down -- tail -f /tmp/app.log
sp pane layout equalize "$tab_id"
```

## Notify when a command finishes

```bash
if make test; then
  sp pane notify --title "Tests passed" --body "$PWD"
else
  exit_code=$?
  sp pane notify --title "Tests failed" --body "$PWD"
  exit "$exit_code"
fi
```

## Run tmux-aware tools

```bash
sp run -- claude --resume
sp tmux list-panes
```

`sp run` provides Supaterm's tmux compatibility environment to the child process. `sp tmux` implements the supported compatibility subset; it is not a separate tmux server.
