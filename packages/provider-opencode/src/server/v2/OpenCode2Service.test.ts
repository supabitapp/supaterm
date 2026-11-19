import * as NodeServices from "@effect/platform-node/NodeServices";
import { it } from "@effect/vitest";
import * as HostProcess from "@supaterm/shared/HostProcess";
import * as Effect from "effect/Effect";
import * as FileSystem from "effect/FileSystem";
import * as Path from "effect/Path";
import { expect, vi } from "vite-plus/test";

import * as OpenCodeRuntime from "../OpenCodeRuntime.ts";
import {
  OpenCodeServiceControl,
  type OpenCodeServiceControlShape,
  replaceOutdatedService,
} from "./OpenCode2Service.ts";

type Discovered = { readonly url: string } | undefined;

const runtimeWithBinaryVersion = (stdout: string) =>
  ({
    runOpenCodeCommand: () => Effect.succeed({ stdout, stderr: "", code: 0 }),
  }) as unknown as OpenCodeRuntime.OpenCodeRuntime["Service"];

it.layer(NodeServices.layer)("replaceOutdatedService", (it) => {
  it.effect.skipIf(HostProcess.Platform.defaultValue() === "win32")(
    "replaces only this install's 2.x service, keeping its configured env",
    () =>
      Effect.gen(function* () {
        const fileSystem = yield* FileSystem.FileSystem;
        const path = yield* Path.Path;
        const home = yield* fileSystem.makeTempDirectoryScoped();
        const binDirectory = path.join(home, "bin");
        yield* fileSystem.makeDirectory(binDirectory);
        yield* fileSystem.writeFileString(path.join(binDirectory, "opencode"), "");
        yield* fileSystem.chmod(path.join(binDirectory, "opencode"), 0o755);
        const environment = {
          HOME: home,
          PATH: binDirectory,
          OPENCODE_CONFIG_DIR: home,
          ELECTRON_RUN_AS_NODE: "1",
        };
        yield* fileSystem.writeFileString(
          path.join(home, "service.json"),
          JSON.stringify({ env: { PATH: "/nowhere", XDG_STATE_HOME: "/elsewhere" } }),
        );
        const file = path.join(home, ".local", "state", "opencode", "service.json");
        const run = (binary: string, serverUrl = "http://127.0.0.1:49374") =>
          replaceOutdatedService({
            binaryPath: "opencode",
            serverUrl,
            environment,
          }).pipe(
            Effect.provideService(
              OpenCodeRuntime.OpenCodeRuntime,
              runtimeWithBinaryVersion(binary),
            ),
            Effect.provideService(OpenCodeServiceControl, fake),
          );
        const outdated = (options: { readonly version?: unknown }) =>
          options.version === undefined ? { url: "http://0.0.0.0:49374" } : undefined;
        let discover: (options: { readonly version?: unknown }) => Discovered = outdated;
        const fake: OpenCodeServiceControlShape = {
          discover: (options = {}) => {
            const discovered = discover(options);
            return Effect.succeed(
              discovered === undefined ? undefined : { url: discovered.url, auth: undefined },
            );
          },
          stop: () => Effect.void,
          ensure: () => Effect.succeed({ url: "", auth: undefined }),
        };
        const service = {
          discover: vi.spyOn(fake, "discover"),
          stop: vi.spyOn(fake, "stop"),
          ensure: vi.spyOn(fake, "ensure"),
        };

        yield* run("opencode v1.18.32");
        expect(service.discover).not.toHaveBeenCalled();

        for (const elsewhere of [
          "http://192.168.1.5:49374",
          "http://127.0.0.1:49999",
          "http://[::1]:49374",
          "http://localhost:49374",
        ]) {
          yield* run("opencode v2.2.5", elsewhere);
        }
        expect(service.discover).toHaveBeenCalledWith({ file });
        discover = () => ({ url: "http://0.0.0.0" });
        yield* run("opencode v2.2.5", "https://127.0.0.1");
        expect(service.ensure).not.toHaveBeenCalled();

        discover = () => undefined;
        yield* run("opencode v2.2.5");
        expect(service.ensure).not.toHaveBeenCalled();

        discover = () => ({ url: "http://0.0.0.0:49374" });
        yield* run("opencode v2.2.5");
        expect(service.stop).not.toHaveBeenCalled();

        discover = outdated;
        yield* run("opencode v2.2.5");
        expect(service.stop).toHaveBeenCalledWith({ file, pty: "handoff" });
        expect(service.ensure).toHaveBeenCalledWith({
          file,
          command: [path.join(binDirectory, "opencode"), "serve", "--service"],
          env: { ...environment, PATH: "/nowhere", ELECTRON_RUN_AS_NODE: undefined },
        });
      }),
  );
});
