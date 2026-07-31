# Chrome Styling

Supaterm chrome has one default look. `SupaTheme` owns the palette reference anchors, color math, and computed semantic tokens. The mac app keeps window background rendering, blurred card styling, selectable row style, and grain texture in `apps/mac/supaterm/Features/Chrome`.

## Consumption

- Views take an explicit `let palette: Palette` and read semantic chrome tokens.
- `TerminalView` builds `Palette(colorScheme:)` from the resolved chrome color scheme.
- Reference colors are stored once in `apps/mac/SupaTheme`; role colors such as accent, warning, success, danger, and merged are computed from those anchors against the chrome surfaces where they render.
- `ChromeBackgroundView` renders a behind-window material, translucent neutral ramp, light-mode illumination, and deterministic grain. One AppKit view hosts the material, two gradient layers with precomputed perceptual stops, and a pattern layer for the grain tile, so the window server composites the chrome without full-window buffers in the app.
- Sidebar tabs use a clear rest state and fixed hover, pressed, selected, outline, shadow, and title tokens; unrelated cards and dialogs keep their own surface roles.
- Neutral tab groups stay clear until hover or drop targeting. Colored groups keep a light tint and strengthen during interaction. Visible group surfaces use a neutral one-pixel stroke.
- The agent panel uses an opaque floating surface token so terminal content underneath cannot change its color.
- Spaces store identity, name, and a `ThemeTint`. A chromatic tint washes the window backgrounds toward its reference tone and reseeds accent from it; every derived semantic recomputes through the contrast pipeline. Neutral reproduces the default chrome exactly. The create and rename dialogs expose the swatch row; creation pre-selects a random chromatic tint, and `sp space color` sets it over the socket.

## Boundaries

Deliberately outside the palette: Ghostty terminal content colors, the Ghostty terminal progress bar, the window traffic lights, and Settings feature form styling.

## Snapshots

Default chrome changes can refresh snapshot baselines with `make mac-record-snapshots`. The Chrome catalog group renders the window background and palette token sheet for review.
