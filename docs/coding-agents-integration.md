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
- The foreground root agent's hook `cwd` is the panel workspace source. The pane working directory is the fallback until a root hook reports one, and child-agent directories cannot replace it.
- Every adapter event is translated into the same session, turn, attention, progress, and child-agent domain before it reaches UI state.
- Restored sessions retain their lifecycle and panel state only while their recorded process ID and process start time still identify the same process. Restored sessions remain non-actionable until a fresh native event arrives.
- The same shared state powers every agent, and desktop notification titles derive from the explicit agent kind.

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
- reduce every adapter into one canonical agent state store
- update tab-level activity
- emit in-app or desktop notifications when needed
- clear pane-bound agent state when the shell reports the foreground command has finished
- consume transcript files through a bounded, file-event-driven stream when an agent exposes progress that hooks do not carry

Future agent integrations should keep that split. The wrapper or adapter should stay thin, and all UI state should stay inside the app.

## Supaterm Skill

Supaterm ships its agent skill from `supaterm-skills` inside the app bundle.

Install it with:

```bash
sp skills install
```

The install command copies a stable discovery skill to `~/.agents/skills/supaterm`, replacing any existing path.
The discovery skill directs agents to version-matched content served by `sp skills get` from the app bundle.

Inspect the bundled catalog with:

```bash
sp skills
sp skills get core
sp skills get coding-agents
```

Install every supported hook bridge with:

```bash
sp agent install-hooks
```

The app also exposes setup commands through:

```bash
sp onboard
```

## Hook Bridge

Claude and Codex share the settings-file hook bridge, but each installer uses the agent's public configuration surface.

- Settings > Coding Agents exposes a toggle per agent. Turning it on installs hooks with `sp agent install-hook <agent>`; turning it off removes them with `sp agent remove-hook <agent>`.
- On open, Settings reports each integration as unavailable, unavailable but installed, absent, partial, drifted, or healthy.
- Claude must be available through the user's login shell. Codex must be version 0.144.1 or newer, have its hooks feature enabled, and have canonical trust state.
- A hook is Supaterm-managed only when its command exactly matches one of Supaterm's canonical hook commands.
- Install preserves unrelated settings, removes any existing Supaterm-managed hooks anywhere in the file, and then installs the canonical Supaterm hooks.
- The installed hook command uses `SUPATERM_CLI_PATH` so the hook bridge targets the bundled `sp` binary injected into Supaterm panes, and passes `--pid "$PPID"` so Supaterm can track live agent processes.
- The canonical hook fragment is also available from `sp internal agent-settings <agent>`.
- On app launch, Supaterm repairs partial and drifted integrations. It leaves absent and healthy integrations unchanged.

Installed hooks invoke `sp agent receive-agent-hook --agent <agent>`:

- It reads one agent hook event JSON object from stdin; the caller must declare the agent explicitly with `--agent`.
- It forwards that payload to the app over the socket method `terminal.agent_hook`.
- The forwarded request carries the decoded event, the explicit agent kind, and the ambient `SupatermCLIContext` from the current pane.
- Root hook payloads should include the agent's absolute `cwd`. Supaterm uses it for the Workspace row, Git status, and forked session working directory.

## Claude

- Settings file: `~/.claude/settings.json`.
- Installed hook events: `SessionStart`, `PreToolUse`, `PostToolUse`, `Notification`, `UserPromptSubmit`, `Stop`, `SubagentStart`, `SubagentStop`, `SessionEnd`.

### App Behavior

The app binds Claude sessions to pane surfaces, tracks the foreground session for each pane, and turns Claude hook events into tab activity.

- `SessionStart` binds canonical session state to the current pane surface and starts panel monitoring.
- `PreToolUse` and `PostToolUse` mark the tab as `running`.
- `Notification` marks the tab as `needs input` only for `permission_prompt`, `idle_prompt`, and `elicitation_dialog`.
- `UserPromptSubmit` marks the tab as `running`.
- `PreToolUse`, `PostToolUse`, and `UserPromptSubmit` recover the pane binding when `SessionStart` was missed or announced a different session ID, which is what `claude --fork-session --resume` does: its `SessionStart` reports the parent session ID and every later hook carries the forked one.
- `Stop` marks the tab as `idle` and stores the final assistant message as the latest tab notification when one is provided, unless the transcript still reports an active goal.
- While the tab is `running`, transcript file events re-arm the running timeout, so long tool calls and streaming responses do not flip the tab to `idle` between hooks.
- `SessionEnd` clears the tab activity and drops the stored session state.
- `SubagentStart` and `SubagentStop` add and remove scoped child-agent rows without allowing a child to replace the foreground root session.
- A command-finished signal from the shell clears pane-bound agent state and transcript observation.

The panel monitor reads Claude task progress from the hook `transcript_path`. File-system events trigger incremental reads; partial JSON lines, truncation, replacement, and oversized records are handled without polling the file once per second.

The monitor understands task reminders, `TaskCreate`, `TaskUpdate`, `TodoWrite`, and goal status records. It filters internal task rows and orders tasks by task ID, matching how Claude Code renders its own task list.

