# Our Ghostty Fork

This document captures what the Ghostty fork is responsible for inside Supaterm.

## Purpose

Supaterm ships its own command wrappers in the app bundle under `Contents/Resources/bin`.

Those bundled commands must win inside Supaterm panes even when a user's shell rc files prepend their own command directories such as `~/.local/bin`.

The host app cannot solve that cleanly after the shell has already started. The correct seam is Ghostty's shell integration layer, because that layer runs after user shell startup files and already owns shell-specific PATH behavior.

We keep the fork generic. The fork does not know about `sp`, `claude`, or any other Supaterm-specific command names. It only provides a way for a host application to declare one preferred bin directory that should take precedence inside shell integration.

## Capability

Our fork adds one generic capability: a preferred shell-integration bin directory.

- `src/config/Config.zig` adds `shell-integration-preferred-bin-dir`.
- `src/config/CApi.zig`, `src/config/Wasm.zig`, and `include/ghostty.h` add `ghostty_config_load_string`.
- `src/Surface.zig` and `src/termio/Exec.zig` carry the preferred bin dir from config into the terminal exec environment as `GHOSTTY_PREFERRED_BIN_DIR`.
- `src/shell-integration/zsh/ghostty-integration`
- `src/shell-integration/bash/ghostty.bash`
- `src/shell-integration/fish/vendor_conf.d/ghostty-shell-integration.fish`
- `src/shell-integration/elvish/lib/ghostty-integration.elv`

All supported shell integrations now follow the same rule:

- if `GHOSTTY_PREFERRED_BIN_DIR` is present, remove duplicate occurrences from PATH and prepend that directory
- if the normal `path` feature is enabled, still append `GHOSTTY_BIN_DIR` when it differs from the preferred directory

That keeps the new behavior additive. The existing Ghostty `path` feature still means "make the Ghostty bin dir available". The fork adds a second host-controlled concept: "this one bin directory should win".

## How Supaterm Uses The Fork

Supaterm does not ask users to add new keys to their Ghostty config files.

Instead, the host app injects the config at runtime:

- `apps/mac/supaterm/App/GhosttyBootstrap.swift` computes the bundled command directory and emits a config snippet for `shell-integration-preferred-bin-dir`.
- `apps/mac/supaterm/Features/Terminal/Ghostty/GhosttyRuntime.swift` loads that snippet through `ghostty_config_load_string`.
- `apps/mac/supaterm/Features/Terminal/Ghostty/GhosttySurfaceView.swift` only injects pane context and the bundled CLI path. It no longer rewrites PATH.

Because the preferred directory is `Contents/Resources/bin`, Supaterm can keep its bundled command ownership narrow. The shell integration gives precedence to a directory that contains only commands Supaterm intends to own.

## What We Removed From Supaterm

This fork exists so the host app can stay simpler.

Supaterm no longer needs:

- shell-specific wrapper functions for command names
- pane-level PATH mutation
- compatibility branches for old bundled command locations

The host now declares one preferred directory and lets Ghostty's shell integration enforce it consistently.

## Maintenance Rules

- Keep the fork generic. Do not add behavior that names Supaterm commands.
- Keep the delta confined to config loading, exec plumbing, and shell integration unless there is a stronger reason.
- Prefer host-owned runtime config overrides over asking users to edit Ghostty config.
- If upstream Ghostty grows an equivalent generic capability, drop this delta and converge back to upstream behavior.
