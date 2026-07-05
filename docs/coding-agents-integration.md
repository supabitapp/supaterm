# Coding Agents Integration

This document captures how coding agent integrations work inside Supaterm.

Supaterm owns pane context, socket transport, tab state, and notifications. An agent-specific integration only needs to translate the agent's native lifecycle into structured events that Supaterm can understand.

## Model

- A coding agent runs inside a Supaterm pane.
- Supaterm injects pane-local environment into terminal processes:
  - `SUPATERM_SOCKET_PATH`
  - `SUPATERM_CLI_PATH`
  - `SUPATERM_STATE_HOME` when the app is launched with a state root
  - `SUPATERM_SURFACE_ID`
  - `SUPATERM_TAB_ID`
- Supaterm prepends the bundled CLI directory to pane `PATH`.
- Structured agent events go through the `sp` CLI and then through the socket control boundary into the app process.
- The app process is the only place that decides tab activity, pending input state, and desktop notification delivery.
- Agent notifications are routed to the pane context first and then to the stored session surface when available.
- Foreground session routing prevents restored or background sessions from stealing the panel, fork, copy, and tab activity surface.
- The same shared activity model powers every agent, and desktop notification titles derive from the explicit agent kind.

## Shared Responsibilities

The integration is split into three layers.

### Pane Runtime

- inject pane context into the process environment
- inject the Debug or bundled `sp` path
- preserve isolated `SUPATERM_STATE_HOME` for development runs

### Agent Adapter

- install agent-native hook configuration when the user opts in
- install the Supaterm agent skill when the user opts in
- forward hook payloads through `sp`
- keep adapter behavior thin and agent-native

### App-Side Interpreter

- accept typed socket requests
- bind agent sessions to pane surfaces
- store any transient agent state the UI needs
- update tab-level activity
- emit in-app or desktop notifications when needed
- clear pane-bound agent state when the shell reports the foreground command has finished
- monitor transcript or task-progress sources when an agent exposes them

Future agent integrations should keep that split. The wrapper or adapter should stay thin, and all UI state should stay inside the app.

## Supaterm Skill

Supaterm ships its agent skill from `supaterm-skills` inside the app bundle.

Install it with:

```bash
sp agent install-skill
```

The install command links `~/.agents/skills/supaterm` to the bundled skill directory.
If that path already exists as a symlink or directory, Supaterm replaces it with a symlink to the current bundled skill.
On app launch, Supaterm silently refreshes existing Supaterm skill installs to the current bundle path.

Install every supported hook bridge with:

```bash
sp agent install-hooks
```

The app also exposes setup commands through:

```bash
sp onboard
```

## Hook Bridge

Claude and Codex share the settings-file hook bridge.

- Settings > Coding Agents exposes a toggle per agent. Turning it on installs hooks with `sp agent install-hook <agent>`; turning it off removes them with `sp agent remove-hook <agent>`.
- On open, Settings reads the agent's settings file to reflect whether Supaterm-managed hooks are currently present.
- A hook is Supaterm-managed when its `command`, lowercased, contains `supaterm`.
- Install preserves unrelated settings, removes any existing Supaterm-managed hooks anywhere in the file, and then installs the canonical Supaterm hooks.
- The installed hook command uses `SUPATERM_CLI_PATH` so the hook bridge targets the bundled `sp` binary injected into Supaterm panes, and passes `--pid "$PPID"` so Supaterm can track live agent processes.
- The canonical hook fragment is also available from `sp internal agent-settings <agent>`.
- On app launch, Supaterm silently refreshes installed Supaterm-managed hooks to the current canonical hook definition.

Installed hooks invoke `sp agent receive-agent-hook --agent <agent>`:

- It reads one agent hook event JSON object from stdin; the caller must declare the agent explicitly with `--agent`.
- It forwards that payload to the app over the socket method `terminal.agent_hook`.
- The forwarded request carries the decoded event, the explicit agent kind, and the ambient `SupatermCLIContext` from the current pane.

## Claude

- Settings file: `~/.claude/settings.json`.
- Installed hook events: `SessionStart`, `PreToolUse`, `PostToolUse`, `Notification`, `UserPromptSubmit`, `Stop`, `SessionEnd`.

### App Behavior

The app binds Claude sessions to pane surfaces, tracks the foreground session for each pane, and turns Claude hook events into tab activity.

