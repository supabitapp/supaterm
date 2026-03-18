# Socket Control

Supaterm exposes a local Unix domain socket so the bundled `sp` CLI can talk to the running app.

## Path and lifetime

- The socket path is computed in `SupatermCLIShared/SupatermSocketPath.swift`.
- Resolution order is:
  - an explicit CLI `--socket` override
  - `SUPATERM_SOCKET_PATH` from the environment
  - `~/Library/Application Support/Supaterm/supaterm.sock`
- The app does not persist alternate socket paths. The default path is computed when needed.
- When the app starts the socket runtime:
  - creates `~/Library/Application Support/Supaterm` with `0700`
  - removes any stale socket file at the resolved path
  - binds and listens on `supaterm.sock`
  - sets the socket file permissions to `0600`
- When the app stops the runtime, it closes the listener and removes the socket file.

## Architecture

- `SupatermCLIShared` owns the shared contract:
  - environment keys such as `SUPATERM_SOCKET_PATH`
  - socket path resolution
  - request and response payload types
- `SocketControlRuntime` owns the Unix socket server:
  - `socket`, `bind`, `listen`, `accept`, `read`, and `write`
  - directory creation and socket-file cleanup
  - malformed request handling before anything reaches TCA
- `SocketControlClient` is the dependency boundary between the runtime and the reducer.
- `SocketControlFeature` owns request semantics:
  - starts the runtime
  - consumes decoded requests as an `AsyncStream`
  - turns methods into responses
- `AppFeature` hosts `SocketControlFeature`, so socket requests enter the normal reducer graph.

This split is intentional. Transport details stay out of reducers, while actual command behavior remains testable with `TestStore`.

## Protocol

- Transport is newline-delimited UTF-8 JSON.
- One request line produces one response line.
- Requests use:
  - `id`: caller-generated correlation id
  - `method`: command name
  - `params`: method arguments
- Responses use:
  - `id`: copied from the request when available
  - `ok`: success flag
  - `result`: payload for successful calls
  - `error`: `{ code, message }` for failures
- Unknown methods return `method_not_found`.
- Invalid JSON never reaches the reducer. The runtime replies with `invalid_request`.

## Current command surface

- `system.ping` is the only socket method today.
- The reducer answers with:

```json
{"id":"...","ok":true,"result":{"pong":true}}
```

- `sp ping` resolves the socket path, sends `system.ping`, and prints `pong` on success.

## Pane environment

Supaterm injects the following values into terminal panes:

- `SUPATERM_SOCKET_PATH`
- `SUPATERM_SURFACE_ID`
- `SUPATERM_TAB_ID`

That gives `sp` enough context to find the local app socket from inside a pane without extra shell setup.

## Tests

- Shared protocol and path logic live under `supatermTests` and should be covered with direct unit tests.
- Reducer behavior belongs in `SocketControlFeatureTests`.
- Runtime tests should stay focused on transport behavior only.
