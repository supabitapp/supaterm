# Theming

All chrome colors live in `TerminalPalette` (`apps/mac/supaterm/Features/Terminal/Views/TerminalChromeView.swift`), constructed per color scheme. Views never hardcode chrome colors; they read palette tokens.

## One stored color

The palette stores a single theme color:

```swift
static let primary = Color(.displayP3, red: 0.89, green: 0.902, blue: 0.925)
```

Everything else is computed from `primary`, the color scheme, and white/black overlays. Do not add stored per-state colors.

## Derivation rules

- **Window tint** — `primary.mix(with: .black, by: isDark ? 0.8 : 0).opacity(0.3)`, painted over a blur material. Light mode shows `primary` directly; dark mode shows it mixed toward black so the chrome reads as a tinted dark, not a washed-out pastel.
- **Interactive states are translucent overlays**, never opaque colors, so they work over any tint:
  - unselected row: `.clear` (cards/badges use `unselectedFill` = white/black 6%)
  - hover: white 55% (light) / 16% (dark)
  - pressed: white 70% (light) / 31% (dark)
- **Selection inverts within the scheme**: the selected pill is solid white in light mode, near-black (`Color(white: 0.04)`) in dark mode, with `selectedText` flipping to match. `selectedSecondaryText`, `selectedPillFill`, and `selectedPillStroke` derive from `selectedText`, so they follow automatically.
- **Selected pill edge** (dark mode is where it matters):
  - rim: 1pt `strokeBorder` with a diagonal gradient bright at the top-left and bottom-right corners (`selectedStrokeBright` white 35% → `selectedStrokeDim` white 8%), reading as a specular ring
  - glow: centered `.shadow` (`selectedShadow` white 15%, radius 5, no offset) — uniform on all sides, distinct from `shadow`, which is the black drop shadow for panels and panes
- Text: `primaryText`/`secondaryText` are white/black at fixed opacities; they serve the whole chrome (dialogs, agent panel), not just the sidebar.

## Clipping caveat

The selected pill's glow extends ~5pt beyond the row. The tab list keeps its 8pt horizontal inset *inside* the `ScrollView` content (not on the outer container) so the scroll clip bounds leave room for the halo. Keep any future inset changes inside the clip.

## Inspiration

The recipe follows Dia's sidebar: one theme color per surface, every interactive state a white/black-at-alpha overlay on top, selection as a scheme-matched solid pill with a specular rim. Dia ships 8 curated themes, each a Primary/Secondary/Tertiary/Vibrant set per appearance. Their Primaries (light / dark, Display P3):

| Theme | Light | Dark |
|---|---|---|
| Isabelline (default) | `#E3E6EC` | `#9AA2AF` |
| Bittersweet Shimmer | `#C1575C` | `#CC4A55` |
| Burnt Sienna | `#D87249` | `#C95125` |
| Hunyadi Yellow | `#E3AC38` | `#C98400` |
| Mint | `#3EB489` | `#008B5D` |
| Puce | `#D37B8B` | `#BD556B` |
| Steel Blue | `#3A88C4` | `#007FBD` |
| Ultra Violet | `#5F5B9E` | `#625DA5` |

Our `primary` is Isabelline's light value. If spaces ever get per-space colors, this is the shape to copy: a small named set with light/dark variants, not a free color picker.

## Verifying changes

Palette changes churn snapshot baselines by design:

```
make mac-build-snapshot-catalog   # eyeball fixtures (Sidebar → Full sidebar chrome)
make mac-record-snapshots         # re-record baselines, commit them with the change
make mac-test-snapshots
```
