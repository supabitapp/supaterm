# Brand icons

Edit `prod/app-icon.icon` in Icon Composer, then run `vp run icons:export` from the repository root. This is the only editable icon project. The export derives nightly (magenta) and development (cyan) projects by recolouring the bolt and phosphor glow, preserving the production housing, screen, controls, and appearance settings.

The same command regenerates every tracked icon: macOS, iOS, Android, Linux, Windows, web, marketing, and the icons embedded in installer and store artwork. Run `vp run icons:check` to detect stale outputs without modifying files. Do not edit generated projects or images directly.

Exporting requires macOS with Xcode 26 or newer and Icon Composer 2 or newer. The script selects the newest compatible Icon Composer exporter and pins design generation 26. Set `ICON_COMPOSER_TOOL` to the full path of `Icon Composer.app/Contents/Executables/ictool` to override discovery. Native macOS rendering uses the selected Xcode's `actool` through `xcrun`.

## Platform appearances

macOS release packaging and the local desktop launcher compile the generated Icon Composer project into `Assets.car` and declare `CFBundleIconName`, so macOS can select native light, dark, and tinted appearances. The compiled `.icns` provides the fallback for older macOS versions. The export command also uses `actool` to render the static macOS PNGs with the native safe area and shadow.

iOS uses the generated layered projects for native appearances. Other surfaces use static default renditions.

Android uses the CRT glass and coloured bolt, with the housing and controls removed. The generator crops the screen texture and centres the glow and bolt inside the launcher and splash masks. The texture fills the canvas; the bolt stays inside the 66dp safe circle on the 108dp adaptive canvas and the central 192dp circle on the 288dp splash canvas. Legacy launcher icons and Android in-app branding use the visible crop of the same composition.
