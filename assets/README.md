# Brand icons

The app icon is the bolt computer from the marketing site's [studio](https://supaterm.com/studio), drawn head-on. Its shape, materials and lighting live in `apps/marketing/src/lib/boltComputer`, and each channel's phosphor colour is `ICON_PHOSPHORS` in `icon.ts`: yellow for Latest, magenta for Nightly and cyan for Development. Change the model there, then run `vp run icons:export` from the repository root.

The export draws the computer in headless Chromium as three Icon Composer layers per channel (housing, screen and bezel) and writes the `app-icon.icon` projects under `prod`, `nightly` and `dev`. The appearance settings in `prod/app-icon.icon/icon.json` are the only hand-edited part of the projects; edit them in Icon Composer and the export copies them to the other channels. Do not edit the rendered layers or any other generated image directly.

The same command regenerates every tracked icon: macOS, iOS, Android, Linux, Windows, web, marketing, and the icons embedded in installer and store artwork. Run `vp run icons:check` to detect stale outputs without modifying files.

The export also records a digest of its sources in `icon-inputs.sha256`: every file the icon module bundles, and `icon.json`. CI and `vp run check:changed` run `vp run icons:check-inputs`, which needs neither Xcode nor Chromium and fails when those sources have changed since the last export, so a studio change cannot leave the committed icons behind. Any edit to those files trips it, including comment-only edits; rerun the export and commit the result.

Exporting requires macOS with full Xcode 27 or newer and Icon Composer 2 or newer. The script selects the newest compatible Icon Composer exporter and pins design generation 26. Set `ICON_COMPOSER_TOOL` to the full path of `Icon Composer.app/Contents/Executables/ictool` to override discovery. Native macOS rendering uses the selected Xcode's `actool` through `xcrun`. The script installs Playwright's Chromium on first use.

## Platform appearances

macOS release packaging and the local desktop launcher compile the generated Icon Composer project into `Assets.car` and declare `CFBundleIconName`, so macOS can select native light, dark, and tinted appearances. The compiled `.icns` provides the fallback for older macOS versions. The export command also uses `actool` to render the static macOS PNGs with the native safe area and shadow.

iOS uses the generated layered projects for native appearances. Other surfaces use static default renditions.

Android uses the computer's screen alone: the LED matrix fills the canvas with the bolt lit in its middle, inside the 66dp safe circle on the 108dp adaptive canvas and the central 192dp circle on the 288dp splash canvas. Legacy launcher icons and Android in-app branding use the visible crop of the same image.
