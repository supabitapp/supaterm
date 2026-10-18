# Brand icons

The three shared Icon Composer projects are the source of truth for exported application icons:

- `dev/app-icon.icon`
- `nightly/app-icon.icon`
- `prod/app-icon.icon`

Each project keeps the housing, screen, controls, phosphor glow, and glass lightning bolt as separate layers. Production preserves the supplied Icon Composer project. Nightly and dev reuse its layers with the bolt and glow recoloured magenta and cyan, so the builds stay distinguishable in the Dock. After changing the production project, run `vp run icons:variants` to regenerate them before exporting. Add `--check` to verify the variants without changing files.

In-app branding uses the exported application icon.

These copies are made by hand from the exports and are not covered by `icons:check`: the marketing site's favicons (16/32/48px ICO and a palette PNG touch icon, kept small) and `src/assets/icon*.webp` (from the macOS exports), and the icons embedded in the DMG backgrounds and `apps/mobile/fastlane/feature-graphic.svg`.

Run `vp run icons:export` from the repository root to regenerate the tracked iOS, Linux, Windows, and web assets. The development web exports are also copied to `apps/web/public` for the browser favicon and splash screen. Run `vp run icons:check` to verify that the generated assets and public copies match their sources without changing files.

Exporting requires Icon Composer 2 or newer on macOS. The script selects the newest compatible exporter from Xcode or a standalone Icon Composer installation and pins design generation 26. Set `ICON_COMPOSER_TOOL` to the full path of `Icon Composer.app/Contents/Executables/ictool` to override automatic discovery.

## macOS exports

macOS release packaging and the local desktop launcher compile the Icon Composer project with `actool`. Each app bundle includes `Assets.car` and declares `CFBundleIconName`, so macOS can select the native light, dark, and tinted appearances. The compiled `.icns` provides the fallback for older macOS versions. Building macOS release artifacts or using the local development launcher requires Xcode 26 or newer.

The static macOS PNGs are 1024×1024 with the classic macOS safe area: the opaque icon body is 824×824, inset 100 pixels on every side, with only the native shadow extending into the surrounding transparent canvas. macOS 26 and later re-mask this rendition to the system shape, but show a full-bleed icon inside a gray tile.

Since Icon Composer 27, both its command-line `macOS` export and the app's `macOS pre-Tahoe` preset are full bleed, so the export script leaves the tracked macOS PNGs unchanged and prints a reminder after every run. Render them with Xcode's asset compiler instead, which still builds the classic rendition. Run this from the repository root; `actool` needs an absolute input path, and `--standalone-icon-behavior all` is what adds the 1024px entry to the compiled `.icns`:

```bash
variant=nightly png=nightly-macos-1024.png
work=$(mktemp -d)
xcrun actool "$PWD/assets/$variant/app-icon.icon" --compile "$work" --platform macosx \
  --minimum-deployment-target 11.0 --app-icon app-icon --standalone-icon-behavior all \
  --output-partial-info-plist "$work/partial.plist"
iconutil -c iconset "$work/app-icon.icns" -o "$work/app-icon.iconset"
cp "$work/app-icon.iconset/icon_512x512@2x.png" "assets/$variant/$png"
```

The variants and their PNGs are:

- `dev` -> `blueprint-macos-1024.png`
- `nightly` -> `nightly-macos-1024.png`
- `prod` -> `black-macos-1024.png`

Do not resize, composite, or otherwise post-process the rendered PNG, and do not edit the generated PNG or ICO files directly.

## Android launcher and splash artwork

Android masks the central 72dp of a 108dp adaptive canvas, and the Android 12+ splash screen masks
the central two thirds of a 288dp canvas, so the Icon Composer exports cannot be used directly:
their rounded-square silhouette would be framed a second time. `vp run icons:export:android`
composites each variant's source layers onto an unmasked 1024×1024 canvas instead:

- `apps/mobile/assets/android-icon-background-*.png`: the artwork fitted into the masked central two
  thirds, with the artwork's corner colour filling the parallax margin
- `apps/mobile/assets/android-icon-foreground.png`: a transparent layer, since the artwork already
  sits in the background
- `apps/mobile/assets/android-splash-icon-*.png`: the same composition at 288dp, so the splash mask
  frames the artwork like the launcher icon does

Rerun the export after changing the source layers.
