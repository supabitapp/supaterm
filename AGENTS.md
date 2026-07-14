## Layout

- `apps/mac` — macOS app, CLI, Tuist project, resources, and the Ghostty dependency
- `apps/supaterm.com` — Marketing website (Vite+, Cloudflare Workers)
- `integrations/supaterm-skills` — User-facing skill submodule for Supaterm integrations and agent workflows

## Documentation

- `./docs/development.md` - general development doc
- `./docs/theming.md` - how Supaterm default chrome styling works
- `./docs/coding-agents-integration.md` - how coding agents integration features work
- `./docs/how-socket-works.md` - how the `sp` CLI and the macOS app talk through socket IPC
- `integrations/supaterm-skills/skills/supaterm` - stable user-facing discovery skill
- `integrations/supaterm-skills/skill-data` - version-matched `sp` guides and command references
- Keep `integrations/supaterm-skills` in sync when CLI behavior or coding-agent integrations change; we maintain the user-facing `supaterm` skill there
- Read `apps/supaterm.com/AGENTS.md` before working in the web app

## Terminology

- Spaces are the top-level container in a window
- Tabs belong to spaces and can be pinned
- Panes belong to tabs, and a tab can have multiple panes

## Tools

- Issues are tracked on: https://linear.app/supaterm
- Error reporting uses PostHog
