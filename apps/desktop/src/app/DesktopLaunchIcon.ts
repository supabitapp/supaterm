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
import * as DesktopAssets from "./DesktopAssets.ts";
import * as DesktopEnvironment from "./DesktopEnvironment.ts";
import { makeLaunchIconFrames, type LaunchIconFrames } from "./LaunchIconFrames.ts";

// The Dock's largest tile, 128pt at 2x.
const TILE_PIXELS = 256;
const FRAME_MILLIS = 66;
const FADE_SECONDS = 0.35;
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

const loadBitmap = (path: string) => {
  const image = Electron.nativeImage.createFromPath(path);
  return image.isEmpty()
    ? Option.none<Buffer>()
    : Option.some(
        image.resize({ width: TILE_PIXELS, height: TILE_PIXELS, quality: "best" }).toBitmap(),
      );
};

/** @public Service construction is part of the canonical Effect module API. */
export const make = Effect.gen(function* () {
  const environment = yield* DesktopEnvironment.DesktopEnvironment;
  const assets = yield* DesktopAssets.DesktopAssets;
  const electronApp = yield* ElectronApp.ElectronApp;
  const electronTheme = yield* ElectronTheme.ElectronTheme;
  const settleRequested = yield* Deferred.make<void>();

  // The frames are drawn from the Default appearance. Under any other icon style
  // the Dock would jump between looks when it takes the bundle's icon back.
  const enabled = Effect.gen(function* () {
    if (environment.platform !== "darwin") return false;
    if (yield* electronTheme.prefersReducedMotion) return false;
    const appearance = yield* electronTheme.iconAppearance;
    return appearance === "" || appearance === "RegularLight";
  });

  const loadFrames = Effect.gen(function* () {
    const { png, unlitPng } = yield* assets.iconPaths;
    if (Option.isNone(png) || Option.isNone(unlitPng)) return Option.none<LaunchIconFrames>();
    return yield* Effect.sync(() =>
      Option.zipWith(loadBitmap(png.value), loadBitmap(unlitPng.value), (lit, unlit) =>
        makeLaunchIconFrames(lit, unlit, TILE_PIXELS),
      ),
    );
  });

  const animate = Effect.fnUntraced(function* (frames: LaunchIconFrames) {
    const startedAt = yield* Clock.currentTimeMillis;
    const elapsed = Clock.currentTimeMillis.pipe(Effect.map((now) => (now - startedAt) / 1000));
    const show = (t: number, glow: number) =>
      electronApp
        .setDockIcon(
          Electron.nativeImage.createFromBitmap(frames.render(t, glow), {
            width: TILE_PIXELS,
            height: TILE_PIXELS,
            scaleFactor: 2,
          }),
        )
        .pipe(Effect.andThen(Effect.sleep(FRAME_MILLIS)));

    // Ease out of the lit icon the Dock bounced with...
    let t = 0;
    let glow = 1;
    while (!(yield* Deferred.isDone(settleRequested)) && t < MAX_THINKING_SECONDS) {
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
    if (!(yield* enabled)) return;
    const frames = yield* loadFrames;
    if (Option.isNone(frames)) return;
    yield* animate(frames.value).pipe(Effect.ensuring(electronApp.setDockIcon(null)));
  }).pipe(Effect.withSpan("desktop.launchIcon"), Effect.forkScoped, Effect.asVoid);

  return DesktopLaunchIcon.of({
    start,
    settle: Deferred.succeed(settleRequested, undefined).pipe(Effect.asVoid),
  });
});

export const layer = Layer.effect(DesktopLaunchIcon, make);
