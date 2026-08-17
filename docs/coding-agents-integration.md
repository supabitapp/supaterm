# Coding Agents Integration

This document captures how coding agent integrations work inside Supaterm.

Supaterm owns pane context, socket transport, tab state, and notifications. An agent-specific integration sends session identity and structured data that Supaterm cannot read from the terminal.

## Model

- A coding agent runs inside a Supaterm pane.
- Supaterm injects pane-local environment into terminal processes:
  - `SUPATERM_SOCKET_PATH`
  - `SUPATERM_CLI_PATH`
  - `SUPATERM_STATE_HOME` when the app is launched with a state root
  - `SUPATERM_SURFACE_ID`
  - `SUPATERM_TAB_ID`
- For login-shell panes, Supaterm prepends the app's `Contents/MacOS` directory to `PATH`. The directory ships `sp`, `ap`, and `wt`. The app builds `ap` from `ThirdParty/coding-agents-session-picker` and embeds `wt` from `ThirdParty/git-wt`. Direct launches keep the caller's `PATH` unchanged.
- Structured agent events go through the `sp` CLI and then through the socket control boundary into the app process.
- The app process is the only place that decides tab activity, pending input state, and desktop notification delivery.
- Agent notifications are routed to the pane context first and then to the stored session surface when available.
- Foreground session routing prevents restored or background sessions from stealing the panel, fork, copy, and tab activity surface.
- The foreground root agent's hook `cwd` is the panel workspace source. The pane working directory is the fallback until a root hook reports one, and child-agent directories cannot replace it.
- Agent-panel forks start the account login shell in a new pane and enter the agent's native fork command visibly. Supaterm waits for shell readiness when the shell reports it. The pane returns to that same shell when the forked agent exits.
- Every adapter event is translated into the same session, turn, attention, progress, and child-agent domain before it reaches UI state.
- Restored sessions retain their lifecycle and panel state only while their recorded process ID and process start time still identify the same process. Restored sessions remain non-actionable until a fresh native event arrives.
- The same shared state powers every agent, and desktop notification titles derive from the explicit agent kind.
- The tab derives `needs input`, `done`, and `working` from terminal phase, lifecycle, focus, and notification state. An unread structured completion shows `done` until the tab is viewed. No separate seen state exists.

## Shared Responsibilities

The integration is split into three layers.

### Pane Runtime

- inject pane context into the process environment
- inject the Debug or bundled `sp` path
- preserve isolated `SUPATERM_STATE_HOME` for development runs
- read the foreground process-group ID and tty from the live Ghostty surface when needed

### Agent Adapter

- forward hook payloads through `sp`
- keep adapter behavior thin and agent-native

### App-Side Interpreter

- accept typed socket requests
- write agent-native hook configuration when the user opts in
- install the Supaterm agent skill when the user opts in
- bind agent sessions to pane surfaces
- reduce every adapter into one canonical agent state store
- update tab-level activity
- emit in-app or desktop notifications when needed
- clear pane-bound agent state when the shell reports the foreground command has finished
- use the pane foreground process group with hook-reported processes as port-scan roots

Port discovery expands hook process trees and every live member of the pane's foreground process
group, then finds listening ports with `lsof`. The pane process source lets a shell contribute
without an agent hook.

Future agent integrations should keep that split. The wrapper or adapter should stay thin, and all UI state should stay inside the app.

## Terminal Phase Detection

Supaterm reads the terminal to classify the foreground root phase. Terminal output and OSC state
own the Claude and Codex phase even when hooks are installed. Their hooks add session identity,
turn boundaries, plans, child agents, responses, notifications, and workspace data. Pi's native
integration owns its phase, so terminal detection pauses when both sources identify the same exact
process ID and start time.

Terminal detection proves the agent process before it reads terminal content:

1. Read the pane's foreground process group.
2. Match a declared executable, or a declared wrapper with one complete script argument whose
   suffix is declared.
3. Record the process ID and process start time as one process identity.
4. Read at most 64 KiB from the bottom of the active screen, 4 KiB from the start of the raw
   terminal title, and the latest terminal progress signal.
5. Apply the rules for the proved agent, then wait for weak state changes to settle.

The process proof prevents terminal text from naming an agent on its own. Password entry, closed
surfaces, unreadable screens, unknown processes, and ambiguous process matches produce no detected
state.

Detection-only state is temporary and read-only. It can supply agent identity and `idle`, `running`,
or `needs input` activity to the panel and tab. It cannot create an action session, notification,
child-agent state, or saved state. A matching native session can add those fields without replacing
the detected phase. Detected state clears when the command ends, the surface closes, the process
identity changes, or detection can no longer prove the state.

### Rules

Supaterm bundles the Claude Code, Codex, and Pi activity manifests with the app. It parses them once
at startup and does not update them over the network.

## Supaterm Skill

Supaterm ships its agent skill from `supaterm-skills` inside the app bundle.

Install it with:

```bash
sp skills install
```

The install command copies a stable discovery skill to `~/.agents/skills/supaterm`, replacing any existing path.
The discovery skill directs agents to version-matched content served by `sp skills get` from the app bundle.

Every `sp skills` command asks the connected app, which reads its own bundle and does the copying. The catalog always matches the running app, and the commands fail when no app is reachable.

Inspect the bundled catalog with:

