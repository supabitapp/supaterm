# Bottom Bar

Supaterm reads the terminal bottom bar from `~/.config/supaterm/settings.toml`.

The default layout is:

```toml
[bottom_bar]
enabled = true
left = ["agent"]
center = []
right = []
```

Available modules:

```text
directory
git_branch
git_status
pane_title
agent
exit_status
command_duration
time
```

The bar is global for the selected tab. In a split tab, Supaterm shows one bottom bar and refreshes it from the focused pane.

Refresh behavior is event-driven. Focus, working directory, title, command completion, agent state, and valid settings changes refresh immediately. Git probes are debounced by about 200 ms and cached briefly. The `time` module ticks once per minute only when configured.

Run `sp config validate` after editing `settings.toml`. Unknown keys warn; unknown module names make the config invalid.
