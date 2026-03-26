# Supaterm socket model

## Treat these rules as stable

- Each running Supaterm app process owns one Unix domain socket endpoint.
- Requests and replies are newline-delimited JSON messages.
- The CLI and the app share one protocol contract for discovery, requests, and responses.
- Pane-launched commands receive ambient context through `SUPATERM_CLI_PATH`, `SUPATERM_SOCKET_PATH`, `SUPATERM_SURFACE_ID`, and `SUPATERM_TAB_ID`.
- Managed socket discovery stays scoped to the current user.
- Reachable sockets are not silently replaced.

## Follow the selection order

- An explicit socket target wins over every other signal.
- Ambient pane context wins over discovery.
- Discovery is the fallback outside Supaterm.
- If selection is ambiguous, fail and require `--instance` or `--socket`.

## Map the protocol methods to the CLI

- `system.ping` maps to `sp ping`.
- `system.identity` is used by discovery and endpoint probing.
- `app.tree` maps to `sp tree`.
- `app.onboarding` maps to `sp onboard`.
- `app.debug` maps to `sp debug`.
- `terminal.new_tab` maps to `sp new-tab`.
- `terminal.new_pane` maps to `sp new-pane`.
- `terminal.notify` maps to `sp notify`.
- `terminal.claude_hook` maps to `sp claude-hook`.

## Read the source of truth in the repo when the skill needs more detail

- `docs/how-socket-works.md`
- `apps/mac/sp/SPCommand.swift`
- `apps/mac/sp/SPSocketClient.swift`
- `apps/mac/SupatermCLIShared/SupatermSocketProtocol.swift`
- `apps/mac/SupatermCLIShared/SupatermSocketPath.swift`
- `apps/mac/SupatermCLIShared/SupatermCLIContext.swift`
