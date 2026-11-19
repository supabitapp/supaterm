// @effect-diagnostics nodeBuiltinImport:off - node:path.win32 stands in for a Windows host in one test.
import * as NodeServices from "@effect/platform-node/NodeServices";
import { assert, it } from "@effect/vitest";
import * as Deferred from "effect/Deferred";
import * as Duration from "effect/Duration";
import * as Effect from "effect/Effect";
import * as FileSystem from "effect/FileSystem";
import * as Fiber from "effect/Fiber";
import * as Path from "effect/Path";
import * as Stream from "effect/Stream";
import * as NodePath from "node:path";
import * as TestClock from "effect/testing/TestClock";
import { HttpClient, HttpClientError, HttpClientResponse } from "effect/http";
import * as ChildProcess from "effect/process/ChildProcess";
import * as ChildProcessSpawner from "effect/process/ChildProcessSpawner";

import * as HostProcess from "@supaterm/shared/HostProcess";

import * as ProcessRunner from "../processRunner.ts";
import {
  isVersionExecutable,
  ensurePinnedRuntimeInstalled,
  pinnedRuntimeCommand,
  pinnedRuntimePaths,
  PinnedRuntimeInstallError,
  type PinnedRuntimeProgress,
  prunePinnedRuntimes,
} from "./pinnedRuntime.ts";
import { SERVICE_LAUNCHER_PROTOCOL } from "./serviceProtocol.ts";

const version = "1.2.3";
const archiveName = `supaterm-${version}-linux-x64.tar.gz`;
const archiveBytes = new TextEncoder().encode("not really a tarball");
const archiveHex = (bytes: Uint8Array<ArrayBuffer>) =>
  Effect.promise(() => crypto.subtle.digest("SHA-256", bytes)).pipe(
    Effect.map((digest) =>
      Array.from(new Uint8Array(digest), (byte) => byte.toString(16).padStart(2, "0")).join(""),
    ),
  );
const validChecksums = archiveHex(archiveBytes).pipe(
  Effect.map((hex) => `${hex}  ${archiveName}\n`),
);
const releaseHttpClient = (checksums: string, requests: string[] = []) =>
  HttpClient.make((request) => {
    requests.push(request.url);
    const body = request.url.endsWith("/SHA256SUMS") ? checksums : archiveBytes;
    return Effect.succeed(HttpClientResponse.fromWeb(request, new Response(body)));
  });
const extractingRunner = (fs: FileSystem.FileSystem, path: Path.Path, commands: string[] = []) =>
  ProcessRunner.ProcessRunner.of({
    run: (input) =>
      Effect.gen(function* () {
        commands.push(input.command);
        const targetIndex = input.args.indexOf("-C");
        const stagingDir = input.args[targetIndex + 1];
        if (input.command !== "tar" || stagingDir === undefined) {
          return yield* Effect.die(`unexpected command ${input.command}`);
        }
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
      }),
  });