```bash
sp skills
sp skills get core
sp skills get core --full
sp skills path core
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

- Settings > Coding Agents exposes a toggle per agent. Turning it on installs hooks; turning it off removes them.
- `sp agent install-hook <agent>` and `sp agent remove-hook <agent>` reach the same installers over the socket, so the CLI and the toggle do the same work in the same process. Each returns the agent's resulting health, and both fail when no app is reachable.
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
- Installed hook events: `SessionStart`, `PreToolUse`, `PostToolUse`, `Notification`, `UserPromptSubmit`, `Stop`, `SubagentStart`, `SubagentStop`, `TaskCreated`, `TaskCompleted`, `SessionEnd`.

### App Behavior

The app binds Claude sessions to pane surfaces, tracks the foreground session for each pane, and combines hook data with the terminal phase.

- `SessionStart` binds canonical session state to the current pane surface.
- `PreToolUse` and `PostToolUse` record tool activity. `TaskCreate`, `TaskUpdate`, and `TodoWrite` tool results update panel progress from structured payloads.
- `TaskCreated` and `TaskCompleted` upsert shared task rows by task ID, including events from child agents and teammates.
- `Notification` records attention only for `permission_prompt`, `idle_prompt`, and `elicitation_dialog`. An `idle_prompt` cannot replace active background work with pending attention. Background-agent notifications and idle prompts emitted while background work remains suppress their matching terminal notifications, so they cannot create pane unread state or glow.
- `UserPromptSubmit` starts the next stored turn.
- `PreToolUse`, `PostToolUse`, and `UserPromptSubmit` recover the pane binding when `SessionStart` was missed or announced a different session ID, which is what `claude --fork-session --resume` does: its `SessionStart` reports the parent session ID and every later hook carries the forked one.
- `Stop` completes the stored turn and saves the final assistant message as the latest tab notification when one is provided, unless the payload reports an active `background_tasks` entry or a pending `session_crons` entry. A background completion creates `done` status even when the hook omits a final message. Claude reports both `running` and `pending` task states as active.
- A `Stop` payload that carries `background_tasks` also reconciles child rows. Subagent IDs keep matching rows, an active teammate keeps unmatched Claude child rows alive, and an active workflow keeps workflow child rows alive.
- The terminal reader sets Claude's root `idle`, `running`, or `needs input` phase.
- `SessionEnd` drops the stored session state.
- `SubagentStart` and `SubagentStop` maintain scoped child rows without allowing a child to replace the foreground root session. Each row states that the reported child type is working or needs input. Child tool hooks update only that row with the tool name and salient input. They do not create pane notifications or change root lifecycle.
- A command-finished signal from the shell clears pane-bound agent state.

## Codex

Codex uses the same bridge and canonical state model. Native hooks supply attention, turn boundaries, child agents, and plan changes. The terminal reader owns the root phase.

- Settings file: `~/.codex/hooks.json`.
- Installed hook events: `PermissionRequest`, `PostToolUse`, `PreToolUse`, `SessionStart`, `Stop`, `SubagentStart`, `SubagentStop`, `UserPromptSubmit`.
- `PreToolUse` is restricted to `request_user_input`; `PostToolUse` remains unfiltered so later activity can resolve attention state.
- Install enables the Codex hooks feature through the user's login shell, writes the canonical `hooks.json` fragment, then uses `codex app-server --stdio` to discover native hooks and update trust.
- Hook discovery uses `hooks/list`. User-layer version and trust state come from `config/read`; atomic trust replacement uses `config/batchWrite` with that version.
- Supaterm does not parse Codex source, reproduce Codex's hook hashing, edit TOML trust state directly, vendor Codex, or depend on its internal modules.
- Remove rewrites `~/.codex/hooks.json` and removes the matching native trust entries through the same app-server API. It does not disable the hooks feature flag.
- Trust rebasing preserves unrelated hook state, including duplicate unrelated hooks from the same source, while removing displaced Supaterm entries.

### App Behavior

The app binds Codex sessions to pane surfaces and combines hook data with the terminal phase.

- `SessionStart` binds the session to the current pane surface.
- `PreToolUse` for `request_user_input` records attention. `PostToolUse` records ordinary tool activity
  and recovers the pane binding when `SessionStart` was missed.
- `UserPromptSubmit` starts the next turn, recovers the pane binding when `SessionStart` was missed, and clears structured completion suppression.
- `Stop` completes the stored turn and saves the final assistant message as the latest tab notification when one is provided. A background completion creates `done` status even when the hook omits a final message.
- `PermissionRequest` and `request_user_input` record pending attention for the foreground session; only completion of the matching tool resolves it.
- `SubagentStart` and `SubagentStop` maintain scoped child rows from hook IDs and roles. Each row states that the reported child role is working or needs input. Reused child IDs and late stop events cannot remove a newer child lifetime.
- A native `PostToolUse` for `update_plan` reads `tool_input.plan` directly and replaces the plan rows immediately.
- While Codex is `running`, the sidebar tab row shows the tab-level running badge without inline activity text. After `Stop`, hovering the row shows the final assistant response from the focused pane when the hook supplied one.

## Pi

Pi uses the extension package from `supaterm-skills`, not the `sp agent install-hook` settings bridge.

Settings > Coding Agents can install or remove the package by invoking `pi` through the user's login shell.
The socket methods `app.hooks.install` and `app.hooks.remove` accept `pi` and run that same package install or removal. `sp agent install-hook` and `sp agent remove-hook` expose only `claude` and `codex`.
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
