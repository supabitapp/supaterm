import * as NodePath from "@effect/platform-node/NodePath";
import * as NodeServices from "@effect/platform-node/NodeServices";
import { assert, describe, it } from "@effect/vitest";
import * as Duration from "effect/Duration";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";
import * as Option from "effect/Option";
import * as TestClock from "effect/testing/TestClock";
import type * as Electron from "electron";
import { vi } from "vite-plus/test";

import * as ElectronApp from "../electron/ElectronApp.ts";
import * as ElectronTheme from "../electron/ElectronTheme.ts";
import * as DesktopAssets from "./DesktopAssets.ts";
import * as DesktopConfig from "./DesktopConfig.ts";
import * as DesktopEnvironment from "./DesktopEnvironment.ts";
import * as DesktopLaunchIcon from "./DesktopLaunchIcon.ts";

vi.mock("electron", () => {
  const image = (fill: number) => ({
    isEmpty: () => false,
    resize: ({ width, height }: { width: number; height: number }) => ({
      toBitmap: () => Buffer.alloc(width * height * 4, fill),
    }),
  });
  return {
    nativeImage: {
      createFromPath: (path: string) => image(path.includes("unlit") ? 0 : 255),
      createFromBitmap: () => ({}),
    },
  };
});

const run = (input: {
  readonly platform?: NodeJS.Platform;
  readonly iconAppearance?: string;
  readonly systemDarkMode?: boolean;
  readonly prefersReducedMotion?: boolean;
  readonly windowShowsAfterSeconds?: number;
}) =>
  Effect.gen(function* () {
    const dockIcons: Array<Electron.NativeImage | null> = [];
    const appearances: Array<DesktopAssets.IconAppearance> = [];
    const layer = DesktopLaunchIcon.layer.pipe(
      Layer.provide(
        Layer.mergeAll(
          DesktopEnvironment.layer({
            dirname: "/Applications/Supaterm.app/Contents/Resources/app.asar/dist-electron",
            homeDirectory: "/Users/alice",
            platform: input.platform ?? "darwin",
            processArch: "arm64",
            appVersion: "1.2.3",
            appPath: "/Applications/Supaterm.app/Contents/Resources/app.asar",
            isPackaged: true,
            resourcesPath: "/Applications/Supaterm.app/Contents/Resources",
            runningUnderArm64Translation: false,
          }).pipe(
            Layer.provide(
              Layer.mergeAll(NodeServices.layer, NodePath.layerPosix, DesktopConfig.layerTest({})),
            ),
          ),
          Layer.mock(DesktopAssets.DesktopAssets)({
            launchIconPaths: (appearance) =>
              Effect.sync(() => {
                appearances.push(appearance);
                return Option.some({
                  lit: `/resources/icon-${appearance}.png`,
                  unlit: `/resources/icon-unlit-${appearance}.png`,
                });
              }),
          }),
          Layer.mock(ElectronApp.ElectronApp)({
            setDockIcon: (image) => Effect.sync(() => void dockIcons.push(image)),
          }),
          Layer.mock(ElectronTheme.ElectronTheme)({
            iconAppearance: Effect.succeed(input.iconAppearance ?? ""),
            systemDarkMode: Effect.succeed(input.systemDarkMode ?? false),
            prefersReducedMotion: Effect.succeed(input.prefersReducedMotion ?? false),
          }),
        ),
      ),
    );
    const launchIcon = yield* DesktopLaunchIcon.DesktopLaunchIcon.pipe(Effect.provide(layer));
    yield* launchIcon.start;
    yield* TestClock.adjust(Duration.seconds(input.windowShowsAfterSeconds ?? 2));
    yield* launchIcon.settle;
    const atWindow = dockIcons.length;
    yield* TestClock.adjust(Duration.seconds(1));
    const stillThinking = dockIcons.length > atWindow && dockIcons.at(-1) !== null;
    yield* TestClock.adjust(Duration.seconds(3));
    const settled = dockIcons.length;
    yield* TestClock.adjust(Duration.seconds(2));
    return { atWindow, stillThinking, settled, dockIcons, appearances };
  }).pipe(Effect.scoped);

describe("DesktopLaunchIcon", () => {
  it.effect("thinks until settled, then hands the Dock back the bundle's icon", () =>
    Effect.gen(function* () {
      const { atWindow, settled, dockIcons } = yield* run({ windowShowsAfterSeconds: 3 });

      assert.isAbove(atWindow, 30);
      assert.isTrue(dockIcons.slice(0, atWindow).every((image) => image !== null));
      assert.isNull(dockIcons.at(-1));
      assert.equal(dockIcons.length, settled);
    }),
  );

  it.effect("keeps thinking through a quick launch so the rainbow still shows", () =>
    Effect.gen(function* () {
      const { stillThinking, dockIcons } = yield* run({ windowShowsAfterSeconds: 0.5 });

      assert.isTrue(stillThinking);
      assert.isNull(dockIcons.at(-1));
    }),
  );

  it.effect("draws frames in the appearance the Dock is showing the icon in", () =>
    Effect.gen(function* () {
      const cases = [
        [{ iconAppearance: "", systemDarkMode: false }, "light"],
        [{ iconAppearance: "", systemDarkMode: true }, "light"],
        [{ iconAppearance: "RegularAutomatic", systemDarkMode: false }, "light"],
        [{ iconAppearance: "RegularAutomatic", systemDarkMode: true }, "dark"],
        [{ iconAppearance: "RegularDark", systemDarkMode: false }, "dark"],
      ] as const;
      for (const [input, appearance] of cases) {
        const { appearances } = yield* run(input);
        assert.deepEqual(appearances, [appearance], JSON.stringify(input));
      }
    }),
  );

  it.effect("leaves the Dock alone when its icon would not match the frames", () =>
    Effect.gen(function* () {
      for (const input of [
        { iconAppearance: "ClearDark" },
        { iconAppearance: "TintedAutomatic" },
        { prefersReducedMotion: true },
        { platform: "win32" as const },
      ]) {
        const { dockIcons } = yield* run(input);
        assert.deepEqual(dockIcons, [], JSON.stringify(input));
      }
    }),
  );

  it.effect("finds the Dock launch icons the brand export writes, for every brand", () =>
    Effect.gen(function* () {
      for (const VITE_DEV_SERVER_URL of ["http://localhost:5733", undefined]) {
        const layerSourceTree = DesktopAssets.layer.pipe(
          Layer.provideMerge(
            DesktopEnvironment.layer({
              dirname: `${import.meta.dirname}/../../dist-electron`,
              homeDirectory: "/Users/alice",
              platform: "darwin",
              processArch: "arm64",
              appVersion: "1.2.3",
              appPath: "/repo",
              isPackaged: false,
              resourcesPath: "/nonexistent/resources",
              runningUnderArm64Translation: false,
            }).pipe(
              Layer.provide(
                Layer.mergeAll(
                  NodePath.layerPosix,
                  DesktopConfig.layerTest(VITE_DEV_SERVER_URL ? { VITE_DEV_SERVER_URL } : {}),
                ),
              ),
            ),
          ),
          Layer.provideMerge(NodeServices.layer),
        );
        const assets = yield* DesktopAssets.DesktopAssets.pipe(Effect.provide(layerSourceTree));
        for (const appearance of ["light", "dark"] as const) {
          const paths = yield* assets.launchIconPaths(appearance);
          assert.isTrue(Option.isSome(paths), `${appearance}, dev server ${VITE_DEV_SERVER_URL}`);
        }
      }
    }),
  );
});
