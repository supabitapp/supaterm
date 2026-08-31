# Socket Control

This document captures the stable rules of Supaterm's socket IPC. The source remains authoritative for concrete APIs and current command surfaces.

## Model

- Each running Supaterm app process owns one Unix domain socket endpoint.
- Each endpoint has an ID, name, path, pid, and start time.
- The app and CLI share one protocol contract for endpoint identity, discovery, requests, and responses.
- Pane-launched CLI processes are wired back to the owning app through injected environment, so the common path does not require discovery.
- CLI invocations outside Supaterm can discover managed endpoints, but they never select when resolution is ambiguous.
- The CLI holds no user state. The app process reads and writes every settings, hook, and skill file.

## Endpoint Identity

- `SUPATERM_INSTANCE_NAME` names the app process endpoint.
- Unnamed app processes use `default`.
- Managed socket filenames include a normalized instance name, a stable name hash, and the process ID.
- `sp instance ls` lists reachable managed endpoints.
- `sp instance ls --json` returns endpoint IDs for unambiguous targeting.

One instance name belongs to one live app process.

- The name also keys the persistent session names and the saved layout, so two processes sharing a
  name share their terminal sessions: each would attach to the other's live sessions, and closing
  either window would kill them for both.
- A launching app takes an exclusive lock on its name in the managed socket directory. When another
  live process already holds the name, the launching app reports the clash and exits.
- The kernel owns the lock, so it drops the moment the owning process dies. No file has to be
  reaped, and a crash never blocks the next launch.
- Running a second app process is still a matter of naming it: launch it with a distinct
  `SUPATERM_INSTANCE_NAME`.

## Target Resolution

Socket selection and terminal object targeting are separate.

Socket selection order:

1. `--socket <path>`
2. `SUPATERM_SOCKET_PATH`
3. `--instance <name-or-endpoint-id>`
4. The single reachable discovered endpoint

Terminal object targeting happens after socket selection:

- Pane context comes from `SUPATERM_SURFACE_ID` and `SUPATERM_TAB_ID`.
- Inside Supaterm, commands can omit targets such as `sp tab new`, `sp pane split`, `sp tab focus`, and `sp pane focus`.
- Outside Supaterm, pass selectors, typed short refs, UUIDs, or `--in` targets.
- The CLI resolves public selectors from a fresh tree and sends stable object IDs.
- The app resolves those IDs against live state when it runs the command, so an index change cannot retarget a queued command.

Discovery rules:

- Managed socket discovery stays scoped to the current user.
- Discovery probes managed socket files and removes stale managed sockets.
- Reachable sockets are never silently replaced.
- If multiple reachable endpoints exist, the CLI requires `--instance` or `--socket`.
- If more than one endpoint has the requested name, pass the endpoint ID or `--socket`.

## Request Handling

- Requests and replies are newline-delimited JSON objects.
- Transport concerns and command semantics are split cleanly.
- The transport layer owns socket lifecycle, buffering, and I/O.
- The app-side control layer interprets requests and produces typed responses.
- Successful responses carry the original request ID, `ok: true`, and `result`.
- Failed responses carry `ok: false`, an optional request ID, and `error`.
- Responses with a missing outcome or both `result` and `error` are invalid.
- Unknown methods return `method_not_found`.
- Bad request shapes return `invalid_request`.

## Terminal Topology

- Socket operations target the live terminal model exposed by the app.
- A space is a shared identity: name, color, and catalog order. Every window can display every space.
- Tabs live per window per space. The same space holds different tabs in different windows.
- A window displays one space at a time and switches in place. No socket command opens or closes a window to reach a space.
- Explicit hierarchical selectors resolve in window, then space, then tab, then pane order before the request is sent.
- Pane-context targeting is available when the CLI is launched from inside Supaterm.
- Public selectors are 1-based:
  - Space: `1`
  - Tab: `1/2`
  - Pane: `1/2/3`
- Space indexes follow catalog order, which is the order of the switcher dots, and mean the same thing in every window.
- UUIDs are accepted anywhere the matching command accepts a space, tab, or pane.
- Typed short refs use `s:`, `g:`, `t:`, or `p:` plus 8 to 32 UUID hex characters. The CLI resolves one fresh snapshot, rejects ambiguity, then sends the full UUID.
- Creation commands return typed IDs: `spaceID`, `tabID`, and `paneID`.

### The ambient window

Space commands, and tab creation aimed at a space, act on one window: the ambient window.

- The CLI sends `SUPATERM_SURFACE_ID` and `SUPATERM_TAB_ID` as the request `context`.
- The app maps that context to the window that owns the pane or tab.
- Without a context, the app uses the key window.
- The command switches that window and leaves every other window alone.

### Tree shape

`app.tree` is the compact internal topology used to resolve mutation targets. `app.debug` reports every window with the space it displays and every space in catalog order. A space the window has not opened yet in this run reports `isWarm: false` along with the tabs from its saved layout; its panes exist on disk but have no live surface until the window displays that space or a command creates a tab there.

