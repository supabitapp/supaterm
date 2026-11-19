// @effect-diagnostics nodeBuiltinImport:off -- Relaunches the AppImage under a leaky parent shell.
import * as NodeServices from "@effect/platform-node/NodeServices";
import { assert, describe, it } from "@effect/vitest";
import * as Deferred from "effect/Deferred";
import * as Effect from "effect/Effect";
import * as FileSystem from "effect/FileSystem";
import * as Path from "effect/Path";
import * as HostProcess from "@supaterm/shared/HostProcess";
import { autoUpdater } from "electron-updater";
import * as NodeChildProcess from "node:child_process";
import { vi } from "vite-plus/test";

vi.hoisted(() => {
  const NodeModule = process.getBuiltinModule("node:module");
  const NodeEvents = process.getBuiltinModule("node:events");
  const NodeUrl = process.getBuiltinModule("node:url");
  const require = NodeModule.createRequire(import.meta.url);
  const electronPath = require.resolve("electron");
  NodeModule.registerHooks({
    resolve: (specifier, context, nextResolve) =>
      specifier === "electron"
        ? { url: NodeUrl.pathToFileURL(electronPath).href, shortCircuit: true }
        : nextResolve(specifier, context),
  });
  const electronModule = new NodeModule.Module(electronPath);
  electronModule.filename = electronPath;
  electronModule.loaded = true;
  electronModule.exports = {
    app: {
      getVersion: () => "1.0.0",
      getName: () => "Supaterm",
      isPackaged: true,
      quit: () => undefined,
      once: () => undefined,
    },
    autoUpdater: new NodeEvents.EventEmitter(),
  };
  require.cache[electronPath] = electronModule;
});

import * as ElectronUpdater from "./ElectronUpdater.ts";

describe.skipIf(HostProcess.Platform.defaultValue() !== "linux")(
  "ElectronUpdater AppImage install",
  () => {
    it.live("relaunches the installed AppImage without the updating process's descriptors", () =>
      Effect.gen(function* () {
        const fileSystem = yield* FileSystem.FileSystem;
        const path = yield* Path.Path;
        const dir = yield* fileSystem.makeTempDirectoryScoped({
          prefix: "supaterm-appimage-install-",
        });
        const appImagePath = path.join(dir, "Supaterm-Code.AppImage");
        const stagedPath = path.join(dir, "Supaterm-Code-1.0.1.AppImage");
        const fdReportPath = path.join(dir, "relaunched-fds.txt");
        yield* fileSystem.writeFileString(appImagePath, "old AppImage");
        yield* fileSystem.writeFileString(
          stagedPath,
          `#!/bin/sh\nls /proc/self/fd > '${fdReportPath}'\n`,
        );
        yield* fileSystem.chmod(stagedPath, 0o755);

        yield* Effect.acquireRelease(
          Effect.sync(() => vi.stubEnv("APPIMAGE", appImagePath)),
          () => Effect.sync(() => vi.unstubAllEnvs()),
        );

        autoUpdater.logger = null;
        Object.assign(autoUpdater, {
          downloadedUpdateHelper: {
            file: stagedPath,
            downloadedFileInfo: { isAdminRightsRequired: false },
          },
        });

        const relaunched = yield* Deferred.make<void>();
        const appImageSpawnLog: ElectronUpdater.SpawnLog = async (command, args = [], env) => {
          const child = NodeChildProcess.spawn(
            "bash",
            ["-c", 'exec 7</dev/null; exec "$@"', "leaky-parent", command, ...args],
            { stdio: "ignore", env: env as NodeJS.ProcessEnv | undefined },
          );
          child.once("exit", () => Deferred.doneUnsafe(relaunched, Effect.void));
          return true;
        };

        const electronUpdater = ElectronUpdater.makeWith({ appImageSpawnLog });
        yield* electronUpdater.quitAndInstall({ isSilent: true, isForceRunAfter: true });
        yield* Deferred.await(relaunched);

        const descriptors = (yield* fileSystem.readFileString(fdReportPath)).trim().split("\n");
        assert.notInclude(
          descriptors,
          "7",
          `relaunched AppImage inherited the updating process's fd 7 (open fds: ${descriptors.join(" ")})`,
        );
      }).pipe(Effect.provide(NodeServices.layer)),
    );
  },
);
