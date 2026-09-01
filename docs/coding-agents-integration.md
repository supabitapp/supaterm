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
- The foreground root agent's session-start `cwd` is the panel workspace source. The pane working directory is the fallback until the session starts.
- Agent-panel forks start the account login shell in a new pane and enter the agent's native fork command visibly. Claude and Codex forks keep supported launch options from the source process. Supaterm waits for shell readiness when the shell reports it. The pane returns to that same shell when the forked agent exits.
- Claude and Codex hook events enter the same session domain before they reach UI state.
- Restored hook-backed sessions retain their lifecycle and panel state only while their recorded process ID and process start time still identify the same process. Restored sessions remain non-actionable until a fresh hook event arrives.
- The same shared state powers every agent, and desktop notification titles derive from the explicit agent kind.
- The tab derives `needs input` and `working` from agent phase and focus. A per-surface, temporary completion marker derives `done` until the tab is viewed. Notifications remain separate.

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
- reduce a finished agent command to `idle`, then clear its live process state
- use the pane foreground process group with hook-reported processes as port-scan roots

Port discovery expands hook process trees and every live member of the pane's foreground process
group, then finds listening ports with `lsof`. The pane process source lets a shell contribute
without an agent hook.

Future agent integrations should keep that split. The wrapper or adapter should stay thin, and all UI state should stay inside the app.

## Terminal Phase Detection

Supaterm reads the terminal to classify the foreground root phase for Claude, Codex, and Pi.
Claude and Codex hooks add only session identity and its workspace. Pi has no managed hook
integration.

Terminal detection proves the agent process before it reads terminal content:

1. Read the pane's foreground process group.
2. Match a declared executable path, process name, or declared process title.
3. Record the process ID and process start time as one process identity.
4. Wait until the process has run for three seconds.
5. Read at most 4 KiB from the start of the raw terminal title and the latest terminal progress
   signal for every due proved pane in one batch.
6. Apply the leading title and progress rules. A decisive match finishes detection without reading
   the screen.
7. For every undecided pane, read at most 64 KiB from the bottom of the active screen and apply all
   rules in one batch.
8. Wait for weak state changes to settle.

The process proof prevents terminal text from naming an agent on its own. Password entry, closed
surfaces, and unreadable screens can publish only from a decisive terminal title or progress rule.
Screen-dependent rules cannot read those panes. Unknown processes and ambiguous process matches
produce no detected state. A proved known agent with no matching rule publishes `unknown`; it never
falls back to `idle`.

Detection-only state is temporary and read-only. It can supply agent identity and `unknown`, `idle`,
`running`, or `needs input` activity to the panel and tab. It cannot create an action session,
notification, child-agent state, or saved state. A matching native session can add those fields
without replacing the detected phase. When the command ends, Supaterm retains a temporary `idle`
completion regardless of exit status. The last exit state clears on later pane activity, focus
cleanup, or surface cleanup. Live detected state clears when the surface closes, the process identity
changes, or detection can no longer prove the state.

### Rules

Supaterm bundles the Claude Code, Codex, and Pi activity manifests with the app. It does not update
them over the network. At startup and on reload, a file at
`$SUPATERM_STATE_HOME/agent-detection/<agent>.toml` replaces that agent's bundled manifest. The
default directory is `~/.config/supaterm/agent-detection`. A failed reload keeps the current complete
rule set.

Reload local manifests after an edit with:

```bash
sp agent reload-rules
```

## Supaterm Skill

Supaterm ships its agent skill from `integrations/supaterm` inside the app bundle.

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

Set up the managed Claude and Codex hook integrations with:

```bash
sp agent setup
```

Setup installs the Claude and Codex hook bridges. It also seeds these display settings when their
keys are absent:

- `~/.claude/settings.json`: `terminalProgressBarEnabled: true`
- `~/.codex/config.toml`: `[tui] terminal_title = ["activity", "thread-title", "task-progress"]`

Setup preserves an existing value for either key. It reports progress for each agent and is safe to
run again.

The app also exposes setup commands through:

```bash
sp onboard
```

## Hook Bridge

Claude and Codex share the settings-file hook bridge, but each installer uses the agent's public configuration surface.