it.layer(NodeServices.layer)("ensurePinnedRuntimeInstalled", (it) => {
  it.effect("installs the verified release archive as the runtime executable", () =>
    Effect.gen(function* () {
      const fs = yield* FileSystem.FileSystem;
      const path = yield* Path.Path;
      const baseDir = yield* fs.makeTempDirectoryScoped({ prefix: "supaterm-pinned-archive-" });
      const requests: string[] = [];
      const commands: string[] = [];
      const paths = yield* ensurePinnedRuntimeInstalled({
        baseDir,
        version,
        fs,
        path,
        platform: "linux",
        arch: "x64",
        httpClient: releaseHttpClient(yield* validChecksums, requests),
        releaseBaseUrl: "https://releases.example/download",
        runner: extractingRunner(fs, path, commands),
        validate: (staging) =>
          fs.exists(staging.entryPath).pipe(
            Effect.flatMap((exists) => (exists ? Effect.void : Effect.die("missing runtime"))),
            Effect.orDie,
          ),
      });
      assert.equal(paths.entryPath, path.join(paths.versionDir, "supaterm"));
      assert.deepEqual(pinnedRuntimeCommand(paths), { command: paths.entryPath, args: [] });
      assert.deepEqual(requests, [
        `https://releases.example/download/v${version}/SHA256SUMS`,
        `https://releases.example/download/v${version}/${archiveName}`,
      ]);
      assert.deepEqual(commands, ["tar"]);
      assert.equal(yield* fs.readFileString(paths.sentinelPath), `${version}\n`);
      assert.isFalse(yield* fs.exists(path.join(paths.versionDir, "supaterm-runtime-archive")));
    }),
  );

  it.effect("cleans up an interrupted download without reporting verification or extraction", () =>
    Effect.gen(function* () {
      const fs = yield* FileSystem.FileSystem;
      const path = yield* Path.Path;
      const baseDir = yield* fs.makeTempDirectoryScoped({
        prefix: "supaterm-pinned-progress-failed-",
      });
      const checksums = yield* validChecksums;
      const progress: PinnedRuntimeProgress[] = [];
      let cancelled = false;
      const client = HttpClient.make((request) =>
        Effect.succeed(
          HttpClientResponse.fromWeb(
            request,
            request.url.endsWith("/SHA256SUMS")
              ? new Response(checksums)
              : new Response(
                  new ReadableStream({
                    start(controller) {
                      controller.enqueue(archiveBytes.slice(0, 4));
                    },
                    cancel() {
                      cancelled = true;
                    },
                  }),
                ),
          ),
        ),
      );
      const firstChunk = yield* Deferred.make<void>();
      const install = yield* ensurePinnedRuntimeInstalled({
        baseDir,
        version,
        fs,
        path,
        platform: "linux",
        arch: "x64",
        httpClient: client,
        runner: extractingRunner(fs, path),
        validate: () => Effect.die("must not validate an interrupted archive"),
        onProgress: (event) => {
          progress.push(event);
          if (event.stage === "download" && event.received === 4)
            Deferred.doneUnsafe(firstChunk, Effect.void);
        },
      }).pipe(Effect.forkScoped);
      yield* Deferred.await(firstChunk);
      yield* Fiber.interrupt(install);
      assert.deepEqual(progress.at(-1), { stage: "download", received: 4, total: undefined });
      assert.isTrue(progress.every((event) => event.stage === "download"));
      assert.isTrue(cancelled);
      assert.deepEqual(yield* fs.readDirectory(path.join(baseDir, "runtime", "versions")), []);
    }),
  );

  it.effect("retries a release download that GitHub answers with a gateway timeout", () =>
    Effect.gen(function* () {
      const fs = yield* FileSystem.FileSystem;
      const path = yield* Path.Path;
      const baseDir = yield* fs.makeTempDirectoryScoped({ prefix: "supaterm-pinned-retry-" });
      const checksums = yield* validChecksums;
      const requests: string[] = [];
      const gatewayTimeoutServed = yield* Deferred.make<void>();
      const install = yield* ensurePinnedRuntimeInstalled({
        baseDir,
        version,
        fs,
        path,
        platform: "linux",
        arch: "x64",
        httpClient: HttpClient.make((request) => {
          requests.push(request.url);
          const isChecksums = request.url.endsWith("/SHA256SUMS");
          if (requests.length === 1) {
            Deferred.doneUnsafe(gatewayTimeoutServed, Effect.void);
            return Effect.succeed(
              HttpClientResponse.fromWeb(request, new Response("", { status: 504 })),
            );
          }
          return Effect.succeed(
            HttpClientResponse.fromWeb(
              request,
              new Response(isChecksums ? checksums : archiveBytes),
            ),
          );
        }),
        runner: extractingRunner(fs, path),
        validate: () => Effect.void,
      }).pipe(Effect.forkScoped);
      yield* Deferred.await(gatewayTimeoutServed);
      yield* TestClock.adjust(Duration.seconds(2));
      const paths = yield* Fiber.join(install);
      assert.equal(yield* fs.readFileString(paths.sentinelPath), `${version}\n`);
      assert.equal(requests.filter((url) => url.endsWith("/SHA256SUMS")).length, 2);
    }),
  );

  it.effect("retries a release archive whose body fails after the host answered", () =>
    Effect.gen(function* () {
      const fs = yield* FileSystem.FileSystem;
      const path = yield* Path.Path;
      const baseDir = yield* fs.makeTempDirectoryScoped({ prefix: "supaterm-pinned-retry-body-" });
      const checksums = yield* validChecksums;
      let archiveRequests = 0;
      const archiveRequested = yield* Deferred.make<void>();
      const install = yield* ensurePinnedRuntimeInstalled({
        baseDir,
        version,
        fs,
        path,
        platform: "linux",
        arch: "x64",
        httpClient: HttpClient.make((request) => {
          const isChecksums = request.url.endsWith("/SHA256SUMS");
          const response = HttpClientResponse.fromWeb(
            request,
            new Response(isChecksums ? checksums : archiveBytes),
          );
          if (isChecksums || ++archiveRequests > 1) return Effect.succeed(response);
          const failingBody = Stream.concat(
            Stream.make(archiveBytes.slice(0, 4)),
            Stream.fail(
              new HttpClientError.HttpClientError({
                reason: new HttpClientError.DecodeError({ request, response }),
              }),
            ),
          );
          Deferred.doneUnsafe(archiveRequested, Effect.void);
          return Effect.sleep("1 second").pipe(
            Effect.as<HttpClientResponse.HttpClientResponse>(
              Object.create(response, { stream: { value: failingBody } }),
            ),
          );
        }),
        runner: extractingRunner(fs, path),
        validate: () => Effect.void,
      }).pipe(Effect.forkScoped);
      yield* Deferred.await(archiveRequested);
      yield* TestClock.adjust(Duration.seconds(3));
      const paths = yield* Fiber.join(install);
      assert.equal(yield* fs.readFileString(paths.sentinelPath), `${version}\n`);
      assert.equal(archiveRequests, 2);
    }),
  );

  it.effect("fails at once when the release host cannot be reached", () =>
    Effect.gen(function* () {
      const fs = yield* FileSystem.FileSystem;
      const path = yield* Path.Path;
      const baseDir = yield* fs.makeTempDirectoryScoped({ prefix: "supaterm-pinned-offline-" });
      let requests = 0;
      const error = yield* ensurePinnedRuntimeInstalled({
        baseDir,
        version,
        fs,
        path,
        platform: "linux",
        arch: "x64",
        httpClient: HttpClient.make((request) => {
          requests += 1;
          return Effect.fail(
            new HttpClientError.HttpClientError({
              reason: new HttpClientError.TransportError({ request }),
            }),
          );
        }),
        runner: extractingRunner(fs, path),
        validate: () => Effect.die("must not validate without a download"),
      }).pipe(Effect.flip);
      assert.instanceOf(error, PinnedRuntimeInstallError);
      assert.equal(requests, 1);
    }),
  );

  it.effect("refuses an archive whose checksum does not match the release", () =>
    Effect.gen(function* () {
      const fs = yield* FileSystem.FileSystem;
      const path = yield* Path.Path;
      const baseDir = yield* fs.makeTempDirectoryScoped({ prefix: "supaterm-pinned-archive-bad-" });
      const commands: string[] = [];
      const error = yield* ensurePinnedRuntimeInstalled({
        baseDir,
        version,
        fs,
        path,
        platform: "linux",
        arch: "x64",
        httpClient: releaseHttpClient(`${"0".repeat(64)}  ${archiveName}\n`),
        runner: extractingRunner(fs, path, commands),
        validate: () => Effect.die("must not validate an unverified archive"),
      }).pipe(Effect.flip);
      assert.instanceOf(error, PinnedRuntimeInstallError);
      assert.equal(error.step, "verifying the Supaterm release archive checksum");
      assert.deepEqual(commands, []);
      assert.deepEqual(yield* fs.readDirectory(path.join(baseDir, "runtime", "versions")), []);
    }),
  );

  it.effect("validates a staging tree before atomically publishing it", () =>
    Effect.gen(function* () {
      const fs = yield* FileSystem.FileSystem;
      const path = yield* Path.Path;
      const baseDir = yield* fs.makeTempDirectoryScoped({
        prefix: "supaterm-pinned-runtime-test-",
      });
      const finalPaths = pinnedRuntimePaths(path, baseDir, version, "linux");
      let validatedDirectory = "";

      const installed = yield* ensurePinnedRuntimeInstalled({
        baseDir,
        version,
        fs,
        path,
        platform: "linux",
        arch: "x64",
        httpClient: releaseHttpClient(yield* validChecksums),
        runner: extractingRunner(fs, path),
        validate: (staging) =>
          Effect.gen(function* () {
            validatedDirectory = staging.versionDir;
            assert.isFalse(yield* fs.exists(finalPaths.versionDir));
            assert.isTrue(yield* fs.exists(staging.entryPath));
          }).pipe(Effect.orDie),
      });

      assert.notEqual(validatedDirectory, finalPaths.versionDir);
      assert.deepEqual(installed, finalPaths);
      assert.isTrue(yield* fs.exists(finalPaths.entryPath));
      assert.equal(yield* fs.readFileString(finalPaths.sentinelPath), `${version}\n`);
    }),
  );

  it.effect("removes staging and leaves no final runtime when validation fails", () =>
    Effect.gen(function* () {
      const fs = yield* FileSystem.FileSystem;
      const path = yield* Path.Path;
      const baseDir = yield* fs.makeTempDirectoryScoped({
        prefix: "supaterm-pinned-runtime-test-",
      });
      const finalPaths = pinnedRuntimePaths(path, baseDir, version, "linux");

      yield* ensurePinnedRuntimeInstalled({
        baseDir,
        version,
        fs,
        path,
        platform: "linux",
        arch: "x64",
        httpClient: releaseHttpClient(yield* validChecksums),
        runner: extractingRunner(fs, path),
        validate: () =>
          Effect.fail(new PinnedRuntimeInstallError({ step: "validating the staged runtime" })),
      }).pipe(Effect.flip);

      assert.isFalse(yield* fs.exists(finalPaths.versionDir));
      assert.deepEqual(
        (yield* fs.readDirectory(path.dirname(finalPaths.versionDir))).filter((entry) =>
          entry.startsWith(".staging-"),
        ),
        [],
      );
    }),
  );

  it.effect("replaces an incomplete pinned runtime", () =>
    Effect.gen(function* () {
      const fs = yield* FileSystem.FileSystem;
      const path = yield* Path.Path;
      const baseDir = yield* fs.makeTempDirectoryScoped({
        prefix: "supaterm-pinned-runtime-repair-",
      });
      const finalPaths = pinnedRuntimePaths(path, baseDir, version, "linux");
      yield* fs.makeDirectory(finalPaths.versionDir, { recursive: true });
      yield* fs.writeFileString(path.join(finalPaths.versionDir, "partial"), "incomplete\n");

      yield* ensurePinnedRuntimeInstalled({
        baseDir,
        version,
        fs,
        path,
        platform: "linux",
        arch: "x64",
        httpClient: releaseHttpClient(yield* validChecksums),
        runner: extractingRunner(fs, path),
        validate: () => Effect.void,
      });

      assert.isFalse(yield* fs.exists(path.join(finalPaths.versionDir, "partial")));
      assert.isTrue(yield* fs.exists(finalPaths.entryPath));
    }),
  );

  it.effect("preserves a completed runtime when validation fails", () =>
    Effect.gen(function* () {
      const fs = yield* FileSystem.FileSystem;
      const path = yield* Path.Path;
      const baseDir = yield* fs.makeTempDirectoryScoped({
        prefix: "supaterm-pinned-runtime-repair-",
      });
      const finalPaths = pinnedRuntimePaths(path, baseDir, version, "linux");
      yield* fs.makeDirectory(path.dirname(finalPaths.entryPath), { recursive: true });
      yield* fs.writeFileString(finalPaths.entryPath, "broken\n");
      yield* fs.writeFileString(finalPaths.sentinelPath, `${version}\n`);

      let validations = 0;
      const requests: string[] = [];
      yield* ensurePinnedRuntimeInstalled({
        baseDir,
        version,
        fs,
        path,
        platform: "linux",
        arch: "x64",
        httpClient: releaseHttpClient(yield* validChecksums, requests),
        runner: extractingRunner(fs, path),
        validate: (paths) =>
          Effect.gen(function* () {
            validations += 1;
            const source = yield* fs.readFileString(paths.entryPath).pipe(Effect.orDie);
            if (source === "broken\n") {
              return yield* new PinnedRuntimeInstallError({ step: "validating the runtime" });
            }
          }),
      }).pipe(Effect.flip);

      assert.equal(validations, 1);
      assert.deepEqual(requests, []);
      assert.equal(yield* fs.readFileString(finalPaths.entryPath), "broken\n");
    }),
  );
});

