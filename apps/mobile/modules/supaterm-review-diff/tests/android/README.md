# Android native regressions

From the repository root:

```sh
apps/mobile/modules/supaterm-review-diff/tests/run-android.sh
```

Requires JDK 17+ (`JAVA_HOME`) and Gradle on `PATH`. Tested with JDK 17 and
Gradle 9.4.1. To use another installed Gradle or a wrapper, set
`GRADLE=/absolute/path/to/gradle` before the command. The runner resolves its own
location, so it also works from other directories. Gradle test options are
forwarded, for example `--tests '*ReviewDiffViewportTest' --rerun-tasks`.

This standalone JVM build registers the viewport and geometry regressions and the
module's existing `android/src/test` layout suite with Gradle's `test` task. It
compiles the module's actual Android view, drawing, and layout sources. Pinned Maven dependencies supply Kotlin, Robolectric, Android API 35,
and AndroidX test classes. The first run requires access to Maven Central and
Google Maven, including Robolectric's runtime SDK download. No local Android
SDK, Expo prebuild, device, temporary checkout, or pre-extracted jars are needed.
Generated files stay in ignored `build/` and `.gradle/` directories; the HTML
report is `build/reports/tests/test/index.html`.

The files under `stubs/expo/modules/kotlin/` replace Expo's context, view base class, and event dispatcher.
Events go to a per-test context instead of a React Native bridge.
The `ReactFontManager` stub supplies Android's monospace typeface in place of bundled font assets.
This checks reset/decode ordering, stale-row removal, and viewport publication
in the real view, but does not validate Expo registration, JS event delivery,
native libraries, bundled font loading, or device rendering. These stubs are exclusive to this
standalone build and must not be added to the production Android source set.
Geometry regressions bound sticky-header row reads, check lazy ASCII layout
retention and syntax invalidation, and compare ASCII widths against Android
paint metrics. Native shaping tests cover tabs, Unicode clusters, and styled
word-diff spans.
