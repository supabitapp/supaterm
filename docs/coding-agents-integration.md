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
- install the Supaterm agent skill when the user opts in
- forward those payloads through `sp`

### App-Side Interpreter

- accept typed socket requests
- bind agent sessions to pane surfaces
- store any transient agent state the UI needs
- update tab-level activity
- emit in-app or desktop notifications when needed

Future agent integrations should keep that split. The wrapper or adapter should stay thin, and all UI state should stay inside the app.

## Supaterm Skill

Supaterm also ships an agent skill from `supaterm-skills`.

Install it with:

```bash
npx skills add supabitapp/supaterm-skills --skill supaterm -g
```

Settings > Coding Agents shows the exact command for installing only the public Supaterm skill.

## Claude

Claude is the current first-class coding agent integration.

### Entry Point

- Supaterm exposes a Claude integration toggle in Settings > Coding Agents.
- Turning the toggle on installs hooks with `sp agent install-hook claude`.
- Turning the toggle off removes hooks with `sp agent remove-hook claude`.
- On open, Settings reads `~/.claude/settings.json` to reflect whether Supaterm-managed hooks are currently present.
- The CLI command preserves unrelated settings, removes any existing Supaterm-managed hooks anywhere in the file, and then installs the canonical Supaterm Claude hooks into the user settings file.
- The installed hook command uses `SUPATERM_CLI_PATH` so the hook bridge targets the bundled `sp` binary injected into Supaterm panes.

### Hook Injection

- Supaterm's canonical Claude hook fragment is also available from `sp internal agent-settings claude`.
- The installed user settings tell Claude to invoke `sp agent receive-agent-hook --agent claude` for:
  - `SessionStart`
  - `PreToolUse`
  - `Notification`
  - `UserPromptSubmit`
  - `Stop`
  - `SessionEnd`

### Event Forwarding

- `sp agent receive-agent-hook` reads one agent hook event JSON object from stdin.
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

- Supaterm exposes a Codex integration toggle in Settings > Coding Agents.
- Turning the toggle on installs hooks with `sp agent install-hook codex`.
- Turning the toggle off removes hooks with `sp agent remove-hook codex`.
- On open, Settings reads `~/.codex/hooks.json` to reflect whether Supaterm-managed hooks are currently present.
- The install command enables the Codex hooks feature by running `codex features enable codex_hooks` through the user's login shell.
- The same install command preserves unrelated hooks, removes any existing Supaterm-managed hooks anywhere in the file, and then installs the canonical Supaterm Codex hooks into the user-scoped global file.
- The remove command only rewrites `~/.codex/hooks.json`; it does not disable the Codex hooks feature flag.

### Hook Injection
- Supaterm's canonical Codex hook fragment is also available from `sp internal agent-settings codex`.
- The installed global hooks tell Codex to invoke `sp agent receive-agent-hook --agent codex` for:
  - `PostToolUse`
  - `PreToolUse`
  - `SessionStart`
  - `UserPromptSubmit`
  - `Stop`

### App Behavior

The app binds Codex sessions to pane surfaces and turns Codex hook events into tab activity.

- `SessionStart` binds the session to the current pane surface and starts transcript observation for the recorded `transcript_path`.
- `PreToolUse` and `PostToolUse` optimistically mark the tab as `running` before transcript progress arrives.
- `UserPromptSubmit` re-arms transcript observation for the next turn and clears structured completion suppression without supplying Codex detail on its own.
- `Stop` marks the tab as `idle` and stores the final assistant message as the latest tab notification when one is provided.
- Transcript lifecycle remains authoritative for Codex detail and final `idle` transitions.
- `task_started` and `turn_started` mark the tab as `running`.
- `task_complete`, `turn_complete`, and `turn_aborted` mark the tab as `idle`.
- Resume and startup read the current transcript snapshot before polling, so an already-active Codex turn appears as `running` immediately.
- While a Codex turn is running, Supaterm tails the Codex rollout file from `transcript_path`.
- `event_msg` lines drive lifecycle, and non-final `agent_message` events can update live activity detail.
- `response_item` lines only update live activity detail for non-final assistant messages.
- While Codex is `running`, the sidebar tab row uses its secondary line for live activity detail only when the Codex pane is the focused pane in that tab. Background Codex panes keep the tab-level running badge, but the secondary line falls back to the unread notification preview instead of exposing live internal progress.

The same shared activity model powers both agents, and desktop notification titles now derive from the explicit agent kind instead of assuming one agent.

Supaterm currently treats a hook as Supaterm-managed when its `command`, lowercased, contains `supaterm`.

## Pi

Supaterm ships a Pi extension package from `supaterm-skills`.

Install it with:

```bash
pi install git:github.com/supabitapp/supaterm-skills
```

Install from a local checkout while developing:

```bash
pi install /absolute/path/to/supaterm/integrations/supaterm-skills
```

The Pi extension source lives in `integrations/supaterm-skills/extensions/pi-notify-supaterm`.
