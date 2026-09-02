## Layout

- `apps/mac` — macOS app, CLI, Tuist project, resources, and the Ghostty dependency
- `apps/ios` — iOS app and Tuist project
- `apps/shared` — code and resources shared by the macOS and iOS projects
- `apps/Tuist` — shared Apple-platform package dependencies and lockfile
- `apps/supaterm.com` — Marketing website (Vite+, Cloudflare Workers)
- `apps/docs.supaterm.com` — Documentation website (Blume, Cloudflare Workers)
- `integrations/supaterm` — User-facing skills and version-matched agent guides

## Documentation

- `./docs/development.md` - general development doc
- `./docs/theming.md` - how Supaterm default chrome styling works
- `./docs/coding-agents-integration.md` - how coding agents integration features work
- `./docs/how-socket-works.md` - how the `sp` CLI and the macOS app talk through socket IPC
- `integrations/supaterm/skills/supaterm` - stable user-facing discovery skill
- `integrations/supaterm/skill-data` - version-matched `sp` guides and command references
- Keep `integrations/supaterm` in sync when CLI behavior or coding-agent integrations change; we maintain the user-facing `supaterm` skill there
- Read `apps/supaterm.com/AGENTS.md` before working in the marketing website
- Read `apps/docs.supaterm.com/AGENTS.md` before working in the documentation website and run its commands through the root `make docs-*` targets

## Terminology

- Spaces are the top-level container. Every window shares them and displays one at a time
- Groups are ordered collections of tabs inside a space
- Tabs belong to one space and one window and can be pinned
- Panes belong to tabs, and a tab can have multiple panes

## Tools

- Issues and PRDs live in Linear, team `SUP`: https://linear.app/supaterm. Use the `linear` CLI.
- Error reporting uses PostHog