## Codex

Codex uses the same bridge and canonical state model. Native hooks are authoritative for attention, turn boundaries, child agents, and plan changes; the transcript supplies live detail, hover history, goals, and final lifecycle evidence.

- Settings file: `~/.codex/hooks.json`.
- Installed hook events: `PermissionRequest`, `PostToolUse`, `PreToolUse`, `SessionStart`, `Stop`, `SubagentStart`, `SubagentStop`, `UserPromptSubmit`.
- `PreToolUse` is restricted to `request_user_input`; `PostToolUse` remains unfiltered so later activity can resolve attention state.
- Install enables the Codex hooks feature through the user's login shell, writes the canonical `hooks.json` fragment, then uses `codex app-server --stdio` to discover native hooks and update trust.
- Hook discovery uses `hooks/list`. User-layer version and trust state come from `config/read`; atomic trust replacement uses `config/batchWrite` with that version.
- Supaterm does not parse Codex source, reproduce Codex's hook hashing, edit TOML trust state directly, vendor Codex, or depend on its internal modules.
- Remove rewrites `~/.codex/hooks.json` and removes the matching native trust entries through the same app-server API. It does not disable the hooks feature flag.
- Trust rebasing preserves unrelated hook state, including duplicate unrelated hooks from the same source, while removing displaced Supaterm entries.

### App Behavior

The app binds Codex sessions to pane surfaces and turns Codex hook events into tab activity.

- `SessionStart` binds the session to the current pane surface and starts transcript observation for the recorded `transcript_path`.
- `PreToolUse` for `request_user_input` marks the tab as needing input. `PostToolUse` marks ordinary tool activity as
  `running` before transcript progress arrives and recovers the pane binding when `SessionStart` was missed.
- `UserPromptSubmit` re-arms transcript observation for the next turn, recovers the pane binding when `SessionStart`
  was missed, and clears structured completion suppression without supplying Codex detail on its own.
- `Stop` marks the tab as `idle` and stores the final assistant message as the latest tab notification when one is provided.
- `PermissionRequest` and `request_user_input` mark the foreground session as needing input; only completion of the matching tool resolves that attention state.
- `SubagentStart` and `SubagentStop` maintain scoped child-agent rows. Each child rollout is tailed independently, so its latest non-final assistant message supplies the row detail without replacing parent transcript monitoring. Before the first message, the row shows the task derived from the child transcript metadata or `Working…` when no task is available. Tool completion never replaces that detail with a tool name. Reused child IDs and late stop events cannot remove a newer child lifetime.
- A native `PostToolUse` for `update_plan` reads `tool_input.plan` directly and replaces the native plan rows immediately. Supaterm never reconstructs plans from transcript text.
- Transcript lifecycle remains authoritative for live Codex detail and corroborates final `idle` transitions.
- `task_started` and `turn_started` mark the tab as `running`.
- `task_complete`, `turn_complete`, and `turn_aborted` mark the tab as `idle`.
- Codex does not persist error events, so a persisted exhausted `token_count` record with no usage info marks a usage-limited turn failed. A rounded 100 percent record that still contains usage info does not.
- `thread_goal_updated` and goal context records can populate goal progress rows.
- Resume and startup read the current transcript snapshot before waiting for file events, so an already-active Codex turn appears as `running` immediately.
- While a Codex turn is running, Supaterm tails the Codex rollout file from `transcript_path`.
- `event_msg` lines drive lifecycle, and non-final `agent_message` events can update live activity detail.
- `response_item` lines only update live activity detail for non-final assistant messages.
- While Codex is `running`, the sidebar tab row shows the tab-level running badge without inline activity text. Notification bodies remain available from the row hover popover.

## Pi

Pi uses the extension package from `supaterm-skills`, not the `sp agent install-hook` settings bridge.

Settings > Coding Agents can install or remove the package by invoking `pi` through the user's login shell.
When Pi is unavailable, removal edits Pi's settings file directly so the installed integration can still be disabled.
Supaterm treats canonical package protocol `0.2.0` or newer as healthy, updates an existing canonical checkout with `pi update`, and replaces noncanonical remote sources during repair.

Install it with:

```bash
pi install git:github.com/supabitapp/supaterm-skills
```

Install from a local checkout while developing:

```bash
pi install /absolute/path/to/supaterm/integrations/supaterm-skills
```

Local package sources are user-owned development configuration. Supaterm treats them as healthy and preserves them at startup without replacing or updating them.

The Pi extension source lives in `integrations/supaterm-skills/extensions/pi-notify-supaterm`.

The extension forwards events when `SUPATERM_CLI_PATH` is available. Ambient pane context still comes from the environment read by `sp`.

It uses Pi's native `sessionManager.getSessionId()` for every callback, preserves native session start and shutdown reasons, and forwards `session_start`, `agent_start`, `agent_end`, and `session_shutdown` through `sp agent receive-agent-hook --agent pi --pid <pi-process-id>`. The app derives running, completion, truncation, error, and attention state from those lifecycle events without synthetic session IDs or heartbeats.
