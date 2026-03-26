# `sp` CLI surface

## Prefer the CLI over raw socket payloads

Use `sp` for normal interaction with the app. The CLI already handles socket discovery, ambient pane context, instance selection, request encoding, and response decoding.

## Resolve the target

- `--socket` wins over every other targeting signal.
- `SUPATERM_SOCKET_PATH` is the next fallback when the command runs inside a Supaterm pane.
- Discovery is the final fallback for commands launched outside Supaterm.
- If discovery finds multiple reachable instances and you did not pass `--instance` or `--socket`, the CLI fails instead of guessing.

## Use the inspection commands

- `sp instances --json`
  List reachable Supaterm instances.
- `sp debug --json [--instance <value>] [--socket <path>]`
  Inspect socket routing, current pane context, build state, and full topology.
- `sp tree --json [--instance <value>] [--socket <path>]`
  Inspect the window, space, tab, and pane hierarchy.
- `sp onboard [--instance <value>] [--socket <path>]`
  Print onboarding shortcuts.
- `sp ping [--timeout <seconds>] [--instance <value>] [--socket <path>]`
  Check socket liveness.

## Use the mutating commands

- `sp new-tab [--json] [--space <n>] [--window <n>] [--cwd <path>] [--focus] [command ...]`
- `sp new-pane [--json] [--space <n> --tab <n> [--pane <n>] [--window <n>]] <right|left|up|down> [command ...]`
- `sp notify [--json] [--space <n> --tab <n> [--pane <n>] [--window <n>]] [--title <value>] [--subtitle <value>] --body <value>`
- `printf '%s\n' '<json>' | sp claude-hook`
- `sp development claude ...`

## Respect the argument rules

- `new-tab`: `--window` requires `--space`.
- `new-tab`: outside Supaterm, provide `--space` if you are not using ambient pane context.
- `new-pane`: `--pane` requires `--tab`.
- `new-pane`: `--tab` requires `--space`.
- `new-pane`: `--window` requires `--space`.
- `new-pane`: outside Supaterm, provide `--space` and `--tab` if you are not using ambient pane context.
- `notify`: `--pane` requires `--tab`.
- `notify`: `--tab` requires `--space`.
- `notify`: `--window` requires `--space`.
- `notify`: outside Supaterm, provide `--space` and `--tab` if you are not using ambient pane context.

## Use the common sequences

- Inspect the live app:

```bash
SP="$(scripts/resolve_sp.sh)"
"$SP" debug --json
```

- Disambiguate a target outside Supaterm:

```bash
SP="$(scripts/resolve_sp.sh)"
"$SP" instances --json
"$SP" tree --json --instance <name-or-id>
```

- Open a new tab in the selected space from inside Supaterm:

```bash
SP="$(scripts/resolve_sp.sh)"
"$SP" new-tab --focus zsh
```

- Split the current pane to the right:

```bash
SP="$(scripts/resolve_sp.sh)"
"$SP" new-pane --json right
```

- Send a notification to a specific pane from outside Supaterm:

```bash
SP="$(scripts/resolve_sp.sh)"
"$SP" notify --json --instance <name-or-id> --space 1 --tab 2 --pane 1 --body "Done"
```