`sp ls` requests one rich `app.debug` snapshot and projects it to an ordered flat item list. JSON returns canonical IDs only. Human and plain modes derive the shortest unique typed ref for each item kind. The same space ID can occur once per window, so `windowIndex` scopes space rows and parent joins. `revision` is an opaque live snapshot token. Compare it for equality; it is not a counter or schema version.

Each live `app.debug` pane reads `foregroundProcessGroupID` and `ttyName` from its Ghostty surface
when the request runs. Process-group ID `0` and an empty tty are reported as unavailable.
`sp diagnostic` renders the same values for the current pane, and `sp diagnostic --json` keeps them
under the matching pane in `app.windows`.

```json
{
  "windows": [
    {
      "index": 1,
      "isKey": true,
      "displayedSpaceID": "6D1B...",
      "spaces": [
        {
          "index": 1,
          "id": "6D1B...",
          "name": "Work",
          "color": "green",
          "isWarm": true,
          "rootItems": [
            { "kind": "tab", "isPinned": false, "tab": { "id": "3F0A...", "title": "shell", "isSelected": true, "panes": [{ "index": 1, "id": "9C77...", "isFocused": true }] } }
          ]
        },
        {
          "index": 2,
          "id": "A41E...",
          "name": "Logs",
          "color": "blue",
          "isWarm": false,
          "rootItems": []
        }
      ]
    }
  ]
}
```

## Public CLI Surface

Tree and diagnostics:

```bash
sp ls
sp ls --json
sp onboard
sp diagnostic
sp instance ls
```

Licensing:

```bash
sp license
sp license activate
sp license refresh
sp license deactivate
sp license buy
sp license renew
```

The app owns the license key, signed entitlement, browser actions, and service requests. Activation
reads the key from a hidden prompt or stdin and never accepts it as an argument.

Connection flags:

```bash
sp ls --instance work-mac
sp diagnostic --socket /path/to/socket
sp pane capture --instance 2F4D3B19-91EC-4F78-9BCE-6F3F4E301E59 1/2/3
```

Terminal control:

```bash
sp space ls
sp space new Work
sp space focus 2
sp space next
sp space last
sp space destroy -y 3
sp tab new --in 1 --cwd ~/tmp -- ping 1.1.1.1
sp pane split --in 1/2 right
sp pane send --newline 'echo hello'
sp pane capture --scope scrollback --lines 200
sp pane screenshot --output pane.png
sp pane layout main-vertical 1/2
sp pane health 1/2/3
sp pane wait-ready 1/2/3
```

A tab or pane with no command starts the account login shell.

Use `--script` for builtins, aliases, or raw shell code. Supaterm starts the account login shell and enters the text visibly. It waits for shell readiness when the shell reports it; otherwise it queues the text when it creates the surface. The same shell remains after the script ends.

For `sp tab new` and `sp pane split`, arguments after `--` launch a process directly. The first argument names an executable resolved with the caller's `PATH`, and every argument remains exact. Supaterm skips shell startup files, and the tab or pane closes when the process exits.

Their JSON output includes typed IDs. Their plain output is the new pane UUID for direct chaining.

Agent-panel forks also start the account login shell and enter the agent's native fork command visibly. The pane returns to the same shell when the agent exits. Terminal configuration cannot replace the launch selected by Supaterm.

Config, hooks, and skills:

```bash
sp config path
sp config get updates.channel
sp config set appearance.mode system
sp config validate
sp agent setup
sp agent remove-hooks
sp skills list
sp skills get core
sp skills install
```

Local project metadata:

```bash
sp project icon
sp project icon ~/code/project --json
```

- `sp project icon` and `sp config path` need no running app.
- Every other command in those two blocks needs a reachable app.
- `sp config path` reads the local state root, so it can differ from the path the app reports when the two run with different `SUPATERM_STATE_HOME` values.
- Without a reachable app, `sp config` and `sp agent` exit 64 and `sp skills` exits 1. All three print `Error: No reachable Supaterm instance was found.`
- `sp agent setup` checks every supported agent, prints progress for each one, reports every failure, and fails when no supported agent is available.
- Setup installs the supported hooks or package. It seeds Claude's `terminalProgressBarEnabled` and Codex's `tui.terminal_title` only when each key is absent, preserves existing values, and is safe to rerun.
- `sp agent remove-hooks` checks every supported agent and succeeds when an agent is absent or unavailable.
- `sp agent receive-agent-hook` forwards hook payloads and is unaffected by these rules.

## Runtime Guarantees

- Managed socket paths are created under `XDG_RUNTIME_DIR` when it fits the Unix socket path limit.
- If `XDG_RUNTIME_DIR` is unavailable or too long, Supaterm falls back through `TMPDIR` and then `/tmp`.
- Managed socket directories are per-user.
- Stale managed sockets can be removed.
- Path resolution is canonicalized so endpoint creation, discovery, and identity agree on the same location.
- Incoming requests can be buffered briefly until the app starts consuming the stream.
- Socket path generation respects the platform `sockaddr_un.sun_path` byte limit.

