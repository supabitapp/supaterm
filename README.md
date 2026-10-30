# Supaterm

A command center for ur coding agents

## Desktop app

Download at https://supaterm.com

## iOS app

[Join the Supaterm beta on TestFlight](https://testflight.apple.com/join/VUJkRPwq).

## Command line

```
curl -fsSL https://supaterm.com/install.sh | sh
```

on Windows

```
irm https://supaterm.com/install.ps1 | iex
```

Then run `supaterm` to start the server and open the local web app. `supaterm service install` keeps it running in the background, `supaterm update` moves to a newer release

To try it once without installing, run npx supaterm@latest instead.

## Documentation

The [documentation index](./docs/README.md) for all pages.

- [Install and first run](./docs/user/install.md)
- [Permission modes](./docs/user/permission-modes.md)
- [Keyboard shortcuts](./docs/user/keybindings.md)
- [Project settings](./docs/user/project-settings.md)
- [Appearance preferences](./docs/user/appearance.md)
- [Remote access](./docs/user/remote-access.md)
- [Connect Claude Code, Codex, ChatGPT and other agents over MCP](./docs/user/outside-agents.md)
- [Keeping app and server in sync](./docs/user/updating.md)
- [Source control integrations](./docs/user/source-control.md)
- [Background service](./docs/user/background-service.md)

## Attribution

Supaterm is a fork of https://github.com/pingdotgg/t3code
