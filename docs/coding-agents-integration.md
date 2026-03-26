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
- Bundled command wrappers live in `Contents/Resources/bin` and can win inside Supaterm panes because the Ghostty fork gives that directory precedence after shell startup files run.
- The wrapper or adapter must fall through cleanly outside Supaterm. Supaterm should never interfere with the same agent in a normal shell.
- Structured agent events go through the `sp` CLI and then through the socket control boundary into the app process.
- The app process is the only place that decides tab activity, pending input state, and desktop notification delivery.

## Shared Responsibilities

The integration is split into three layers.

### Pane Runtime

- inject pane context into the process environment
- make bundled wrappers available inside Supaterm panes
- keep normal shells untouched outside Supaterm

### Agent Adapter

- detect whether the process is inside a Supaterm pane
- resolve the real agent binary
- collect or synthesize the agent's hook payloads
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

- Supaterm bundles a `claude` wrapper in `apps/mac/Resources/bin/claude`.
- Inside a Supaterm pane, that wrapper resolves the real `claude` binary from `PATH`.
- Outside Supaterm, or when the socket is unavailable, or when `SUPATERM_CLAUDE_HOOKS_DISABLED=1`, the wrapper immediately execs the real binary with no Supaterm behavior.
- Non-interactive commands such as `auth`, `update`, `agents`, `mcp`, and `remote-control` also pass through directly.

### Hook Injection

- For an interactive Claude session inside Supaterm, the wrapper runs `sp claude-hook-settings`.
- That command prints the canonical hook settings JSON.
- Claude is then launched with `--settings <json>`.
- Those settings tell Claude to invoke `sp agent-hook` for:
  - `SessionStart`
  - `PreToolUse`
  - `Notification`
  - `UserPromptSubmit`
  - `Stop`
  - `SessionEnd`

### Event Forwarding

- `sp agent-hook` reads one agent hook event JSON object from stdin.
- It forwards that payload to the app over the socket method `terminal.agent_hook`.
- The forwarded request carries both the decoded event and the ambient `SupatermCLIContext` from the current pane.

### App Behavior

The app binds Claude sessions to pane surfaces and turns Claude hook events into tab activity.

- `SessionStart` binds the session to the current pane surface.
- `PreToolUse` marks the tab as `running`.
- `Notification` marks the tab as `needs input` and may trigger a notification.
- `UserPromptSubmit` marks the tab as `running`.
- `Stop` marks the tab as `idle`.
- `SessionEnd` clears the tab activity and drops the stored session state.

The sidebar renders the Claude activity at tab level with three states:

- `Claude running`
- `Claude needs input`
- `Claude idle`
