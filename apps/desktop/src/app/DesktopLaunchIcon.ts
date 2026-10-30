import * as Clock from "effect/Clock";
import * as Context from "effect/Context";
import * as Deferred from "effect/Deferred";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";
import * as Option from "effect/Option";
import * as Scope from "effect/Scope";

import * as Electron from "electron";

import * as ElectronApp from "../electron/ElectronApp.ts";
import * as ElectronTheme from "../electron/ElectronTheme.ts";
import { loadMacApplicationIcon } from "../electron/MacApplicationIcon.ts";
import * as DesktopAssets from "./DesktopAssets.ts";
import * as DesktopEnvironment from "./DesktopEnvironment.ts";
import { makeLaunchIconFrames, type LaunchIconFrames } from "./LaunchIconFrames.ts";

const FRAME_MILLIS = 66;
const FADE_SECONDS = 0.6;
// A quick launch still shows the rainbow run its whole course down the bolt.
const MIN_THINKING_SECONDS = 2.4;
// A launch that never shows a window stops animating rather than repaint the Dock for good.
const MAX_THINKING_SECONDS = 60;

export class DesktopLaunchIcon extends Context.Service<
  DesktopLaunchIcon,
  {
    /** Show the bolt thinking in the Dock, from the end of the launch bounce until `settle`. */
    readonly start: Effect.Effect<void, never, Scope.Scope>;
    /** Light the bolt back up and hand the Dock the bundle's icon. */
    readonly settle: Effect.Effect<void>;
  }
>()("@supaterm/desktop/app/DesktopLaunchIcon") {}

const ease = (x: number) => {
  const t = Math.min(1, Math.max(0, x));
  return t * t * (3 - 2 * t);
};

/**
 * The appearance the Dock draws the bundle's icon in under this Icon & widget
 * style, when frames exist for it. Default icons stay light in dark mode; only
 * the automatic Dark style follows it. Clear and tinted icons have no frames:
 * the Dock would jump between looks when it takes the bundle's icon back.
 */
const dockAppearanceFor = (
  iconStyle: string,
  systemDarkMode: boolean,
): Option.Option<DesktopAssets.IconAppearance> => {
  switch (iconStyle) {
    case "":
    case "RegularLight":
      return Option.some("light");
    case "RegularAutomatic":
      return Option.some(systemDarkMode ? "dark" : "light");
    case "RegularDark":
      return Option.some("dark");
    default:
      return Option.none();
  }
};

/** @public Service construction is part of the canonical Effect module API. */
export const make = Effect.gen(function* () {
  const environment = yield* DesktopEnvironment.DesktopEnvironment;
  const assets = yield* DesktopAssets.DesktopAssets;
  const electronApp = yield* ElectronApp.ElectronApp;
  const electronTheme = yield* ElectronTheme.ElectronTheme;
  const settleRequested = yield* Deferred.make<void>();

  const dockAppearance = Effect.gen(function* () {
    if (environment.platform !== "darwin" || (yield* electronTheme.prefersReducedMotion)) {
      return Option.none<DesktopAssets.IconAppearance>();
    }
    return dockAppearanceFor(
      yield* electronTheme.iconAppearance,
      yield* electronTheme.systemDarkMode,
    );
  });

  const animate = Effect.fnUntraced(function* (
    renditions: ReadonlyArray<{
      readonly size: number;
      readonly scaleFactor: number;
      readonly frames: LaunchIconFrames;
    }>,
  ) {
    const startedAt = yield* Clock.currentTimeMillis;
    const elapsed = Clock.currentTimeMillis.pipe(Effect.map((now) => (now - startedAt) / 1000));
    const show = (t: number, glow: number) => {
      const image = Electron.nativeImage.createEmpty();
      for (const { size, scaleFactor, frames } of renditions) {
        image.addRepresentation({
          width: size,
          height: size,
          scaleFactor,
          buffer: frames.render(t, glow),
        });
      }
      return electronApp.setDockIcon(image).pipe(Effect.andThen(Effect.sleep(FRAME_MILLIS)));
    };

    const thinking = (seconds: number) =>
      Deferred.isDone(settleRequested).pipe(
        Effect.map(
          (settled) =>
            seconds < MAX_THINKING_SECONDS && (!settled || seconds < MIN_THINKING_SECONDS),
        ),
      );

    // Ease out of the lit icon the Dock bounced with...
    let t = 0;
    let glow = 1;
    while (yield* thinking(t)) {
      glow = 1 - ease(t / FADE_SECONDS);
      yield* show(t, glow);
      t = yield* elapsed;
    }
    // ...and back into it once the window shows.
    const settledAt = t;
    const settledFrom = glow;
    while (t - settledAt < FADE_SECONDS) {
      yield* show(t, settledFrom + (1 - settledFrom) * ease((t - settledAt) / FADE_SECONDS));
      t = yield* elapsed;
    }
  });

  // Forked so decoding the icons overlaps the backend's boot instead of delaying it.
  const start = Effect.gen(function* () {
    const appearance = yield* dockAppearance;
    if (Option.isNone(appearance)) return;
    const paths = yield* assets.launchIconPaths(appearance.value);
    if (Option.isNone(paths)) return;
    const lit = Electron.nativeImage.createFromPath(paths.value.lit);
    const unlit = Electron.nativeImage.createFromPath(paths.value.unlit);
    if (lit.isEmpty() || unlit.isEmpty()) return;
    const icon = yield* Effect.tryPromise(loadMacApplicationIcon).pipe(
      Effect.tapError((error) =>
        Effect.logWarning("Native Dock icon is unavailable", { cause: error.cause }),
      ),
      Effect.option,
    );
    if (Option.isNone(icon)) return;
    const renditions = icon.value.map(({ size, scaleFactor, bitmap }) => ({
      size,
      scaleFactor,
      frames: makeLaunchIconFrames(
        lit.resize({ width: size, height: size, quality: "best" }).toBitmap(),
        unlit.resize({ width: size, height: size, quality: "best" }).toBitmap(),
        size,
        bitmap,
      ),
    }));
    yield* animate(renditions).pipe(Effect.ensuring(electronApp.setDockIcon(null)));
  }).pipe(
    Effect.catch((error) =>
      Effect.logWarning("Dock launch icon assets are unavailable", { message: error.message }),
    ),
    Effect.withSpan("desktop.launchIcon"),
    Effect.forkScoped,
    Effect.asVoid,
  );

  return DesktopLaunchIcon.of({
    start,
    settle: Deferred.succeed(settleRequested, undefined).pipe(Effect.asVoid),
  });
});

export const layer = Layer.effect(DesktopLaunchIcon, make);
