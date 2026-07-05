# SupaTheme

Supabit's chrome theming system: themes as data, one derived semantic palette, a gradient window background, and a curated swatch picker. macOS 26+, Swift 6.2, zero dependencies.

## Model

- `Theme` — id, name, and one primary `Color` per appearance. Themes store only what cannot be computed. Curated set: `isabelline` (default), `bittersweetShimmer`, `burntSienna`, `hunyadiYellow`, `mint`, `puce`, `steelBlue`, `ultraViolet`. Look up by id with `Theme.curated(id:)`; unknown ids fall back to the default.
- `Palette(theme:colorScheme:)` — every chrome token, derived. Views never hardcode chrome colors; they read palette tokens.
- `Tone` — content accent tones (`amber`, `coral`, `mint`, `sky`, `slate`, `violet`) with `palette.fill(for:)`.

## Derivation rules

- **Window tint** — `primary.mix(with: .black, by: isDark ? 0.8 : 0).opacity(0.3)`, painted over a blur material. Light mode shows the primary directly; dark mode mixes it toward black so the chrome reads as a tinted dark, not a washed-out pastel.
- **Interactive states are translucent overlays**, never opaque colors, so they work over any tint: rest `.clear` (cards and badges use `unselectedFill` = white/black 6%), hover white 55% light / 16% dark, pressed white 70% / 31%.
- **Selection inverts within the scheme**: `selectedFill` is solid white in light mode, near-black in dark mode, and `selectedText` flips to match. `selectedSecondaryText`, `selectedPillFill`, and `selectedPillStroke` derive from `selectedText`.
- **Selected pill edge** — for narrow pills only; wide surfaces skip it: a 1pt diagonal specular rim (`selectedStroke`) plus a centered glow (`selectedShadow`). `SelectableRowButtonStyle` packages the whole cascade; pass `showsSelectionEdge: false` on wide rows.
- **Foreground polarity follows seed brightness**, not the color scheme: `primaryText`, `secondaryText`, and `detailStroke` flip on the Rec. 601 luma of the post-mix chrome surface (threshold 0.55), so a bright yellow seed gets dark text even in light mode.
- **Surfaces**: blurred cards use `blurCard(_:cornerRadius:)` (tint over popover blur with a hairline); solid detail cards use `detailBackground` (primary mixed 85% toward the scheme pole); dialogs are selected surfaces (`selectedFill` card, `selectedPillFill` bezel and buttons, `selectedText` text) over `scrim`.
- **Content colors** mark meaning, never interaction states: `accent` (= `sky`), `attention`, `success`, `destructive`, and the tones.

## Background

`ThemeBackgroundView(palette:style:)` renders the window background layer:

- `.flat` — exactly the window tint color, for compositing over a blur material.
- `.gradient` — an opaque 3×3 mesh whose stops are computed from the primary (lifted toward white at the top-leading corner, deepened toward black at the bottom-trailing), finished with a deterministic seeded grain tile at low alpha. No stop values are stored; changing the theme primary restyles the gradient.

## Picker

`ThemeSwatchPicker(themes:selection:palette:)` — circular swatches split diagonally between the light and dark primaries, with a selection ring and hover state from the palette.

## Testing

`swift test` pins every token of the default theme against the reference derivation, the polarity rule, and grain determinism. Visual coverage lives in the consuming app's snapshot catalog.
