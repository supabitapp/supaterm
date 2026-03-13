# Supaterm

Minimal macOS starter app for the next version of Supaterm.

## Technical Stack

- [The Composable Architecture](https://github.com/pointfreeco/swift-composable-architecture)
- [Tuist](https://tuist.dev/)

## Requirements

- macOS 15.0+
- [mise](https://mise.jdx.dev/) (for pinned toolchain dependencies, including Tuist)

## Building

```bash
mise exec -- tuist auth login
make generate-project
make build-app
make run-app
```

`make generate-project` uses the `development` Tuist module-cache profile. If you are not authenticated with Tuist, generation still succeeds and falls back to source dependencies.

## Development

```bash
make inspect-dependencies
make format
make lint
make test
make check
```

For a source-only workspace, use:

```bash
make generate-project-sources
```

To refresh the external module cache manually, use:

```bash
make warm-cache
```

`make warm-cache` requires either `mise exec -- tuist auth login` locally or `TUIST_TOKEN` in CI.
