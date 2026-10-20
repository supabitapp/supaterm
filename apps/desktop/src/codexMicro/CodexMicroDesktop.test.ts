import * as NodeServices from "@effect/platform-node/NodeServices";
import { assert, describe, it } from "@effect/vitest";
import * as Effect from "effect/Effect";
import * as FileSystem from "effect/FileSystem";
import * as Layer from "effect/Layer";

import * as DesktopConfig from "../app/DesktopConfig.ts";
import * as DesktopEnvironment from "../app/DesktopEnvironment.ts";
import * as CodexMicroDesktop from "./CodexMicroDesktop.ts";

const includedInBuild = (input: { readonly isPackaged: boolean; readonly packageJson?: object }) =>
  Effect.gen(function* () {
    const fileSystem = yield* FileSystem.FileSystem;
    const appPath = yield* fileSystem.makeTempDirectoryScoped({
      prefix: "supaterm-codex-micro-build-test-",
    });
    if (input.packageJson !== undefined) {
      yield* fileSystem.writeFileString(
        `${appPath}/package.json`,
        JSON.stringify(input.packageJson),
      );
    }
    const environment = DesktopEnvironment.layer({
      dirname: "/repo/apps/desktop/src",
      homeDirectory: appPath,
      platform: "darwin",
      processArch: "arm64",
      appVersion: "1.2.3",
      appPath,
      isPackaged: input.isPackaged,
      resourcesPath: "/missing/resources",
      runningUnderArm64Translation: false,
    }).pipe(
      Layer.provide(
        Layer.mergeAll(NodeServices.layer, DesktopConfig.layerTest({ SUPATERM_HOME: appPath })),
      ),
    );
    return yield* CodexMicroDesktop.includedInBuild.pipe(Effect.provide(environment));
  }).pipe(Effect.provide(NodeServices.layer), Effect.scoped);

describe("CodexMicroDesktop.includedInBuild", () => {
  it.effect("includes the keyboard unless the packaged app says it was left out", () =>
    Effect.gen(function* () {
      assert.isTrue(yield* includedInBuild({ isPackaged: false }));
      assert.isTrue(
        yield* includedInBuild({ isPackaged: true, packageJson: { name: "supaterm" } }),
      );
      assert.isFalse(
        yield* includedInBuild({
          isPackaged: true,
          packageJson: { name: "supaterm", supatermFeatures: { codexMicro: false } },
        }),
      );
    }),
  );
});
