#!/usr/bin/env node
/**
 * "Install Supaterm" is a small universal app shipped on its own disk image. It
 * downloads the latest stable build for the Mac it runs on, so the website can
 * offer one macOS download instead of asking people to pick a chip.
 */
import * as NodeRuntime from "@effect/platform-node/NodeRuntime";
import * as NodeServices from "@effect/platform-node/NodeServices";
import * as Effect from "effect/Effect";
import * as FileSystem from "effect/FileSystem";
import * as Layer from "effect/Layer";
import * as Logger from "effect/Logger";
import * as Path from "effect/Path";
import * as Schedule from "effect/Schedule";
import * as Schema from "effect/Schema";
import { Command, Flag } from "effect/cli";
import { ChildProcess, ChildProcessSpawner } from "effect/process";

import { BRAND_ASSET_PATHS } from "./lib/brand-assets.ts";
import { MAC_ICON_NAME, macIconCompilerArguments } from "./lib/mac-icon-assets.ts";
import { codesignArgs, MacSigningConfig, notarytoolSubmitArgs } from "./lib/mac-signing.ts";

export const MAC_INSTALLER_FILE_NAME = "supaterm-installer.dmg";
const APP_NAME = "Install Supaterm";
const EXECUTABLE_NAME = "SupatermInstaller";
const MINIMUM_MACOS = "13.0";

const RepoRoot = Effect.service(Path.Path).pipe(
  Effect.flatMap((path) => path.fromFileUrl(new URL("..", import.meta.url))),
);

export class MacInstallerCommandFailedError extends Schema.TaggedError<MacInstallerCommandFailedError>()(
  "MacInstallerCommandFailedError",
  { command: Schema.String, exitCode: Schema.Int },
) {
  override get message(): string {
    return `${this.command} exited with code ${this.exitCode}.`;
  }
}

// hdiutil intermittently fails with "Resource busy" on CI runners.
const retryHdiutil = <A, E, R>(effect: Effect.Effect<A, E, R>) =>
  effect.pipe(Effect.retry({ times: 2, schedule: Schedule.spaced("5 seconds") }));

const run = Effect.fn("run")(function* (command: string, args: ReadonlyArray<string>) {
  const spawner = yield* ChildProcessSpawner.ChildProcessSpawner;
  const child = yield* spawner.spawn(
    ChildProcess.make(command, args, { stdout: "inherit", stderr: "inherit" }),
  );
  const exitCode = Number(yield* child.exitCode);
  if (exitCode !== 0) {
    return yield* new MacInstallerCommandFailedError({
      command: [command, ...args.slice(0, 2)].join(" "),
      exitCode,
    });
  }
});

