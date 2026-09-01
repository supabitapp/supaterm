# Agent Commands

`sp agent` manages Supaterm's coding-agent integration.

## Reload Detection Rules

Local manifests live in `$SUPATERM_STATE_HOME/agent-detection/<agent>.toml`, or
`~/.config/supaterm/agent-detection/<agent>.toml` without an explicit state root. Reload all local
overrides atomically after an edit:

```bash
sp agent reload-rules
```

An invalid reload fails and keeps the prior rule generation active.

## Install Skill

Install Supaterm's bundled agent skill:

```bash
sp skills install
```

The running Supaterm app copies its bundled discovery skill to `~/.agents/skills/supaterm`. Claude, Codex, Pi, and other agents that support the Agent Skills paths read this same copy. Existing Supaterm skill directories or symlinks are replaced. Detailed instructions stay in the app bundle and are loaded through `sp skills get`.

## Set Up Integrations

Set up the managed Claude and Codex hook integrations:

```bash
sp agent setup
```

Effects:

- `setup` checks Claude and Codex, prints progress for each one, reports every failure, and fails when neither agent is available
- Claude installs Supaterm hooks into `~/.claude/settings.json`
- Claude adds `terminalProgressBarEnabled: true` only when that key is absent
- Codex requires Codex 0.144.1 or newer, enables hooks, installs Supaterm hooks into `~/.codex/hooks.json`, and registers native trust through Codex app-server
- Codex adds `[tui] terminal_title = ["activity", "thread-title", "task-progress"]` to `~/.codex/config.toml` only when that key is absent

Setup preserves existing values for both seeded keys and is safe to run again. The running app does
the writing. Setup needs a reachable Supaterm instance and changes nothing without one.

## Remove Hooks

Remove Supaterm-managed hooks from the Claude and Codex configurations:

```bash
sp agent remove-hooks
```

`remove-hooks` reports every failure and succeeds when an integration is absent or unavailable.
Removing Codex hooks also removes Supaterm hook trust through Codex app-server.

## Forward Hook Events

`sp agent receive-agent-hook --agent <agent>` reads one hook payload from stdin and forwards it to Supaterm.

```bash
printf '{"hook_event_name":"SessionStart","session_id":"session-1","cwd":"/tmp/project"}' \
  | sp agent receive-agent-hook --agent claude
```

Installed hooks pass the parent process ID:

```bash
printf '{"hook_event_name":"SessionStart","session_id":"session-1","cwd":"/tmp/project"}' \
  | sp agent receive-agent-hook --agent codex --pid 123
```

For Claude and Codex, Supaterm uses only root `SessionStart` events. It ignores every other hook event. Session-start payloads should include the agent's absolute `cwd`. Supaterm uses it for the agent panel Workspace row, Git status, and forked session working directory.

An agent-panel fork starts the account login shell in a new pane and enters the agent's native fork command visibly. The pane returns to that same shell when the forked agent exits.

Use this when wiring an external agent hook system into Supaterm. This is lower-level than aggregate hook management.

## Output

`receive-agent-hook` forwards a payload and prints nothing.

`setup` prints a start and result line for each agent. `remove-hooks` prints nothing on success.
`reload-rules` prints detection details. `skills install` prints the installed path.

Failures go to stderr with a non-zero exit status. With no reachable Supaterm instance:

- every one of them prints `Error: No reachable Supaterm instance was found.`
- `sp agent` commands exit 64
- `sp skills` commands exit 1, and `--json` prints `{"success":false,"error":"..."}` on stdout instead