it("isVersionExecutable accepts only <version>/supaterm, never another drive or program", () => {
  const win32 = NodePath.win32 as unknown as Path.Path;
  assert.isTrue(
    isVersionExecutable(
      win32,
      "C:\\supaterm\\versions",
      "C:\\supaterm\\versions\\1.0.0\\supaterm.exe",
    ),
  );
  assert.isFalse(isVersionExecutable(win32, "C:\\supaterm\\versions", "D:\\supaterm.exe"));
  assert.isFalse(
    isVersionExecutable(win32, "C:\\supaterm\\versions", "C:\\supaterm\\versions\\1.0.0\\node.exe"),
  );
});

it.layer(NodeServices.layer)("prunePinnedRuntimes", (it) => {
  const lsofRunner = (stdout: string) =>
    ProcessRunner.ProcessRunner.of({
      run: () =>
        Effect.succeed({
          stdout,
          stderr: "",
          code: ChildProcessSpawner.ExitCode(0),
          timedOut: false,
          stdoutTruncated: false,
          stderrTruncated: false,
          stdoutInvalidUtf8: false,
          stderrInvalidUtf8: false,
        }),
    });

  const setup = Effect.fn(function* (versions: ReadonlyArray<string>) {
    const fs = yield* FileSystem.FileSystem;
    const path = yield* Path.Path;
    const baseDir = yield* fs.makeTempDirectoryScoped({ prefix: "supaterm-pinned-prune-" });
    const versionsDir = path.join(baseDir, "runtime", "versions");
    const now = Duration.toMillis(Duration.days(1));
    yield* TestClock.setTime(now);
    const install = Effect.fn(function* (
      version: string,
      completed: "long ago" | "just now" | "never" = "long ago",
    ) {
      const directory = path.join(versionsDir, version);
      yield* fs.makeDirectory(directory, { recursive: true });
      yield* fs.writeFileString(path.join(directory, "supaterm"), "");
      if (completed === "never") return;
      const sentinel = path.join(directory, ".install-complete");
      yield* fs.writeFileString(sentinel, `${version}\n`);
      const at = completed === "just now" ? now : 0;
      yield* fs.utimes(sentinel, at, at);
    });
    for (const version of versions) yield* install(version);
    return { baseDir, versionsDir, install };
  });

  it.effect("removes only completed runtimes nothing references", () =>
    Effect.gen(function* () {
      const fs = yield* FileSystem.FileSystem;
      const path = yield* Path.Path;
      const { baseDir, versionsDir, install } = yield* setup([
        "1.0.0",
        "1.1.0",
        "1.2.0",
        "1.2.5",
        "1.3.0",
        "1.3.5",
        "1.4.0",
        "1.5.0",
        "2.0.0",
        "2.1.0",
      ]);
      yield* install("0.5.0", "just now");
      yield* install("1.0.1", "never");
      yield* install(".staging-abc", "never");
      yield* install(".pruned-0.8.0");
      yield* install("other", "never");
      yield* fs.symlink(path.join(versionsDir, "other"), path.join(versionsDir, "0.9.0"));
      const binDir = path.join(baseDir, "bin");
      const customBinDir = path.join(baseDir, "custom-bin");
      yield* fs.makeDirectory(binDir);
      yield* fs.makeDirectory(customBinDir);
      yield* fs.symlink(
        path.join(versionsDir, "1.2.0", "supaterm"),
        path.join(baseDir, "alias-supaterm"),
      );
      yield* fs.symlink(path.join(baseDir, "alias-supaterm"), path.join(binDir, "supaterm"));
      yield* fs.symlink(
        path.join(versionsDir, "1.2.5", "supaterm"),
        path.join(customBinDir, "supaterm"),
      );
      yield* fs.writeFileString(
        path.join(baseDir, "runtime", "launchers"),
        `${path.join(customBinDir, "supaterm")}\n`,
      );
      yield* fs.writeFileString(
        path.join(baseDir, "runtime", "service-state.json"),
        JSON.stringify({
          protocol: SERVICE_LAUNCHER_PROTOCOL,
          activeVersion: "1.4.0",
          update: { id: "u", fromVersion: "1.4.0", targetVersion: "1.5.0", status: "rolled-back" },
        }),
      );

      const removed = yield* prunePinnedRuntimes({
        baseDir,
        keep: ["2.0.0"],
        references: [`ExecStart=${path.join(versionsDir, "1.3.5", "supaterm")} __service-launcher`],
      }).pipe(
        Effect.provideService(
          ProcessRunner.ProcessRunner,
          lsofRunner(`p42\nftxt\nn${path.join(versionsDir, "1.3.0", "supaterm")}\n`),
        ),
        Effect.provideService(HostProcess.Platform, "darwin"),
        Effect.provideService(HostProcess.Environment, { SUPATERM_INSTALL_BIN_DIR: binDir }),
      );

      assert.deepEqual(removed.toSorted(), ["0.8.0", "1.0.0", "1.1.0", "2.1.0"]);
      assert.equal(
        yield* fs.readFileString(path.join(baseDir, "runtime", "launchers")),
        `${path.join(customBinDir, "supaterm")}\n\n${path.join(binDir, "supaterm")}\n`,
      );
      assert.deepEqual((yield* fs.readDirectory(versionsDir)).toSorted(), [
        ".staging-abc",
        "0.5.0",
        "0.9.0",
        "1.0.1",
        "1.2.0",
        "1.2.5",
        "1.3.0",
        "1.3.5",
        "1.4.0",
        "1.5.0",
        "2.0.0",
        "other",
      ]);
    }),
  );

  it.effect.each([
    { name: "its directory is on PATH", onPath: true, recorded: false, linkedHome: false },
    {
      name: "an earlier prune recorded its entry as a launcher",
      onPath: false,
      recorded: true,
      linkedHome: false,
    },
    {
      name: "its real directory in a symlinked home is on PATH",
      onPath: true,
      recorded: false,
      linkedHome: true,
    },
  ])("removes a runtime only its own entry names when $name", ({ onPath, recorded, linkedHome }) =>
    Effect.gen(function* () {
      const fs = yield* FileSystem.FileSystem;
      const path = yield* Path.Path;
      const { baseDir, versionsDir } = yield* setup(["1.0.0", "1.1.0"]);
      const binDir = path.join(baseDir, "bin");
      yield* fs.makeDirectory(binDir);
      yield* fs.symlink(path.join(versionsDir, "1.1.0", "supaterm"), path.join(binDir, "supaterm"));
      const ownDir = path.join(linkedHome ? yield* fs.realPath(versionsDir) : versionsDir, "1.0.0");
      if (recorded) {
        yield* fs.writeFileString(
          path.join(baseDir, "runtime", "launchers"),
          `${path.join(ownDir, "supaterm")}\n`,
        );
      }

      const home = linkedHome
        ? path.join(yield* fs.makeTempDirectoryScoped({ prefix: "supaterm-pinned-link-" }), "home")
        : baseDir;
      if (linkedHome) yield* fs.symlink(baseDir, home);

      const removed = yield* prunePinnedRuntimes({ baseDir: home, keep: ["2.0.0"] }).pipe(
        Effect.provideService(
          ProcessRunner.ProcessRunner,
          lsofRunner("p1\nftxt\nn/sbin/launchd\n"),
        ),
        Effect.provideService(HostProcess.Platform, "darwin"),
        Effect.provideService(HostProcess.Environment, {
          SUPATERM_INSTALL_BIN_DIR: binDir,
          PATH: onPath ? `${ownDir}:/usr/bin:/bin` : "/usr/bin:/bin",
        }),
      );
      assert.deepEqual(removed, ["1.0.0"]);
    }),
  );

  it.effect.each([
    { name: "a launcher inside the versions directory", via: "bin" as const },
    { name: "a PATH directory linked to its version directory", via: "linked dir" as const },
    {
      name: "a PATH directory in the versions directory linked to its version directory",
      via: "linked versions dir" as const,
    },
  ])("keeps a runtime $name names", ({ via }) =>
    Effect.gen(function* () {
      const fs = yield* FileSystem.FileSystem;
      const path = yield* Path.Path;
      const { baseDir, versionsDir } = yield* setup(["1.0.0", "1.1.0"]);
      let pathDirs = "/usr/bin:/bin";
      if (via === "bin") {
        const binDir = path.join(versionsDir, "bin");
        yield* fs.makeDirectory(binDir);
        yield* fs.symlink(
          path.join(versionsDir, "1.0.0", "supaterm"),
          path.join(binDir, "supaterm"),
        );
        yield* fs.writeFileString(
          path.join(baseDir, "runtime", "launchers"),
          `${path.join(binDir, "supaterm")}\n`,
        );
      } else {
        const linkedDir = path.join(via === "linked dir" ? baseDir : versionsDir, "current");
        yield* fs.symlink(path.join(versionsDir, "1.0.0"), linkedDir);
        pathDirs = `${linkedDir}:${pathDirs}`;
      }

      const removed = yield* prunePinnedRuntimes({ baseDir, keep: ["2.0.0"] }).pipe(
        Effect.provideService(
          ProcessRunner.ProcessRunner,
          lsofRunner("p1\nftxt\nn/sbin/launchd\n"),
        ),
        Effect.provideService(HostProcess.Platform, "darwin"),
        Effect.provideService(HostProcess.Environment, { PATH: pathDirs }),
      );
      assert.deepEqual(removed, ["1.1.0"]);
    }),
  );

  it.effect.each([
    { name: "an unterminated launcher record", recorded: "/opt/supa", cut: "" },
    { name: "a record cut short after the read", recorded: "/opt/supaterm\n", cut: "/opt/supa" },
  ])("remembers a launcher found on PATH after $name", ({ recorded, cut }) =>
    Effect.gen(function* () {
      const fs = yield* FileSystem.FileSystem;
      const path = yield* Path.Path;
      const { baseDir, versionsDir } = yield* setup(["1.0.0", "1.1.0"]);
      const binDir = path.join(baseDir, "custom-bin");
      yield* fs.makeDirectory(binDir);
      yield* fs.symlink(path.join(versionsDir, "1.0.0", "supaterm"), path.join(binDir, "supaterm"));
      const launchersFile = path.join(baseDir, "runtime", "launchers");
      yield* fs.writeFileString(launchersFile, recorded);
      const prune = (environment: Record<string, string>) =>
        prunePinnedRuntimes({ baseDir, keep: [] }).pipe(
          Effect.provideService(ProcessRunner.ProcessRunner, lsofRunner("p1\nftxt\nn/bin/sh\n")),
          Effect.provideService(HostProcess.Platform, "darwin"),
          Effect.provideService(HostProcess.Environment, environment),
          Effect.provideService(HostProcess.HomeDirectory, baseDir),
        );

      yield* prune({ PATH: binDir }).pipe(
        Effect.provideService(FileSystem.FileSystem, {
          ...fs,
          readFileString: (file, encoding) =>
            fs
              .readFileString(file, encoding)
              .pipe(
                Effect.tap(() =>
                  file === launchersFile
                    ? fs.writeFileString(file, cut, { flag: "a" })
                    : Effect.void,
                ),
              ),
        }),
      );
      const removed = yield* prune({});

      assert.deepEqual(removed, []);
      assert.isTrue(yield* fs.exists(path.join(versionsDir, "1.0.0", "supaterm")));
    }),
  );

  it.effect("matches a Windows shim whatever its casing", () =>
    Effect.gen(function* () {
      const fs = yield* FileSystem.FileSystem;
      const path = yield* Path.Path;
      const { baseDir, versionsDir } = yield* setup(["1.0.0", "1.1.0"]);
      const shim = path.join(baseDir, "supaterm.cmd");
      yield* fs.writeFileString(
        shim,
        `@echo off\r\n"${path.join(versionsDir, "1.0.0", "supaterm.exe").toUpperCase()}" %*`,
      );
      yield* fs.writeFileString(path.join(baseDir, "runtime", "launchers"), `${shim}\n`);

      const removed = yield* prunePinnedRuntimes({ baseDir, keep: ["2.0.0"] }).pipe(
        Effect.provideService(
          ProcessRunner.ProcessRunner,
          lsofRunner("C:\\Windows\\explorer.exe\n"),
        ),
        Effect.provideService(HostProcess.Platform, "win32"),
        Effect.provideService(HostProcess.Environment, {}),
      );
      assert.deepEqual(removed, ["1.1.0"]);
    }),
  );

  it.effect.each([
    { name: "the process list is unavailable", state: undefined, lsof: "" },
    { name: "the service state is unparseable", state: "{", lsof: "p1\nftxt\nn/sbin/launchd\n" },
    {
      name: "the service state cannot be read",
      state: null,
      lsof: "p1\nftxt\nn/sbin/launchd\n",
    },
  ])("keeps everything when $name", ({ state, lsof }) =>
    Effect.gen(function* () {
      const fs = yield* FileSystem.FileSystem;
      const path = yield* Path.Path;
      const { baseDir, versionsDir } = yield* setup(["1.0.0"]);
      const statePath = path.join(baseDir, "runtime", "service-state.json");
      if (state === null) yield* fs.makeDirectory(statePath);
      else if (state !== undefined) yield* fs.writeFileString(statePath, state);

      const removed = yield* prunePinnedRuntimes({ baseDir, keep: ["2.0.0"] }).pipe(
        Effect.provideService(ProcessRunner.ProcessRunner, lsofRunner(lsof)),
        Effect.provideService(HostProcess.Platform, "darwin"),
        Effect.provideService(HostProcess.Environment, { SUPATERM_INSTALL_BIN_DIR: baseDir }),
      );
      assert.deepEqual(removed, []);
      assert.deepEqual(yield* fs.readDirectory(versionsDir), ["1.0.0"]);
    }),
  );

  it.effect.skipIf(HostProcess.Platform.defaultValue() !== "linux")(
    "keeps a runtime a process runs through a symlink",
    () =>
      Effect.gen(function* () {
        const fs = yield* FileSystem.FileSystem;
        const path = yield* Path.Path;
        const { baseDir, versionsDir } = yield* setup(["1.0.0", "1.1.0"]);
        const entry = path.join(versionsDir, "1.0.0", "supaterm");
        yield* fs.copyFile(process.execPath, entry);
        yield* fs.chmod(entry, 0o755);
        const link = path.join(baseDir, "supaterm");
        yield* fs.symlink(entry, link);
        const spawner = yield* ChildProcessSpawner.ChildProcessSpawner;
        yield* spawner.spawn(ChildProcess.make(link, ["-e", "setTimeout(() => {}, 30_000)"]));
        yield* fs.remove(link);

        const removed = yield* prunePinnedRuntimes({ baseDir, keep: ["2.0.0"] }).pipe(
          Effect.provideService(HostProcess.Platform, "linux"),
          Effect.provideService(HostProcess.Environment, { SUPATERM_INSTALL_BIN_DIR: baseDir }),
          Effect.provide(ProcessRunner.layer),
        );
        assert.deepEqual(removed, ["1.1.0"]);
      }),
  );
});
