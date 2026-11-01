import { DesktopThemeSchema, type DesktopTheme } from "@supaterm/contracts";
import * as Context from "effect/Context";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";
import * as Schema from "effect/Schema";
import * as Scope from "effect/Scope";

import * as Electron from "electron";

export class ElectronThemeSetSourceError extends Schema.TaggedError<ElectronThemeSetSourceError>()(
  "ElectronThemeSetSourceError",
  {
    source: DesktopThemeSchema,
    cause: Schema.Defect(),
  },
) {
  override get message(): string {
    return `Failed to set the Electron theme source to ${this.source}.`;
  }
}

export class ElectronTheme extends Context.Service<
  ElectronTheme,
  {
    readonly shouldUseDarkColors: Effect.Effect<boolean>;
    /** The macOS Icon & widget style; empty for Default. */
    readonly iconAppearance: Effect.Effect<string>;
    /** Whether macOS itself is in dark mode, whatever theme this app picked. */
    readonly systemDarkMode: Effect.Effect<boolean>;
    readonly prefersReducedMotion: Effect.Effect<boolean>;
    readonly setSource: (theme: DesktopTheme) => Effect.Effect<void, ElectronThemeSetSourceError>;
    readonly onUpdated: (listener: () => void) => Effect.Effect<void, never, Scope.Scope>;
  }
>()("@supaterm/desktop/electron/ElectronTheme") {}

/** @public */
export const make = ElectronTheme.of({
  shouldUseDarkColors: Effect.sync(() => Electron.nativeTheme.shouldUseDarkColors),
  iconAppearance: Effect.sync(() =>
    Electron.systemPreferences.getUserDefault("AppleIconAppearanceTheme", "string"),
  ),
  systemDarkMode: Effect.sync(
    () => Electron.systemPreferences.getUserDefault("AppleInterfaceStyle", "string") === "Dark",
  ),
  prefersReducedMotion: Effect.sync(
    () => Electron.systemPreferences.getAnimationSettings().prefersReducedMotion,
  ),
  setSource: Effect.fn("ElectronTheme.setSource")(function (theme) {
    return Effect.try({
      try: () => {
        Electron.nativeTheme.themeSource = theme;
      },
      catch: (cause) => new ElectronThemeSetSourceError({ source: theme, cause }),
    });
  }),
  onUpdated: Effect.fn("ElectronTheme.onUpdated")(function (listener) {
    return Effect.acquireRelease(
      Effect.suspend(() => {
        Electron.nativeTheme.on("updated", listener);
        return Effect.void;
      }),
      () =>
        Effect.suspend(() => {
          Electron.nativeTheme.removeListener("updated", listener);
          return Effect.void;
        }),
    );
  }),
});

export const layer = Layer.succeed(ElectronTheme, make);