- Settings > Coding Agents exposes Claude and Codex toggles. Turning one on sets up its integration; turning it off removes its hooks.
- `sp agent setup` and `sp agent remove-hooks` reach the app's integration manager for Claude and Codex. A Settings toggle only operates on its selected agent. Both paths use the same concrete integration code in the app process and fail when no app is reachable.
- On open, Settings reports each integration as unavailable, unavailable but installed, absent, partial, drifted, or healthy.
- Claude must be available through the user's login shell. Codex must be version 0.144.1 or newer, have its hooks feature enabled, and have canonical trust state.
- A hook is Supaterm-managed only when its command exactly matches one of Supaterm's canonical hook commands.
- Setup preserves unrelated settings, removes any existing Supaterm-managed hooks anywhere in the file, and then installs the canonical Supaterm hooks.
- The installed hook command uses `SUPATERM_CLI_PATH` so the hook bridge targets the bundled `sp` binary injected into Supaterm panes, and passes `--pid "$PPID"` so Supaterm can track live agent processes.
- The canonical hook fragment is also available from `sp internal agent-settings <agent>`.
- On app launch, Supaterm repairs partial and drifted integrations. It leaves absent and healthy integrations unchanged.

Installed hooks invoke `sp agent receive-agent-hook --agent <agent>`:

- It reads one agent hook event JSON object from stdin; the caller must declare the agent explicitly with `--agent`.
- It forwards that payload to the app over the socket method `terminal.agent_hook`.
- The forwarded request carries the decoded event, the explicit agent kind, and the ambient `SupatermCLIContext` from the current pane.
- Root session-start payloads should include the agent's absolute `cwd`. Supaterm uses it for the Workspace row, Git status, and forked session working directory.

## Claude

- Settings file: `~/.claude/settings.json`.
- Setup writes `terminalProgressBarEnabled: true` only when the key is absent. It preserves any existing value.
- Installed hook events: `SessionStart`, `PreToolUse`, `PostToolUse`, `Notification`, `UserPromptSubmit`, `Stop`, `SubagentStart`, `SubagentStop`, `TaskCreated`, `TaskCompleted`, `SessionEnd`.

### App Behavior

The app uses Claude hooks only for root session identity.

- `SessionStart` binds the session ID, process, workspace, and pane surface.
- Every other Claude hook event is ignored by the app.
- The terminal reader alone sets Claude's root `unknown`, `idle`, `running`, or `needs input` phase.
- A command-finished signal from the shell clears the pane-bound session identity.

## Codex

Codex uses the same session-identity bridge. The terminal reader alone owns the root phase.

- Hook settings file: `~/.codex/hooks.json`.
- User config file: `~/.codex/config.toml`.
- Setup writes `[tui] terminal_title = ["activity", "thread-title", "task-progress"]` only when the key is absent. It preserves any existing value.
- Installed hook events: `PermissionRequest`, `PostToolUse`, `PreToolUse`, `SessionStart`, `Stop`, `SubagentStart`, `SubagentStop`, `UserPromptSubmit`.
- Supaterm keeps the full managed hook set installed, but the app ignores every event except root `SessionStart`.
- Install enables the Codex hooks feature through the user's login shell, writes the canonical `hooks.json` fragment, then uses `codex app-server --stdio` to discover native hooks and update trust.
- Hook discovery uses `hooks/list`. User-layer version and trust state come from `config/read`; atomic trust replacement uses `config/batchWrite` with that version.
- Supaterm does not parse Codex source, reproduce Codex's hook hashing, edit TOML trust state directly, vendor Codex, or depend on its internal modules.
- Remove rewrites `~/.codex/hooks.json` and removes the matching native trust entries through the same app-server API. It does not disable the hooks feature flag.
- Trust rebasing preserves unrelated hook state, including duplicate unrelated hooks from the same source, while removing displaced Supaterm entries.

### App Behavior

The app uses Codex hooks only for root session identity.

- `SessionStart` binds the session ID, process, workspace, and pane surface.
- Every other Codex hook event is ignored by the app.
- The terminal reader alone sets Codex's root `unknown`, `idle`, `running`, or `needs input` phase.

## Pi

Pi uses terminal phase detection and reads the same skill installed at
`~/.agents/skills/supaterm`. Supaterm does not install a Pi package or change Pi settings. Pi state is
temporary and read-only, so it does not create a saved session, an action session, child-agent state,
or native event notifications.
