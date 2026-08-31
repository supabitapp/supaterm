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
- A new pane clears any inherited `CODEX_THREAD_ID` before it starts its shell or command.
- For login-shell panes, Supaterm prepends the app's `Contents/MacOS` directory to `PATH`. The directory ships `sp`, `ap`, and `wt`. The app builds `ap` from `ThirdParty/coding-agents-session-picker` and embeds `wt` from `ThirdParty/git-wt`. Direct launches keep the caller's `PATH` unchanged.
- Structured agent events go through the `sp` CLI and then through the socket control boundary into the app process.
- The app process is the only place that decides tab activity, pending input state, and desktop notification delivery.
- Agent notifications are routed to the pane context first and then to the stored session surface when available.
- Foreground session routing prevents restored or background sessions from stealing the panel, fork, copy, and tab activity surface.
- The foreground root agent's session-start `cwd` is the panel workspace source. The pane working directory is the fallback until the session starts.
- Agent-panel forks start the account login shell in a new pane and enter the agent's native fork command visibly. Claude, Codex, and Pi forks keep supported launch options from the source process. Supaterm waits for shell readiness when the shell reports it. The pane returns to that same shell when the forked agent exits.
- Every adapter event is translated into the same session, turn, attention, progress, and child-agent domain before it reaches UI state.
- Restored sessions retain their lifecycle and panel state only while their recorded process ID and process start time still identify the same process. Restored sessions remain non-actionable until a fresh native event arrives.
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

Supaterm reads the terminal to classify the foreground root phase. Terminal output and OSC state
own the Claude and Codex phase even when hooks are installed. Their hooks add only session identity
and its workspace. Pi's native
integration owns its phase, so terminal detection pauses when both sources identify the same exact
process ID and start time.

Terminal detection proves the agent process before it reads terminal content:

1. Read the pane's foreground process group.
2. Match a declared executable, or a declared wrapper with one complete script argument whose
   suffix is declared.
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

Install hooks for every supported agent with:

```bash
sp agent install-hooks
```

The app also exposes setup commands through:

```bash
sp onboard
```

## Managed Hooks

Claude and Codex use settings files, but each installer uses the agent's public configuration surface.

- Settings > Coding Agents exposes a toggle per agent. Turning it on installs hooks; turning it off removes them.
- `sp agent install-hooks` and `sp agent remove-hooks` reach every supported installer over the socket. A Settings toggle only operates on its selected agent. Both use the same installer code in the app process and fail when no app is reachable.
- On open, Settings reports each integration as unavailable, unavailable but installed, absent, partial, drifted, or healthy.
- Claude must be available through the user's login shell. Codex must be version 0.144.1 or newer, have its hooks feature enabled, and have canonical trust state.
- A hook is Supaterm-managed when its command matches a canonical command. Codex installs an exact marked command with the bundled `sp` executable's canonical absolute path. It also recognizes the prior environment-based command and marked commands with stale paths so install, repair, and removal work after an app move.
- Install preserves unrelated settings, removes any existing Supaterm-managed hooks anywhere in the file, and then installs the canonical Supaterm hooks.
- Claude's installed command uses `SUPATERM_CLI_PATH` and passes `--pid "$PPID"`.
- Codex's canonical command invokes the bundled `sp` by its absolute path through `exec /bin/sh`, passes `--pid "$PPID"`, and drains stdin when the CLI is missing or fails. It does not depend on runtime `HOME`, `PATH`, or `SUPATERM_CLI_PATH`.
- The canonical hook fragment is also available from `sp internal agent-settings <agent>`.
- On app launch, Supaterm repairs partial and drifted integrations. It leaves absent and healthy integrations unchanged.

Installed hooks invoke `sp agent receive-agent-hook --agent <agent>`:

- It reads one agent hook event JSON object from stdin; the caller must declare the agent explicitly with `--agent`.
- Eligible events reach the app over the socket method `terminal.agent_hook`.
- Claude, Pi, and non-session-start Codex traffic carry the ambient `SupatermCLIContext` and use normal socket targeting.
- A durable Codex root `SessionStart` uses candidate routing instead of ambient pane and socket targeting.
- Root session-start payloads should include the agent's absolute `cwd`. Supaterm uses it for the Workspace row, Git status, and forked session working directory.

## Claude

- Settings file: `~/.claude/settings.json`.
- Installed hook events: `SessionStart`, `PreToolUse`, `PostToolUse`, `Notification`, `UserPromptSubmit`, `Stop`, `SubagentStart`, `SubagentStop`, `TaskCreated`, `TaskCompleted`, `SessionEnd`.

### App Behavior

