## Layout

- `apps/mac` — macOS app, CLI, Tuist project, resources, and the Ghostty dependency
- `apps/supaterm.com` — Marketing website (Vite+, Cloudflare Workers)
- `integrations/supaterm-skills` — User-facing skill submodule for Supaterm integrations and agent workflows

## Documentation

- `./docs/development.md` - general development doc
- `./docs/coding-agents-integration.md` - how coding agents integration features work
- `./docs/how-socket-works.md` - how the sp cli and the macOS app talk through socket IPC
- Keep `integrations/supaterm-skills` in sync when CLI behavior or coding-agent integrations change; we maintain the user-facing `supaterm` skill there
- Read `apps/supaterm.com/AGENTS.md` before working in the web app

### Commands

Canonical macOS gates:

```bash
make mac-check          # format + lint
make mac-test           # full test suite
```

Useful macOS development commands:

```bash
make mac-build          # Debug build
make mac-run            # Debug run with isolated ephemeral state
```

Run a single test class or method:
```bash
xcodebuild test -workspace apps/mac/supaterm.xcworkspace -scheme supaterm -destination "platform=macOS" \
  -only-testing:supatermTests/AppFeatureTests \
  CODE_SIGNING_ALLOWED=NO CODE_SIGNING_REQUIRED=NO CODE_SIGN_IDENTITY="" -skipMacroValidation
```

### Website (`apps/supaterm.com`)

Canonical website gates:

```bash
make web-check          # format + lint + type check
make web-test           # test suite
make web-build          # production build
```

Useful website development commands:

```bash
make web-install        # install dependencies (vp install)
make web-dev            # dev server
```


## Miscs

- When logic changes in a Reducer, always add tests
- Only spawned a new worktree if the user asked for it, run make worktree-create WORKTREE="name-of-the-work-tree" to create it.
- Lucide icons may be used in the macOS app; fetch them with `apps/mac/scripts/fetch-lucide-icon.sh <icon-name>`.

## Terminology

- Spaces are the top-level container in a window
- Tabs belong to spaces and can be pinned
- Panes belong to tabs, and a tab can have multiple panes

## Logging

- Supaterm app logs use subsystem `app.supabit.supaterm`
- Debug and release action logs both use OSLog when verbose logging is enabled
- Enable Settings > General > Enable Verbose Logging before reproducing debug/session issues
- Stream live logs:

```bash
/usr/bin/log stream --style compact --level debug --predicate 'subsystem == "app.supabit.supaterm"'
```

- Query recent logs:

```bash
/usr/bin/log show --last 30m --debug --style compact --predicate 'subsystem == "app.supabit.supaterm"'
```

- Query action logs:

```bash
/usr/bin/log show --last 30m --debug --style compact --predicate 'subsystem == "app.supabit.supaterm" && (category == "actions" || category == "terminal" || category == "settings" || category == "socket" || category == "update")'
```

- Query socket/update logs:

```bash
/usr/bin/log show --last 30m --debug --style compact --predicate 'subsystem == "app.supabit.supaterm" && (category == "socket" || category == "update")'
```

- Stream zmx/session diagnostics:

```bash
/usr/bin/log stream --style compact --level debug --predicate 'subsystem == "app.supabit.supaterm" && (category == "terminal" || category == "zmx")'
```

- Query persisted zmx/session diagnostics:

```bash
/usr/bin/log show --last 30m --debug --style compact --predicate 'subsystem == "app.supabit.supaterm" && (category == "terminal" || category == "zmx")'
```

- Sentry breadcrumbs are allowlisted release diagnostics only; local OSLog is the source of truth for action tracing

## Tools

- Issues are tracked on: https://linear.app/supaterm
- Sentry org `supabit`, project `supaterm`
