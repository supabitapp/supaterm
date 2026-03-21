# Supaterm

Minimal macOS starter app for the next version of Supaterm.

## Technical Stack

- [The Composable Architecture](https://github.com/pointfreeco/swift-composable-architecture)
- [Tuist](https://tuist.dev/)

## Requirements

- macOS 26.0+
- [mise](https://mise.jdx.dev/) (for pinned toolchain dependencies, including Tuist and Zig)

## Building

```bash
git submodule update --init --recursive
make build-app
make run-app
```

If you want Tuist remote cache, authenticate once with

```
mise exec -- tuist auth login
```
If you are not authenticated, builds still work and fall back to source dependencies.

## Development

```bash
make test
make check
```

## Web & Server

Headless PTY server + browser-based terminal client.

### Native (macOS/Linux with Bun)

```bash
make dev            # server (:7681) + web (:5173) with hot reload
make dev-server     # server only
make dev-web        # web only
make check-web      # typecheck (tsgo) + lint (oxlint)
```

### Docker

```bash
make dev-docker     # server + web with hot reload (source mounted)
make dev-docker-down
make docker-prod    # production image (server + bundled web)
```

### Structure

```
packages/
  shared/    TypeScript types (protocol, split-tree, workspace)
  server/    PTY server (Bun, WebSocket, SQLite)
  web/       Browser client (React, restty/WebGPU, Zustand)
  bridge/    PTY relay for macOS remote mode
```