## Method Families

The full method list lives in `SupatermSocketMethod` (`apps/mac/SupatermCLIShared/SupatermSocketProtocol.swift`):

- `app.*` — onboarding, debug, tree, settings, hooks, skills
- `license.*` — status, activation, refresh, deactivation, purchase, and renewal
- `system.*` — identity, ping
- `terminal.agent_hook` — coding agent hook events
- `terminal.*` — space, tab, and pane control, one method per CLI verb

`terminal.capture_pane` returns terminal text. `terminal.screenshot_pane` returns PNG data for a
pane, including one hidden in another space or tab. The CLI writes that data to its requested path.

Settings methods read and write the running app:

- `app.settings.get`, `app.settings.list`, `app.settings.set`, and `app.settings.reset` act on the live settings the app already holds. A write lands in the app and on disk at once.
- `app.settings.validate` takes an optional absolute `path` and checks that file. Without a path it checks the app's own settings file.

Agent integration methods own each agent's settings or package:

- `app.agent_integration.setup` and `app.hooks.remove` take `{"agent":"claude|codex|pi"}` and return that agent and its resulting health.
- The app writes `~/.claude/settings.json`, `~/.codex/hooks.json`, and `~/.codex/config.toml`, and talks to Codex app-server. The CLI never touches those files.
- Setup adds Claude's `terminalProgressBarEnabled: true` and Codex's `[tui] terminal_title = ["activity", "thread-title", "task-progress"]` only when each key is absent.

`app.agent_detection.reload` atomically reloads local manifests from the app's state root and
returns the active generation and source of each manifest.

Debug snapshot panes carry coding agent detection. Each pane has `agentStatus` and, when an agent
resolves, an `agent` object.

- `agentStatus` is `detection_disabled`, `waiting`, `no_foreground_process`,
  `unrecognized_process`, `native_authority`, `screen_unavailable`,
  `no_rule_match_or_settling`, or `resolved`.
- `agent` contains `kind`, `phase` (`unknown`, `idle`, `running`, or `needs_input`), and `phaseSource`
  (`native` or `screen`), plus `sessionID`, `ruleID`, and `process` when those values exist.
- `process` contains `processID` and `startTimeMicroseconds`.

`sp ls --json` mirrors `agent` and `agentStatus` on pane items. The snapshot omits terminal text,
rule patterns, and internal match weights.

Skill methods serve the app bundle:

- `app.skills.list`, `app.skills.get`, and `app.skills.path` read the skills bundled with the connected app, so their content matches that app's version.
- `app.skills.install` copies the discovery skill to `~/.agents/skills/supaterm` and returns the path.

Space methods carry the ambient `context` instead of a window index:

- `terminal.create_space` takes a name, an optional color, and the context. It appends to the catalog and displays the new space in the ambient window. It never opens a window.
- `terminal.select_space` takes a space ID and the context, and switches the ambient window in place.
- `terminal.next_space`, `terminal.previous_space`, and `terminal.last_space` take only the context. The app derives the starting point from the window's displayed space, and `last` uses that window's previous space.
- `terminal.close_space` destroys the space everywhere: it kills that space's tabs in every window, and windows displaying it fall back to the catalog neighbor. No window closes.
- `terminal.new_tab` aimed at a space resolves the space inside the ambient window, opens its saved tabs first when needed, and with `focus` also switches the window to that space.
- `sp space ls` needs no method of its own; the CLI reads `app.tree` and prints the ambient window's spaces.

## Code Index

- `apps/mac/supaterm/SocketFeature/` is the app-side socket boundary.
- `apps/mac/supaterm/SocketFeature/SocketControlFeature.swift` owns request semantics.
- `apps/mac/supaterm/SocketFeature/SocketControlRuntime.swift` owns socket lifecycle and transport.
- `apps/mac/SupatermCLIShared/` holds the shared IPC contract and nothing else.
- `apps/mac/supaterm/Support/` is `SupatermSupport`, the app-only home of the settings registry, hook installers, and skills.
- `apps/mac/SupatermCLIShared/SupatermSocketProtocol.swift` defines methods and the request and response envelope.
- `apps/mac/SupatermCLIShared/SupatermSocketTerminalPayloads.swift`, `SupatermSocketSnapshots.swift`, and `SupatermSocketNotifications.swift` define the payload types.
- `apps/mac/SupatermCLIShared/SupatermSocketPath.swift` defines endpoint resolution and discovery.
- `apps/mac/SupatermCLIShared/SupatermCLIContext.swift` defines pane context passed through environment.
- `apps/mac/SPCLI/` is the shared CLI implementation surface.
- `apps/mac/sp/main.swift` is the CLI entrypoint.
- `apps/mac/SPCLI/SPSocketClient.swift` is the CLI transport client.
- `apps/mac/supaterm/Features/Terminal/Ghostty/GhosttySurfaceView.swift` injects pane context into terminal processes.