The app uses Claude hooks only for root session identity.

- `SessionStart` binds the session ID, process, workspace, and pane surface.
- Every other Claude hook event is ignored by the app.
- The terminal reader alone sets Claude's root `unknown`, `idle`, `running`, or `needs input` phase.
- A command-finished signal from the shell clears the pane-bound session identity.

## Codex

Codex hooks supply root session identity. The terminal reader alone owns the root phase.

- Managed file: `~/.codex/hooks.json`.
- Installed hook events: `PermissionRequest`, `PostToolUse`, `PreToolUse`, `SessionStart`, `Stop`, `SubagentStart`, `SubagentStop`, `UserPromptSubmit`.
- Supaterm keeps the full managed hook set installed, but the app ignores every event except root `SessionStart`.
- Install enables the Codex hooks feature through the user's login shell, writes the canonical `hooks.json` fragment with the bundled `sp` path, then uses `codex app-server --stdio` to discover native hooks and update trust.
- Hook discovery uses `hooks/list`. User-layer version and trust state come from `config/read`; atomic trust replacement uses `config/batchWrite` with that version.
- Supaterm does not parse Codex source, reproduce Codex's hook hashing, edit TOML trust state directly, vendor Codex, or depend on its internal modules.
- Remove rewrites `~/.codex/hooks.json` and removes the matching native trust entries through the same app-server API. It does not disable the hooks feature flag.
- Trust rebasing preserves unrelated hook state, including duplicate unrelated hooks from the same source, while removing displaced Supaterm entries.

### App Behavior

The app uses Codex hooks for durable root session identity.

- An eligible `SessionStart` omits `agent_id`, has nonempty `session_id`, `cwd`, and `transcript_path` fields, and has source `startup`, `resume`, `clear`, or `compact`. An empty `agent_id` still makes the event ineligible. Other Codex session starts are ignored.
- Unless the caller passes `--socket` or `--instance`, `sp` ignores inherited pane and socket targeting and queries every discovered app instance through `terminal.agent_hook_candidates`.
- Managed app sockets share the fixed per-user `/tmp/supaterm-<uid>` namespace, so discovery does not depend on the hook host's `XDG_RUNTIME_DIR` or `TMPDIR`.
- The CLI polls each managed app socket within one routing budget and removes stale socket nodes as it finds them. Candidate order is one direct process match from a nonshared hook host; on a complete round, the existing owner for a same-ID `compact`; after the detection deadline, one exact full or Codex-rendered session ID token in the raw terminal title; for `startup`, one guarded fork; otherwise one workspace match. A custom display title does not replace the raw title used for matching.
- A guarded fork requires exactly one same-workspace candidate that can own the incoming session. That candidate must come from the shared Codex host and run `codex fork <canonical-parent-session-UUID>`. The parent must be a live foreground session owned by another pane, and the fork process identity must differ from the parent's recorded identities. Another destination that owns the incoming session blocks the route.
- The final workspace step requires one cwd match across all live candidates from all compatible app instances, not only candidates eligible to own the session. The match must have no owner or own the incoming session. A second cwd match blocks the route, regardless of ownership.
- Direct process evidence can route during an incomplete round. Every later step needs a complete round; title, fork, and workspace evidence also wait for the detection deadline. A missing or incompatible instance reply keeps the round incomplete. Missing, incomplete, or ambiguous evidence fails closed.
- The delivered request uses the candidate pane's context and live detected process identity: PID and process start time. It never binds the Codex app-server process ID.
- A same-ID `compact` event keeps the current owner. The workspace match can deliver when the pane has no owner or owns the incoming session; it cannot replace another session. A nonshared host rejects a nested route when its inherited session ID differs from the incoming ID. A shared Codex app-server host ignores inherited session state. Replacing another owned session needs a direct process match from a nonshared host or an exact session-title token. The router requires an exact title to replace an owner under a shared host; a `clear` or session-switch `resume` without that proof fails closed.
- Routing checks whether `transcript_path` is nonempty. Supaterm never opens the transcript or sends transcript content beyond the hook JSON it received.
- A routed `SessionStart` binds the session ID, process, workspace, and pane surface.
- Every other Codex hook event is ignored by the app.
- The terminal reader alone sets Codex's root `unknown`, `idle`, `running`, or `needs input` phase.

## Pi

Pi uses the extension package from `supaterm-skills` instead of a settings file.

Settings > Coding Agents can install or remove the package by invoking `pi` through the user's login shell.
The socket methods `app.hooks.install` and `app.hooks.remove` accept `pi` and run that same package install or removal. The aggregate CLI commands include Pi.
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
