#!/usr/bin/env node

import * as NodeRuntime from "@effect/platform-node/NodeRuntime";
import * as NodeServices from "@effect/platform-node/NodeServices";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";
import * as Logger from "effect/Logger";
import { Command, Flag } from "effect/cli";

import {
  resolveDesktopProductName,
  verifyWindowsPackagedRuntime,
} from "./build-desktop-artifact.ts";

const verifyWindowsDesktopArtifactCli = Command.make("verify-windows-desktop-artifact", {
  appDir: Flag.String("app-dir").pipe(
    Flag.withDescription("The electron-builder `win-<arch>-unpacked` directory."),
  ),
  arch: Flag.Literals("arch", ["arm64", "x64"] as const),
  buildVersion: Flag.String("build-version").pipe(
    Flag.withDescription("The artifact's build version."),
  ),
  verbose: Flag.Boolean("verbose").pipe(Flag.withDefault(false)),
}).pipe(
  Command.withDescription("Verify a Windows desktop artifact's packaged natives load."),
  Command.withHandler(({ appDir, arch, buildVersion, verbose }) =>
    Effect.gen(function* () {
      yield* verifyWindowsPackagedRuntime({
        packagedAppDir: appDir,
        appExecutableName: `${resolveDesktopProductName(buildVersion)}.exe`,
        targetArch: arch,
        verbose,
      });
      yield* Effect.log(`[verify-windows-desktop-artifact] ${appDir} passed.`);
    }),
  ),
);

Command.run(verifyWindowsDesktopArtifactCli, { version: "0.0.0" }).pipe(
  Effect.scoped,
  Effect.provide(Layer.mergeAll(Logger.layer([Logger.consolePretty()]), NodeServices.layer)),
  NodeRuntime.runMain,
);
