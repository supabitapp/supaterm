# Supaterm

Supaterm is a monorepo. The current shipped product is the macOS terminal app in `apps/mac`.

## Layout

- `apps/mac` — macOS app, embedded `sp` CLI, Tuist project, and Ghostty dependency
- `docs` — shared repository documentation

## Requirements

- macOS 26.0+
- [mise](https://mise.jdx.dev/) for pinned toolchain dependencies

## Building

If your clone predates the monorepo move:

```bash
git submodule sync --recursive
git submodule update --init --recursive
```

```bash
make mac-build
make mac-run
```

## Development

```bash
make mac-test
make mac-check
```

See `apps/mac/README.md` for mac app details.
