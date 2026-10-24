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
  readonly prefersReducedMotion?: boolean;
}) =>
  Effect.gen(function* () {
    const dockIcons: Array<Electron.NativeImage | null> = [];
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
            iconPaths: Effect.succeed({
              ico: Option.none(),
              icns: Option.none(),
              png: Option.some("/resources/icon.png"),
              unlitPng: Option.some("/resources/icon-unlit.png"),
            }),
          }),
          Layer.mock(ElectronApp.ElectronApp)({
            setDockIcon: (image) => Effect.sync(() => void dockIcons.push(image)),
          }),
          Layer.mock(ElectronTheme.ElectronTheme)({
            iconAppearance: Effect.succeed(input.iconAppearance ?? ""),
            prefersReducedMotion: Effect.succeed(input.prefersReducedMotion ?? false),
          }),
        ),
      ),
    );
    const launchIcon = yield* DesktopLaunchIcon.DesktopLaunchIcon.pipe(Effect.provide(layer));
    yield* launchIcon.start;
    yield* TestClock.adjust(Duration.seconds(2));
    const thinking = dockIcons.length;
    yield* launchIcon.settle;
    yield* TestClock.adjust(Duration.seconds(2));
    const settled = dockIcons.length;
    yield* TestClock.adjust(Duration.seconds(2));
    return { thinking, settled, dockIcons };
  }).pipe(Effect.scoped);

describe("DesktopLaunchIcon", () => {
  it.effect("thinks until settled, then hands the Dock back the bundle's icon", () =>
    Effect.gen(function* () {
      const { thinking, settled, dockIcons } = yield* run({});

      assert.isAbove(thinking, 20);
      assert.isTrue(dockIcons.slice(0, thinking).every((image) => image !== null));
      assert.isNull(dockIcons.at(-1));
      assert.equal(dockIcons.length, settled);
    }),
  );

  it.effect("leaves the Dock alone when its icon would not match the frames", () =>
    Effect.gen(function* () {
      for (const input of [
        { iconAppearance: "RegularDark" },
        { iconAppearance: "TintedAutomatic" },
        { prefersReducedMotion: true },
        { platform: "win32" as const },
      ]) {
        const { dockIcons } = yield* run(input);
        assert.deepEqual(dockIcons, [], JSON.stringify(input));
      }
    }),
  );
});
