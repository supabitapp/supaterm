# SupaTheme

Supabit's chrome theming system: themes as data, one derived semantic palette, a gradient window background, and a curated swatch picker. macOS 26+, Swift 6.2, zero dependencies.

## Model

- `Theme` — id, name, a primary `Color` per appearance (the accent swatch), and a `Background` ramp (top and bottom stop) per appearance. Themes store only what cannot be computed. Curated set: `isabelline` (default), `bittersweetShimmer`, `burntSienna`, `hunyadiYellow`, `mint`, `puce`, `steelBlue`, `ultraViolet`. Look up by id with `Theme.curated(id:)`; unknown ids fall back to the default.
- `Palette(theme:colorScheme:)` — every chrome token, derived. Views never hardcode chrome colors; they read palette tokens.

## Derivation rules

- **Window tint** — `primary.mix(with: .black, by: isDark ? 0.8 : 0).opacity(0.3)`. Light mode shows the primary directly; dark mode mixes it toward black so cards read as tinted dark, not washed-out pastel.
- **Interactive states are translucent overlays**, never opaque colors, so they work over any tint: rest `.clear` (cards and badges use `unselectedFill` = white/black 6%), hover white 55% light / 16% dark, pressed white 70% / 31%.
- **Selection inverts within the scheme**: `selectedFill` is solid white in light mode, near-black in dark mode, and `selectedText` flips to match. `selectedSecondaryText`, `selectedPillFill`, and `selectedPillStroke` derive from `selectedText`.
- **Selected pill edge** — for narrow pills only; wide surfaces skip it: a 1pt diagonal specular rim (`selectedStroke`) plus a centered glow (`selectedShadow`). `SelectableRowButtonStyle` packages the whole cascade; pass `showsSelectionEdge: false` on wide rows.
- **Foreground follows the scheme**: dark text in light mode, light text in dark. The translucent window tint keeps every rendered surface on the scheme's side of neutral, so seed brightness never flips the text. If an opaque themed surface ever ships, recompute foreground polarity from that surface's luma — not from the raw seed.
- **Surfaces**: blurred cards use `blurCard(_:cornerRadius:)` (tint over popover blur with a hairline); solid detail cards use `detailBackground` (primary mixed 85% toward the scheme pole); dialogs are selected surfaces (`selectedFill` card, `selectedPillFill` bezel and buttons, `selectedText` text) over `scrim`.
- **Content colors** mark meaning, never interaction states: `accent` (= `sky`), `attention`, `success`, `destructive`, and fixed accent colors (`amber`, `mint`, `sky`, `coral`, `violet`, `slate`).

## Background

`ThemeBackgroundView(palette:)` renders an opaque vertical ramp between the theme's `Background` stops, completing at 75% of the height, interpolated perceptually, finished with a deterministic low-alpha grain tile. The stops are design values on each `Theme`, not derived from the primary — a single formula can't reproduce the per-theme desaturation the ramps carry.

## Picker

`ThemeSwatchPicker(themes:selection:palette:)` — circular swatches split diagonally between the light and dark primaries, with a selection ring and hover state from the palette.

## Testing

`swift test` pins every palette token against its expected value, the scheme-driven foreground for every theme, and grain determinism. Visual coverage lives in the consuming app's snapshot catalog.
