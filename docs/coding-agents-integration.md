# Coding Agents Integration

This document captures how coding agent integrations work inside Supaterm.

Supaterm owns pane context, socket transport, tab state, and notifications. An agent-specific integration only needs to translate the agent's native lifecycle into structured events that Supaterm can understand.

## Model

- A coding agent runs inside a Supaterm pane.
- Supaterm injects pane-local environment into terminal processes:
  - `SUPATERM_SOCKET_PATH`
  - `SUPATERM_CLI_PATH`
  - `SUPATERM_SURFACE_ID`
  - `SUPATERM_TAB_ID`
- Structured agent events go through the `sp` CLI and then through the socket control boundary into the app process.
- The app process is the only place that decides tab activity, pending input state, and desktop notification delivery.

## Shared Responsibilities

The integration is split into three layers.

### Pane Runtime

- inject pane context into the process environment

### Agent Adapter

- install agent-native hook configuration when the user opts in
- forward those payloads through `sp`

### App-Side Interpreter

- accept typed socket requests
- bind agent sessions to pane surfaces
- store any transient agent state the UI needs
- update tab-level activity
- emit in-app or desktop notifications when needed

Future agent integrations should keep that split. The wrapper or adapter should stay thin, and all UI state should stay inside the app.

## Claude

Claude is the current first-class coding agent integration.

### Entry Point

- Supaterm exposes an `Install Claude Hooks` button in Settings > Coding Agents.
- That action runs `sp agent install claude`.
- The CLI command reads `~/.claude/settings.json`, preserves unrelated settings, and installs the canonical Supaterm Claude hooks into the user settings file.
- Before appending the canonical hooks, Supaterm removes any existing Supaterm-managed hooks by signature so reinstall stays idempotent even if the exact command string changed.
- The installed hook command uses `SUPATERM_CLI_PATH` so the hook bridge targets the bundled `sp` binary injected into Supaterm panes.

### Hook Injection

- Supaterm's canonical Claude hook fragment is also available from `sp internal agent-settings claude`.
- The installed user settings tell Claude to invoke `sp internal agent-hook --agent claude` for:
  - `SessionStart`
  - `PreToolUse`
  - `Notification`
  - `UserPromptSubmit`
  - `Stop`
  - `SessionEnd`

### Event Forwarding

- `sp internal agent-hook` reads one agent hook event JSON object from stdin.
- The caller must declare the agent explicitly with `--agent`.
- It forwards that payload to the app over the socket method `terminal.agent_hook`.
- The forwarded request carries the decoded event, the explicit agent kind, and the ambient `SupatermCLIContext` from the current pane.

### App Behavior

The app binds Claude sessions to pane surfaces and turns Claude hook events into tab activity.

- `SessionStart` binds the session to the current pane surface.
- `PreToolUse` marks the tab as `running`.
- `Notification` marks the tab as `needs input` and may trigger a notification.
- `UserPromptSubmit` marks the tab as `running`.
- `Stop` marks the tab as `idle` and stores the final assistant message as the latest tab notification when one is provided.
- `SessionEnd` clears the tab activity and drops the stored session state.

The sidebar renders the Claude activity at tab level with three states:

- `Claude running`
- `Claude needs input`
- `Claude idle`

## Codex

Codex now uses the same app-side bridge and tab-state model.

### Entry Point

- Supaterm exposes an `Install Codex Hooks` button in Settings > Coding Agents.
- That action runs `sp agent install codex`.
- The CLI command enables the Codex hooks feature by running `codex features enable codex_hooks` through the user's login shell.
- The same CLI command reads `~/.codex/hooks.json`, preserves unrelated hooks, and installs the canonical Supaterm Codex hooks into the user-scoped global file.
- Before appending the canonical hooks, Supaterm removes any existing Supaterm-managed hooks by signature so reinstall stays idempotent even if the exact command string changed.

### Hook Injection

- Supaterm's canonical Codex hook fragment is also available from `sp internal agent-settings codex`.
- The installed global hooks tell Codex to invoke `sp internal agent-hook --agent codex` for:
  - `PostToolUse`
  - `SessionStart` with matcher `startup|resume`
  - `PreToolUse`
  - `UserPromptSubmit`
  - `Stop`

### App Behavior

The app binds Codex sessions to pane surfaces and turns Codex hook events into tab activity.

- `SessionStart` binds the session to the current pane surface.
- `PostToolUse` marks the tab as `running`.
- `PreToolUse` marks the tab as `running`.
- `UserPromptSubmit` marks the tab as `running`.
- `Stop` marks the tab as `idle` and stores the final assistant message as the latest tab notification when one is provided.
- Supaterm keeps Codex `running` until `Stop`, `SessionEnd`, terminal exit, or the Codex transcript records a completed or aborted turn.
- While a Codex turn is running, Supaterm tails the Codex rollout file from `transcript_path`.
- `event_msg` lines drive lifecycle and fallback text.
- `response_item` lines drive live activity detail such as `Bash · git status --short`, `Reasoning · ...`, or `Message · ...`.
- While Codex is `running`, the sidebar tab row uses its secondary line for live activity detail. When Codex is no longer `running`, the same line falls back to the unread notification preview.

The same shared activity model powers both agents, and desktop notification titles now derive from the explicit agent kind instead of assuming one agent.

Supaterm currently treats a hook as Supaterm-managed when its command contains `SUPATERM_CLI_PATH` and either `internal agent-hook` or `agent-hook`.
