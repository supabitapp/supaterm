# Theming

Chrome theming lives in the `SupaTheme` package (`packages/SupaTheme`) — themes, the derived semantic palette, the window background, and the swatch picker. The recipe and token vocabulary are documented in `packages/SupaTheme/README.md`. This doc covers only how Supaterm consumes it.

## Consumption

- Views take an explicit `let palette: Palette` and read tokens; the palette is constructed from the selected theme and chrome color scheme in `TerminalView` and `QuitConfirmationPresenter`.
- The theme is a user setting: `appearance.theme` in `settings.toml` (`SupatermSettings.themeID`), picked in Settings > General via `ThemeSwatchPicker`.
- The window background renders `ThemeBackgroundView` over the behind-window blur.

## Exceptions

Deliberately outside the palette: the Ghostty terminal progress bar (terminal content semantics), the window traffic lights (macOS-native colors), and the Settings feature's native macOS form styling.

## Snapshots

Theme changes can refresh snapshot baselines with `make mac-record-snapshots`. The Theme Backgrounds and Theme Kit catalog groups render every theme's gradient and every palette token for review.

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

Our curated set uses these primaries (Isabelline keeps its light value for both appearances). If spaces ever get per-space colors, this is the shape to copy: a small named set with light/dark variants, not a free color picker.
