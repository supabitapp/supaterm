import * as NodeServices from "@effect/platform-node/NodeServices";
import { expect, it } from "@effect/vitest";
import * as HostProcess from "@supaterm/shared/HostProcess";
import * as Deferred from "effect/Deferred";
import * as Effect from "effect/Effect";
import * as FileSystem from "effect/FileSystem";
import * as Fiber from "effect/Fiber";
import * as Path from "effect/Path";
import * as Stream from "effect/Stream";
import { HttpClient, HttpClientResponse } from "effect/http";
import * as ChildProcessSpawner from "effect/process/ChildProcessSpawner";

import * as ServerConfig from "../config.ts";
import * as DesktopAppUpdate from "../desktopUpdate/DesktopAppUpdate.ts";
import * as ProcessRunner from "../processRunner.ts";
import * as ServiceLauncherClient from "./serviceLauncherClient.ts";
import { SERVICE_LAUNCHER_PROTOCOL } from "./serviceProtocol.ts";
import * as ServerSelfUpdate from "./selfUpdate.ts";

interface HarnessOptions {
  readonly mode?: "web" | "desktop";
  readonly managed?: boolean;
  readonly preflight?: "ready" | "blocked";
  readonly beforeDownload?: Effect.Effect<void>;
  readonly requestUpdate?: ServiceLauncherClient.ServiceLauncherClient["Service"]["requestUpdate"];
  readonly desktopAppUpdate?: DesktopAppUpdate.DesktopAppUpdate["Service"];
}

// The staged runtime is a release archive: the fake client serves SHA256SUMS
// and the tarball, and the fake runner stands in for tar before it answers
// the staged preflight.
const archiveBytes = new TextEncoder().encode("not really a tarball");
const releaseHttpClient = (order: string[], beforeDownload?: Effect.Effect<void>) =>
  HttpClient.make((request) =>
    Effect.gen(function* () {
      if (request.url.endsWith("/SHA256SUMS")) {
        const digest = yield* Effect.promise(() => crypto.subtle.digest("SHA-256", archiveBytes));
        const hex = Array.from(new Uint8Array(digest), (byte) =>
          byte.toString(16).padStart(2, "0"),
        ).join("");
        return HttpClientResponse.fromWeb(
          request,
          new Response(`${hex}  supaterm-1.1.0-linux-x64.tar.gz\n`),
        );
      }
      if (beforeDownload) yield* beforeDownload;
      order.push("download");
      return HttpClientResponse.fromWeb(request, new Response(archiveBytes));
    }),
  );

const makeHarness = Effect.fn("test.make_self_update_harness")(function* (
  options: HarnessOptions = {},
) {
  const fs = yield* FileSystem.FileSystem;
  const path = yield* Path.Path;
  const baseDir = yield* fs.makeTempDirectoryScoped({ prefix: "supaterm-self-update-test-" });
  const order: string[] = [];
  const runner = ProcessRunner.ProcessRunner.of({
    run: (input) =>
      Effect.gen(function* () {
        if (input.command === "tar") {
          order.push("extract");
          const stagingDir = input.args[input.args.indexOf("-C") + 1];
          if (stagingDir === undefined) return yield* Effect.die("missing tar target");
          yield* fs
            .writeFileString(path.join(stagingDir, "supaterm"), "#!/bin/sh\n")
            .pipe(Effect.orDie);
          return {
            stdout: "",
            stderr: "",
            code: ChildProcessSpawner.ExitCode(0),
            timedOut: false,
            stdoutTruncated: false,
            stderrTruncated: false,
            stdoutInvalidUtf8: false,
            stderrInvalidUtf8: false,
          };
        }
        order.push("preflight");
        const result =
          options.preflight === "blocked"
            ? { status: "blocked", version: "1.1.0", reason: "local update required" }
            : {
                status: "ready",
                version: "1.1.0",
                launcherProtocol: SERVICE_LAUNCHER_PROTOCOL,
              };
        return {
          stdout: JSON.stringify(result),
          stderr: "",
          code: ChildProcessSpawner.ExitCode(0),
          timedOut: false,
          stdoutTruncated: false,
          stderrTruncated: false,
          stdoutInvalidUtf8: false,
          stderrInvalidUtf8: false,
        };
      }),
  });
  const launcher = ServiceLauncherClient.ServiceLauncherClient.of({
    managed: options.managed ?? true,
    requestUpdate:
      options.requestUpdate ??
      (() =>
        Effect.sync(() => {
          order.push("accept");
          return "launcher-id";
        })),
    prepareTrial: Effect.undefined,
  });
  const config = yield* ServerConfig.ServerConfig.pipe(
    Effect.provide(ServerConfig.layerTest(process.cwd(), baseDir)),
  );
  const selfUpdate = yield* ServerSelfUpdate.make().pipe(
    Effect.provideService(ProcessRunner.ProcessRunner, runner),
    Effect.provideService(ServiceLauncherClient.ServiceLauncherClient, launcher),
    Effect.provideService(
      DesktopAppUpdate.DesktopAppUpdate,
      options.desktopAppUpdate ?? {
        available: false,
        run: () => Effect.die("unexpected desktop app update run"),
      },
    ),
    Effect.provideService(HttpClient.HttpClient, releaseHttpClient(order, options.beforeDownload)),
    Effect.provideService(HostProcess.Platform, "linux"),
    Effect.provideService(HostProcess.Architecture, "x64"),
    Effect.provide(ServerConfig.layer({ ...config, mode: options.mode ?? "web" })),
  );
  return { selfUpdate, order };
});

