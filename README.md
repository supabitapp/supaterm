# Supaterm

Minimal macOS starter app for the next version of Supaterm.

## Technical Stack

- [The Composable Architecture](https://github.com/pointfreeco/swift-composable-architecture)
- [Tuist](https://tuist.dev/)

## Requirements

- macOS 15.0+
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
