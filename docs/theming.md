# Chrome Styling

Supaterm chrome has one default look. `SupaTheme` owns the reference tri-tones, semantic roles, and surface tokens. The mac app keeps window background rendering, blurred card styling, selectable row style, and grain texture in `apps/mac/supaterm/Features/Chrome`.

## Consumption

- Views take an explicit `let palette: Palette` and read semantic chrome tokens.
- `TerminalView` builds `Palette(colorScheme:)` from the resolved chrome color scheme.
- Reference colors are stored once in `apps/mac/SupaTheme`; each tint selects one four-tone family and maps its tones directly to accent, warning, success, danger, merged, and queued roles.
- `ChromeBackgroundView` renders a behind-window material, six-stop color ramp, and deterministic grain. One AppKit view hosts the material, one gradient layer, and the grain pattern, so the window server composites the chrome without a full-window buffer in the app.
- Neutral light chrome uses the six authored reference stops. Neutral dark chrome uses the dark window overlay. Chromatic chrome follows the selected family through the six gradient stops. The same stops feed the renderer and the palette API.
- Sidebar tabs use fixed rest, hover, pressed, secondary selection, outline, shadow, and title tokens. The primary selection uses the inverse surface color, while the wash under the row remains visible in the surrounding chrome.
- Neutral tab groups stay clear until hover or drop targeting. Colored groups keep a light tint and strengthen during interaction. Visible group surfaces use a neutral one-pixel stroke.
- The agent panel uses the same window overlay surface token as the reference chrome.
- Spaces store identity, name, and a `ThemeTint`. A tint selects its reference tri-tone family for the window backgrounds, title, and semantic roles. Neutral uses the default authored chrome. The create and rename dialogs expose the swatch row; creation pre-selects a random chromatic tint, and `sp space color` sets it over the socket.
- A window paints the tint of the space it displays, and its title is that space's name. While a sidebar swipe is in flight each page renders in its own space's palette through `palette.tinted(_:)`, and the window chrome holds the outgoing tint; `ChromeBackgroundView` crossfades to the new tint once the switch commits.

## Boundaries

Deliberately outside the palette: Ghostty terminal content colors, the Ghostty terminal progress bar, the window traffic lights, and Settings feature form styling.

## Snapshots

Default chrome changes can refresh snapshot baselines with `make mac-record-snapshots`. The Chrome catalog group renders the window background, six gradient stops, and palette token sheet for review.
