supaterm is a monorepo. The current product code lives in `apps/mac`.

## Issue tracking

- Issues are tracked on: https://linear.app/supaterm

## Layout

- `apps/mac` — macOS app, CLI, Tuist project, resources, and the Ghostty dependency
- `docs` — shared repository documentation

## Build Commands

If your clone predates the monorepo move:

```bash
git submodule sync --recursive
git submodule update --init --recursive
```

```bash
make mac-check
make mac-build
make mac-run
make mac-test
```

## Tooling

- `mise` manages tool versions from the repo root `mise.toml`
- The repo root `Makefile` is the stable entrypoint and delegates to app-local build logic
- Read `docs/mac.md` before working in `apps/mac`
- Read `apps/supaterm.com/AGENTS.md` before working in that as well
