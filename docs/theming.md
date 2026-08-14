# Chrome Styling

Supaterm chrome has one default look. `SupaTheme` owns the palette reference anchors, color math, and computed semantic tokens. The mac app keeps window background rendering, blurred card styling, selectable row style, and grain texture in `apps/mac/supaterm/Features/Chrome`.

## Consumption

- Views take an explicit `let palette: Palette` and read semantic chrome tokens.
- `TerminalHostState` builds one palette from the focused pane's configured background. The runtime config supplies the background before a surface exists.
- Explicit light or dark appearance sets the palette scheme. Auto appearance derives it from the configured background.
- Reference colors are stored once in `apps/mac/SupaTheme`; role colors such as accent, warning, success, danger, and merged are computed from those anchors against the chrome surfaces where they render.
- `ChromeBackgroundView` renders a behind-window material, translucent tint ramp, light-mode illumination, and deterministic grain. One AppKit view hosts the material, two gradient layers with precomputed perceptual stops, and a pattern layer for the grain tile, so the window server composites the chrome without full-window buffers in the app.
- The terminal background seeds the tint ramp from `backgroundTopValue` to `backgroundBottomValue`. Palette math caps chroma and lightness before it mixes the seed into the chrome. Light mode keeps more color at the top than the bottom. The illumination layer stays low through the body and lifts over the last eight percent.
- Sidebar tabs use fixed rest, hover, pressed, secondary selection, outline, shadow, and title tokens; unrelated cards and dialogs keep their own surface roles. The primary selection is opaque in dark mode and translucent white in light mode, so the wash under the row tints the selected pill.
- Neutral tab groups stay clear until hover or drop targeting. Colored groups keep a light tint and strengthen during interaction. Visible group surfaces use a neutral one-pixel stroke.
- The agent panel uses an opaque floating surface token so terminal content underneath cannot change its color.
- Spaces store identity, name, and a `ThemeTint`. A chromatic tint sets the space title, accent, and group identity. The terminal theme owns the large chrome surfaces. The create and rename dialogs expose the swatch row; creation pre-selects a random chromatic tint, and `sp space color` sets it over the socket.
- While a sidebar swipe is in flight each page renders in its own space palette through `palette.tinted(_:)`. A configured terminal background change crossfades within the same color scheme. Light and dark scheme changes apply at once. Reduce Motion disables the crossfade.

## Boundaries

Terminal foreground, ANSI colors, OSC color changes, opacity, the terminal progress bar, window traffic lights, and Settings form styling stay outside the palette. OSC background changes and opacity affect terminal content and its top bar, not the shell chrome.

## Snapshots

Default chrome changes can refresh snapshot baselines with `make mac-record-snapshots`. The Chrome catalog group renders the window background, palette token sheet, and a common terminal theme matrix for review.
