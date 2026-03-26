---
name: supaterm
description: Inspect and control a running Supaterm app through the supported `sp` CLI and its socket-backed commands. Use when Codex needs to list or target Supaterm instances, inspect the window/space/tab/pane tree, read live diagnostics, create tabs or panes, send notifications, or forward Claude hook events.
---

# Supaterm

Use `sp` for normal interaction. Avoid hand-writing socket JSON unless the task is specifically about debugging the protocol or the CLI itself.

## Inspect the app first

- Run `sp debug --json` to inspect socket selection, pane context, reachable instances, and the live topology.
- Run `sp tree --json` to inspect the window, space, tab, and pane hierarchy.
- Run `sp instances --json` when you are outside Supaterm or the target app process is unclear.
- Run `sp onboard` when the user wants the built-in onboarding shortcuts.
- Run `sp ping` for a narrow liveness check.

## Target the right instance

- Prefer ambient pane targeting when the command is already running inside a Supaterm pane.
- Pass `--instance <name-or-endpoint-id>` when more than one reachable instance exists.
- Pass `--socket <path>` only when the user gives an explicit socket path or when debugging routing.
- Do not guess when discovery is ambiguous. Run `sp instances --json`, pick the instance, and retry with `--instance`.

## Change the app through `sp`

- Create a tab with `sp new-tab --json --focus ...`.
- Create a pane with `sp new-pane --json right|left|up|down ...`.
- Send an in-app notification with `sp notify --json --body ...`.
- Forward one Claude hook payload with `printf '%s\n' '<json>' | sp claude-hook`.
- Use `sp development claude ...` only when the connected app reports a development build.

## Respect the targeting rules

- `new-tab` accepts `--space` and optional `--window` when targeting outside the current pane.
- `new-pane` and `notify` require `--space` together with `--tab` when targeting outside the current pane.
- `--pane` requires `--tab`.
- `--window` requires `--space`.
- If `new-tab`, `new-pane`, or `notify` runs outside Supaterm without the required hierarchy target, the CLI fails instead of inventing one.

## Use the deeper references only when needed

- Read [references/cli.md](references/cli.md) for the command surface and common invocation patterns.
- Read [references/socket.md](references/socket.md) for socket routing, protocol method names, and source-of-truth files in the repo.
