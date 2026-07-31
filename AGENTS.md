## Layout

- `apps/mac` — macOS app, CLI, Tuist project, resources, and the Ghostty dependency
- `apps/supaterm.com` — Marketing website (Vite+, Cloudflare Workers)
- `apps/docs.supaterm.com` — Documentation website (Blume, Cloudflare Workers)
- `integrations/supaterm-skills` — User-facing skill submodule for Supaterm integrations and agent workflows

## Documentation

- `./docs/development.md` - general development doc
- `./docs/theming.md` - how Supaterm default chrome styling works
- `./docs/coding-agents-integration.md` - how coding agents integration features work
- `./docs/how-socket-works.md` - how the `sp` CLI and the macOS app talk through socket IPC
- `integrations/supaterm-skills/skills/supaterm` - stable user-facing discovery skill
- `integrations/supaterm-skills/skill-data` - version-matched `sp` guides and command references
- Keep `integrations/supaterm-skills` in sync when CLI behavior or coding-agent integrations change; we maintain the user-facing `supaterm` skill there
- Read `apps/supaterm.com/AGENTS.md` before working in the marketing website
- Read `apps/docs.supaterm.com/AGENTS.md` before working in the documentation website and run its commands through the root `make docs-*` targets

## Terminology

- Spaces are the top-level container in a window
- Tabs belong to spaces and can be pinned
- Panes belong to tabs, and a tab can have multiple panes

## Tools

- Error reporting uses PostHog

## Agent skills

### Issue tracker

Issues live in the Supaterm Linear workspace (team `SUP`), driven by the `linear` CLI. Ask before filing. See `docs/agents/issue-tracker.md`.

### Triage labels

The five canonical triage roles, label strings unchanged. See `docs/agents/triage-labels.md`.

### Domain docs

Single-context. The glossary is `## Terminology` above, plus a gitignored root `CONTEXT.md`. See `docs/agents/domain.md`.
