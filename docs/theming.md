# Chrome Styling

Supaterm chrome has one default look. `SupaTheme` owns the palette reference anchors, color math, and computed semantic tokens. The mac app keeps window background rendering, blurred card styling, selectable row style, and grain texture in `apps/mac/supaterm/Features/Chrome`.

## Consumption

- Views take an explicit `let palette: Palette` and read semantic chrome tokens.
- `TerminalView` builds `Palette(colorScheme:)` from the resolved chrome color scheme.
- Reference colors are stored once in `apps/shared/SupaTheme`; role colors such as accent, warning, success, danger, and merged are computed from those anchors against the chrome surfaces where they render.
- `ChromeBackgroundView` renders a behind-window material, translucent tint ramp, light-mode illumination, and deterministic grain. One AppKit view hosts the material, two gradient layers with precomputed perceptual stops, and a pattern layer for the grain tile, so the window server composites the chrome without full-window buffers in the app.
- The tint ramp runs from `backgroundTopValue` to `backgroundBottomValue` and settles at three quarters of the height. In light mode the wash is strong at the top and weak at the bottom, so chroma fades downward; in dark mode both ends carry the same wash. The illumination layer stays low through the body and lifts to near white over the last eight percent, which reads as a footer glow.
- Sidebar tabs use fixed rest, hover, pressed, secondary selection, outline, shadow, and title tokens; unrelated cards and dialogs keep their own surface roles. The primary selection is opaque in dark mode and translucent white in light mode, so the wash under the row tints the selected pill.
- Neutral tab groups stay clear until hover or drop targeting. Colored groups keep a light tint and strengthen during interaction. Visible group surfaces use a neutral one-pixel stroke.
- The agent panel uses an opaque floating surface token so terminal content underneath cannot change its color.
- Spaces store identity, name, and a `ThemeTint`. A chromatic tint washes the window backgrounds toward its reference tone and reseeds accent from it; every derived semantic recomputes through the contrast pipeline. Neutral reproduces the default chrome exactly. The create and rename dialogs expose the swatch row; creation pre-selects a random chromatic tint, and `sp space color` sets it over the socket.
- A window paints the tint of the space it displays, and its title is that space's name. While a sidebar swipe is in flight each page renders in its own space's palette through `palette.tinted(_:)`, and the window chrome holds the outgoing tint; `ChromeBackgroundView` crossfades to the new tint once the switch commits.

## Boundaries

Deliberately outside the palette: Ghostty terminal content colors, the Ghostty terminal progress bar, the window traffic lights, and Settings feature form styling.

## Snapshots

Default chrome changes can refresh snapshot baselines with `make mac-record-snapshots`. The Chrome catalog group renders the window background and palette token sheet for review.