it.layer(NodeServices.layer)("server self update", (it) => {
  it.effect("stages and preflights before asking the launcher for an update ID", () =>
    Effect.gen(function* () {
      const { selfUpdate, order } = yield* makeHarness();
      expect(yield* selfUpdate.update({ targetVersion: "1.1.0" })).toEqual({
        targetVersion: "1.1.0",
        method: "boot-service",
        updateId: "launcher-id",
      });
      expect(order).toEqual(["download", "extract", "preflight", "accept"]);
    }),
  );

  it.effect("rejects invalid versions and desktop-managed servers before staging", () =>
    Effect.gen(function* () {
      const web = yield* makeHarness();
      expect(
        (yield* web.selfUpdate.update({ targetVersion: "latest" }).pipe(Effect.flip)).reason,
      ).toBe("'latest' is not an exact Supaterm version.");
      const desktop = yield* makeHarness({ mode: "desktop" });
      expect(
        (yield* desktop.selfUpdate.update({ targetVersion: "1.1.0" }).pipe(Effect.flip)).reason,
      ).toContain("desktop app");
      expect([...web.order, ...desktop.order]).toEqual([]);
    }),
  );

  it.effect("delegates desktop-managed updates to the desktop app when available", () =>
    Effect.gen(function* () {
      const stages: string[] = [];
      const { selfUpdate, order } = yield* makeHarness({
        mode: "desktop",
        desktopAppUpdate: {
          available: true,
          run: (reportProgress) =>
            reportProgress("downloading").pipe(
              Effect.andThen(reportProgress("installing")),
              Effect.as({ targetVersion: "1.2.0", method: "desktop-app" as const }),
            ),
          commit: () => Effect.never,
        },
      });
      const result = yield* selfUpdate.update({ targetVersion: "1.1.0" }, (stage) =>
        Effect.sync(() => void stages.push(stage)),
      );
      expect(result).toEqual({ targetVersion: "1.2.0", method: "desktop-app" });
      expect(stages).toEqual(["downloading", "installing"]);
      // The launcher staging path must not run on the desktop path.
      expect(order).toEqual([]);
    }),
  );

  it.effect("preserves the preflight refusal reason", () =>
    Effect.gen(function* () {
      const { selfUpdate } = yield* makeHarness({ preflight: "blocked" });
      expect((yield* selfUpdate.update({ targetVersion: "1.1.0" }).pipe(Effect.flip)).reason).toBe(
        "local update required",
      );
    }),
  );

  it.effect("allows only one update at a time", () =>
    Effect.gen(function* () {
      const requested = yield* Deferred.make<void>();
      const accepted = yield* Deferred.make<string>();
      const { selfUpdate } = yield* makeHarness({
        requestUpdate: () =>
          Deferred.succeed(requested, undefined).pipe(Effect.andThen(Deferred.await(accepted))),
      });
      const first = yield* Effect.forkChild(selfUpdate.update({ targetVersion: "1.1.0" }), {
        startImmediately: true,
      });
      yield* Deferred.await(requested);
      expect((yield* selfUpdate.update({ targetVersion: "1.1.1" }).pipe(Effect.flip)).reason).toBe(
        "A server update is already in progress.",
      );
      yield* Deferred.succeed(accepted, "launcher-id");
      expect((yield* Fiber.join(first)).updateId).toBe("launcher-id");
    }),
  );

  it.effect("keeps preparing after the progress stream closes", () =>
    Effect.gen(function* () {
      const releaseDownload = yield* Deferred.make<void>();
      const sawDownloading = yield* Deferred.make<void>();
      const accepted = yield* Deferred.make<void>();
      const { selfUpdate, order } = yield* makeHarness({
        beforeDownload: Deferred.await(releaseDownload),
        requestUpdate: () =>
          Effect.sync(() => {
            order.push("accept");
          }).pipe(Effect.andThen(Deferred.succeed(accepted, undefined)), Effect.as("launcher-id")),
      });

      const consumed = yield* ServerSelfUpdate.updateProgressStream(selfUpdate, {
        targetVersion: "1.1.0",
      }).pipe(
        Stream.tap((event) =>
          event.type === "progress" && event.stage === "downloading"
            ? Deferred.succeed(sawDownloading, undefined)
            : Effect.void,
        ),
        Stream.runDrain,
        Effect.forkChild,
      );

      yield* Deferred.await(sawDownloading);

      yield* Fiber.interrupt(consumed);
      expect((yield* selfUpdate.update({ targetVersion: "1.2.0" }).pipe(Effect.flip)).reason).toBe(
        "A server update is already in progress.",
      );

      yield* Deferred.succeed(releaseDownload, undefined);

      yield* Deferred.await(accepted);
      expect(order).toEqual(["download", "extract", "preflight", "accept"]);
      expect((yield* selfUpdate.update({ targetVersion: "1.1.0" }).pipe(Effect.flip)).reason).toBe(
        "A server update is already in progress.",
      );
    }),
  );
});
