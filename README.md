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
make generate-project
make build-app
make run-app
```

## Development

```bash
make format
make lint
make test
make check
```
