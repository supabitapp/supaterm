## Layout

- `apps/mac` — macOS app, CLI, Tuist project, resources, and the Ghostty dependency
- `apps/supaterm.com` — Marketing website (Vite+, Cloudflare Workers)
- `integrations/supaterm-skills` — User-facing skill submodule for Supaterm integrations and agent workflows

## Documentation

- `./docs/development.md` - general development doc
- `./docs/background-computer-use.md` - background computer-use architecture, dispatch, and focus behavior
- `./docs/coding-agents-integration.md` - how coding agents integration features work
- `./docs/how-socket-works.md` - how the sp cli and the macOS app talk through socket IPC
- Keep `integrations/supaterm-skills` in sync when CLI behavior or coding-agent integrations change; we maintain the user-facing `supaterm` skill there
- Read `apps/supaterm.com/AGENTS.md` before working in the web app

### Commands

```bash
make mac-build          # Debug build
SUPATERM_STATE_HOME="$(mktemp -d)" make mac-run  # this uses ephemeral storage to not interfer with user settings
make mac-test           # full test suite
```

Run a single test class or method:
```bash
xcodebuild test -workspace apps/mac/supaterm.xcworkspace -scheme supaterm -destination "platform=macOS" \
  -only-testing:supatermTests/AppFeatureTests \
  CODE_SIGNING_ALLOWED=NO CODE_SIGNING_REQUIRED=NO CODE_SIGN_IDENTITY="" -skipMacroValidation
```

### Website (`apps/supaterm.com`)

```bash
make web-install        # install dependencies (vp install)
make web-check          # format + lint + type check
make web-dev            # dev server
make web-test           # test suite
make web-build          # production build
```


## Miscs

- When logic changes in a Reducer, always add tests
- Only spawned a new worktree if the user asked for it, run make worktree-create WORKTREE="name-of-the-work-tree" to create it.

## Terminology

- Spaces are the top-level container in a window
- Tabs belong to spaces and can be pinned
- Panes belong to tabs, and a tab can have multiple panes

## Tools

- Issues are tracked on: https://linear.app/supaterm
- Sentry org `supabit`, project `supaterm`
