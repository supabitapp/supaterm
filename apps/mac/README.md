# Supaterm macOS app

Supaterm's current product is the macOS terminal app in `apps/mac`.

## Technical Stack

- [The Composable Architecture](https://github.com/pointfreeco/swift-composable-architecture)
- [Tuist](https://tuist.dev/)

## Requirements

- macOS 26.0+
- [mise](https://mise.jdx.dev/) (for pinned toolchain dependencies, including Tuist and Zig)

## First-time setup

```bash
git submodule sync --recursive
git submodule update --init --recursive
```

## Build from the repo root

```bash
make mac-build
make mac-run
make mac-test
make mac-check
```

## Build from `apps/mac`

```bash
cd apps/mac
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
cd apps/mac
make test
make check
```