const buildMacInstaller = Effect.fn("buildMacInstaller")(function* (input: {
  readonly version: string;
  readonly outputDir: string;
}) {
  const fs = yield* FileSystem.FileSystem;
  const path = yield* Path.Path;
  const repoRoot = yield* RepoRoot;
  const { identity, notary } = yield* MacSigningConfig;
  const bundleVersion = input.version.split("-")[0] ?? input.version;

  const sourceDir = path.join(repoRoot, "native/mac-installer");
  const sources = (yield* fs.readDirectory(path.join(sourceDir, "Sources")))
    .filter((entry) => entry.endsWith(".swift"))
    .map((entry) => path.join(sourceDir, "Sources", entry));

  const workDir = yield* fs.makeTempDirectoryScoped({ prefix: "supaterm-mac-installer-" });
  const imageRoot = path.join(workDir, "image");
  const appDir = path.join(imageRoot, `${APP_NAME}.app`);
  const executable = path.join(appDir, "Contents/MacOS", EXECUTABLE_NAME);
  const resources = path.join(appDir, "Contents/Resources");
  const infoPlist = path.join(appDir, "Contents/Info.plist");
  yield* fs.makeDirectory(path.dirname(executable), { recursive: true });
  yield* fs.makeDirectory(resources, { recursive: true });

  const slices: Array<string> = [];
  for (const arch of ["arm64", "x86_64"]) {
    const slice = path.join(workDir, `${EXECUTABLE_NAME}-${arch}`);
    yield* run("xcrun", [
      "swiftc",
      "-O",
      "-parse-as-library",
      "-swift-version",
      "5",
      "-target",
      `${arch}-apple-macos${MINIMUM_MACOS}`,
      "-o",
      slice,
      ...sources,
    ]);
    slices.push(slice);
  }
  yield* run("lipo", ["-create", "-output", executable, ...slices]);

  yield* fs.copyFile(path.join(sourceDir, "Info.plist"), infoPlist);
  for (const key of ["CFBundleShortVersionString", "CFBundleVersion"]) {
    yield* run("plutil", ["-replace", key, "-string", bundleVersion, infoPlist]);
  }

  const iconDir = path.join(workDir, "icon");
  yield* fs.makeDirectory(iconDir);
  yield* run(
    "xcrun",
    macIconCompilerArguments(
      path.join(repoRoot, BRAND_ASSET_PATHS.productionIconComposerProject),
      iconDir,
    ),
  );
  for (const file of [`${MAC_ICON_NAME}.icns`, "Assets.car"]) {
    yield* fs.copyFile(path.join(iconDir, file), path.join(resources, file));
  }
  yield* fs.copyFile(
    path.join(iconDir, `${MAC_ICON_NAME}.icns`),
    path.join(imageRoot, ".VolumeIcon.icns"),
  );

  yield* run("codesign", codesignArgs(identity, appDir));

  const layoutTool = path.join(workDir, "DiskImageLayout");
  yield* run("xcrun", [
    "swiftc",
    "-O",
    "-o",
    layoutTool,
    path.join(sourceDir, "DiskImageLayout/main.swift"),
  ]);
  yield* run(layoutTool, ["background", imageRoot]);

  // The Finder view's background alias must point into the volume itself, so
  // the .DS_Store is written on a mounted read-write copy before compressing.
  const layoutImage = path.join(workDir, "layout.dmg");
  yield* run("hdiutil", [
    "create",
    "-volname",
    APP_NAME,
    "-srcfolder",
    imageRoot,
    "-fs",
    "HFS+",
    "-format",
    "UDRW",
    "-ov",
    layoutImage,
  ]).pipe(retryHdiutil);
  const volume = path.join(workDir, "volume");
  yield* Effect.acquireUseRelease(
    run("hdiutil", [
      "attach",
      layoutImage,
      "-readwrite",
      "-nobrowse",
      "-noautoopen",
      "-mountpoint",
      volume,
    ]),
    () => run(layoutTool, ["finder-view", volume, `${APP_NAME}.app`]),
    () => run("hdiutil", ["detach", volume]).pipe(retryHdiutil),
  );

  yield* fs.makeDirectory(input.outputDir, { recursive: true });
  const dmgPath = path.resolve(input.outputDir, MAC_INSTALLER_FILE_NAME);
  yield* run("hdiutil", [
    "convert",
    layoutImage,
    "-format",
    "UDZO",
    "-imagekey",
    "zlib-level=9",
    "-ov",
    "-o",
    dmgPath,
  ]);
  if (identity === "-") {
    yield* Effect.log(`[mac-installer] Wrote ${dmgPath}, signed ad hoc.`);
    return dmgPath;
  }
  yield* run("codesign", ["--force", "--sign", identity, "--timestamp", dmgPath]);

  if (!notary) {
    yield* Effect.logWarning(
      `[mac-installer] Wrote ${dmgPath}, Developer ID signed but not notarized (missing APPLE_API_KEY*).`,
    );
    return dmgPath;
  }
  yield* run("xcrun", notarytoolSubmitArgs(dmgPath, notary));
  yield* run("xcrun", ["stapler", "staple", dmgPath]);
  yield* Effect.log(`[mac-installer] Wrote ${dmgPath}, signed and notarized.`);
  return dmgPath;
});

const command = Command.make(
  "build-mac-installer",
  {
    version: Flag.String("version").pipe(
      Flag.withDescription("Release version stamped into the installer app."),
    ),
    outputDir: Flag.String("output-dir").pipe(Flag.withDefault("release")),
  },
  (input) => buildMacInstaller(input).pipe(Effect.scoped),
).pipe(Command.withDescription("Build the Install Supaterm disk image for macOS."));

if (import.meta.main) {
  Command.run(command, { version: "0.0.0" }).pipe(
    Effect.provide(Layer.mergeAll(Logger.layer([Logger.consolePretty()]), NodeServices.layer)),
    NodeRuntime.runMain,
  );
}