- `SessionStart` binds the session to the current pane surface, registers agent presence, and starts panel monitoring.
- `PreToolUse` and `PostToolUse` mark the tab as `running`.
- `Notification` marks the tab as `needs input` and may trigger a notification.
- `UserPromptSubmit` marks the tab as `running`.
- `PreToolUse`, `PostToolUse`, and `UserPromptSubmit` recover the pane binding when `SessionStart` was missed or announced a different session ID, which is what `claude --fork-session --resume` does: its `SessionStart` reports the parent session ID and every later hook carries the forked one.
- `Stop` marks the tab as `idle` and stores the final assistant message as the latest tab notification when one is provided.
- While the tab is `running`, transcript growth observed by the panel monitor's poll re-arms the running timeout, so long tool calls and streaming responses do not flip the tab to `idle` between hooks.
- `SessionEnd` clears the tab activity and drops the stored session state.
- A command-finished signal from the shell clears pane-bound agent sessions and presence.

The panel monitor reads Claude task progress from the hook `transcript_path`.

The monitor understands task reminders, `TaskCreate`, `TaskUpdate`, `TodoWrite`, and goal status records. It filters internal task rows and orders tasks by task ID, matching how Claude Code renders its own task list.

## Codex

Codex uses the same bridge and tab-state model, with transcript lifecycle as the source of truth for detail and final running state.

- Settings file: `~/.codex/hooks.json`.
- Installed hook events: `PostToolUse`, `PreToolUse`, `SessionStart`, `UserPromptSubmit`, `Stop`.
- Install enables the Codex hooks feature by running `codex features enable hooks` through the user's login shell and trusts the installed Supaterm hook commands in `~/.codex/config.toml`.
- Remove rewrites `~/.codex/hooks.json` and removes the matching Supaterm hook trust entries from `~/.codex/config.toml`; it does not disable the hooks feature flag.
- The launch refresh also re-applies the trust state.

### App Behavior

The app binds Codex sessions to pane surfaces and turns Codex hook events into tab activity.

- `SessionStart` binds the session to the current pane surface and starts transcript observation for the recorded `transcript_path`.
- `PreToolUse` and `PostToolUse` optimistically mark the tab as `running` before transcript progress arrives, and
  recover the pane binding when `SessionStart` was missed.
- `UserPromptSubmit` re-arms transcript observation for the next turn, recovers the pane binding when `SessionStart`
  was missed, and clears structured completion suppression without supplying Codex detail on its own.
- `Stop` marks the tab as `idle` and stores the final assistant message as the latest tab notification when one is provided.
- Transcript lifecycle remains authoritative for Codex detail and final `idle` transitions.
- `task_started` and `turn_started` mark the tab as `running`.
- `task_complete`, `turn_complete`, and `turn_aborted` mark the tab as `idle`.
- `error` marks the turn failed and clears the active turn.
- `thread_goal_updated` and goal context records can populate goal progress rows.
- `update_plan` tool calls can populate panel progress rows.
- Resume and startup read the current transcript snapshot before polling, so an already-active Codex turn appears as `running` immediately.
- While a Codex turn is running, Supaterm tails the Codex rollout file from `transcript_path`.
- `event_msg` lines drive lifecycle, and non-final `agent_message` events can update live activity detail.
- `response_item` lines only update live activity detail for non-final assistant messages.
- While Codex is `running`, the sidebar tab row shows the tab-level running badge without inline activity text. Notification bodies remain available from the row hover popover.

## Pi

Pi uses the extension package from `supaterm-skills`, not the `sp agent install-hook` settings bridge.

Settings > Coding Agents can install or remove the package by invoking `pi` through the user's login shell.

Install it with:

```bash
pi install git:github.com/supabitapp/supaterm-skills
```

Install from a local checkout while developing:

```bash
pi install /absolute/path/to/supaterm/integrations/supaterm-skills
```

The Pi extension source lives in `integrations/supaterm-skills/extensions/pi-notify-supaterm`.

The extension only forwards events when it sees both:

- `SUPATERM_CLI_PATH`
- `SUPATERM_SURFACE_ID`

It synthesizes a stable Pi session ID from the pane surface ID, sends hook events through `sp agent receive-agent-hook --agent pi`, emits running heartbeats during active work, and sends completion or attention notifications when the Pi run finishes or waits for input.
