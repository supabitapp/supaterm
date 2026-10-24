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
    readonly prefersReducedMotion: Effect.Effect<boolean>;
    readonly setSource: (theme: DesktopTheme) => Effect.Effect<void, ElectronThemeSetSourceError>;
    readonly onUpdated: (listener: () => void) => Effect.Effect<void, never, Scope.Scope>;
  }
>()("@supaterm/desktop/electron/ElectronTheme") {}

/** @public Service construction is part of the canonical Effect module API. */
export const make = ElectronTheme.of({
  shouldUseDarkColors: Effect.sync(() => Electron.nativeTheme.shouldUseDarkColors),
  iconAppearance: Effect.sync(() =>
    Electron.systemPreferences.getUserDefault("AppleIconAppearanceTheme", "string"),
  ),
  prefersReducedMotion: Effect.sync(
    () => Electron.systemPreferences.getAnimationSettings().prefersReducedMotion,
  ),
  setSource: (theme) =>
    Effect.try({
      try: () => {
        Electron.nativeTheme.themeSource = theme;
      },
      catch: (cause) => new ElectronThemeSetSourceError({ source: theme, cause }),
    }),
  onUpdated: (listener) =>
    Effect.acquireRelease(
      Effect.suspend(() => {
        Electron.nativeTheme.on("updated", listener);
        return Effect.void;
      }),
      () =>
        Effect.suspend(() => {
          Electron.nativeTheme.removeListener("updated", listener);
          return Effect.void;
        }),
    ),
});

export const layer = Layer.succeed(ElectronTheme, make);
