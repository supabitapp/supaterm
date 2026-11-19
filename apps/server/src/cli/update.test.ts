import * as NodeServices from "@effect/platform-node/NodeServices";
import { assert, it } from "@effect/vitest";
import * as HostProcess from "@supaterm/shared/HostProcess";
import * as Duration from "effect/Duration";
import * as Effect from "effect/Effect";
import * as Exit from "effect/Exit";
import * as FileSystem from "effect/FileSystem";
import * as Layer from "effect/Layer";
import * as Option from "effect/Option";
import * as Path from "effect/Path";
import * as TestClock from "effect/testing/TestClock";
import * as TestConsole from "effect/testing/TestConsole";
import { HttpClient, HttpClientResponse } from "effect/http";
import * as ChildProcess from "effect/process/ChildProcess";
import * as ChildProcessSpawner from "effect/process/ChildProcessSpawner";

import packageJson from "../../package.json" with { type: "json" };
import * as BootService from "../service/bootService.ts";
import { SERVICE_LAUNCHER_PROTOCOL } from "../service/serviceProtocol.ts";
import {
  pinnedRuntimePaths,
  posixLauncherScript,
  prunePinnedRuntimes,
  readPosixLauncherTarget,
  resolveLauncherPath,
} from "../service/pinnedRuntime.ts";
import * as ProcessRunner from "../processRunner.ts";
import { repointLauncher, resolveNewestVersion, runUpdate } from "./update.ts";

const unrelatedLsof = ProcessRunner.ProcessRunner.of({
  run: () =>
    Effect.succeed({
      stdout: "p1\nftxt\nn/usr/bin/true\n",
      stderr: "",
      code: ChildProcessSpawner.ExitCode(0),
      timedOut: false,
      stdoutTruncated: false,
      stderrTruncated: false,
      stdoutInvalidUtf8: false,
      stderrInvalidUtf8: false,
    }),
});

it.effect("authenticates each release page until the requested channel is found", () =>
  Effect.gen(function* () {
    const pages: string[] = [];
    const httpClient = HttpClient.make((request) => {
      const url = new URL(request.url);
      assert.equal(url.origin, "https://api.github.com");
      assert.equal(url.pathname, "/repos/supabitapp/supaterm/releases");
      assert.equal(request.headers.accept, "application/vnd.github+json");
      assert.equal(request.headers.authorization, "Bearer gh-token");
      const page = url.searchParams.get("page") ?? "";
      pages.push(page);
      const tag_name = page === "1" ? "v1.2.4-preview.20260101.1" : "v1.2.3";
      return Effect.succeed(HttpClientResponse.fromWeb(request, Response.json([{ tag_name }])));
    });
    const version = yield* resolveNewestVersion("stable").pipe(
      Effect.provideService(HostProcess.Environment, { GH_TOKEN: "gh-token" }),
      Effect.provideService(HttpClient.HttpClient, httpClient),
    );
    assert.equal(version, "1.2.3");
    assert.deepStrictEqual(pages, ["1", "2"]);
  }),
);

it.layer(NodeServices.layer)("supaterm update launcher", (it) => {
  it.effect("replaces a legacy symlink with a script that execs the new version", () =>
    Effect.gen(function* () {
      const fs = yield* FileSystem.FileSystem;
      const path = yield* Path.Path;
      const root = yield* fs.makeTempDirectoryScoped({ prefix: "supaterm-update-" });
      const oldExe = path.join(root, "runtime/versions/1.0.0/supaterm");
      const newExe = path.join(root, "runtime/versions/2.0.0/supaterm");
      const launcher = path.join(root, "bin/supaterm");
      for (const file of [oldExe, newExe]) {
        yield* fs.makeDirectory(path.dirname(file), { recursive: true });
        yield* fs.writeFileString(file, "");
      }
      yield* fs.makeDirectory(path.dirname(launcher), { recursive: true });
      yield* fs.symlink(oldExe, launcher);

      const repointed = yield* repointLauncher({
        launchedAs: launcher,
        baseDir: root,
        targetEntryPath: newExe,
      });

      assert.deepStrictEqual(Option.getOrUndefined(repointed), launcher);
      assert.equal(yield* fs.readFileString(launcher), posixLauncherScript(newExe));
      assert.equal(yield* fs.readFileString(oldExe), "");
    }).pipe(Effect.scoped, Effect.provideService(HostProcess.Platform, "linux")),
  );

  it.effect.skipIf(HostProcess.Platform.defaultValue() === "win32")(
    "finds the script that ran this executable and rewrites it, keeping aliases and arguments",
    () =>
      Effect.gen(function* () {
        const fs = yield* FileSystem.FileSystem;
        const path = yield* Path.Path;
        const spawner = yield* ChildProcessSpawner.ChildProcessSpawner;
        const root = yield* fs.realPath(
          yield* fs.makeTempDirectoryScoped({ prefix: "supaterm-update-" }),
        );
        const home = path.join(root, "it's home");
        const entry = (version: string) => path.join(home, "runtime/versions", version, "supaterm");
        for (const version of ["1.0.0", "2.0.0"]) {
          yield* fs.makeDirectory(path.dirname(entry(version)), { recursive: true });
          yield* fs.writeFileString(entry(version), '#!/bin/sh\nprintf \'[%s]\\n\' "$0" "$@"\n', {
            mode: 0o755,
          });
        }
        const launcher = path.join(root, "bin/supaterm");
        const alias = path.join(root, "alias/supaterm");
        yield* fs.makeDirectory(path.dirname(launcher), { recursive: true });
        yield* fs.makeDirectory(path.dirname(alias), { recursive: true });
        yield* fs.writeFileString(launcher, posixLauncherScript(entry("1.0.0")), { mode: 0o755 });
        yield* fs.symlink(launcher, alias);
        const repoint = (environment: Record<string, string>) =>
          repointLauncher({
            launchedAs: entry("1.0.0"),
            baseDir: home,
            targetEntryPath: entry("2.0.0"),
          }).pipe(Effect.provideService(HostProcess.Environment, environment));

        assert.equal(
          Option.getOrUndefined(yield* repoint({ PATH: path.dirname(alias) })),
          launcher,
        );
        assert.equal(yield* fs.readLink(alias), launcher);
        const args = ["two words", "it's quoted", "", "*", "$HOME"];
        assert.equal(
          yield* spawner.string(ChildProcess.make(alias, args, { cwd: root })),
          [entry("2.0.0"), ...args].map((arg) => `[${arg}]\n`).join(""),
        );

        const unrunnable = path.join(root, "unrunnable/supaterm");
        yield* fs.makeDirectory(path.dirname(unrunnable), { recursive: true });
        yield* fs.writeFileString(unrunnable, posixLauncherScript(entry("2.0.0")), { mode: 0o644 });
        yield* fs.writeFileString(launcher, posixLauncherScript(entry("2.0.0")), { mode: 0o755 });
        const relative = yield* repointLauncher({
          launchedAs: entry("2.0.0"),
          baseDir: home,
          targetEntryPath: entry("1.0.0"),
        }).pipe(
          Effect.provideService(HostProcess.Environment, {
            PATH: `${path.dirname(unrunnable)}:bin`,
          }),
          Effect.provideService(HostProcess.WorkingDirectory, root),
        );
        assert.equal(Option.getOrUndefined(relative), launcher);
        assert.equal(yield* fs.readFileString(unrunnable), posixLauncherScript(entry("2.0.0")));

        const edited = `${posixLauncherScript(entry("1.0.0"))}# mine\n`;
        yield* fs.writeFileString(launcher, edited);
        assert.isTrue(Option.isNone(yield* repoint({ PATH: path.dirname(launcher) })));
        assert.equal(yield* fs.readFileString(launcher), edited);
      }).pipe(Effect.scoped, Effect.provideService(HostProcess.Platform, "linux")),
  );

  it.effect.each([
    { name: "no launcher records", recorded: undefined },
    { name: "an empty launcher record", recorded: "" },
    { name: "whole launcher records", recorded: "/opt/supaterm\n" },
    { name: "Windows launcher records", recorded: "C:\\supaterm.cmd\r\n" },
    { name: "an unterminated launcher record", recorded: "/opt/supa" },
    { name: "a record cut short after the read", recorded: "/opt/supaterm\n", cut: "/opt/supa" },
  ])("keeps the runtime a repointed launcher off PATH points at with $name", ({ recorded, cut }) =>
    Effect.gen(function* () {
      const fs = yield* FileSystem.FileSystem;
      const path = yield* Path.Path;
      const root = yield* fs.makeTempDirectoryScoped({ prefix: "supaterm-update-" });
      yield* TestClock.setTime(Duration.toMillis(Duration.days(1)));
      for (const version of ["1.0.0", "2.0.0"]) {
        const directory = path.join(root, "runtime/versions", version);
        yield* fs.makeDirectory(directory, { recursive: true });
        yield* fs.writeFileString(path.join(directory, "supaterm"), "");
        yield* fs.writeFileString(path.join(directory, ".install-complete"), `${version}\n`);
        yield* fs.utimes(path.join(directory, ".install-complete"), 0, 0);
      }
      if (recorded !== undefined) {
        yield* fs.writeFileString(path.join(root, "runtime/launchers"), recorded);
      }
      const launcher = path.join(root, "supaterm");
      yield* fs.symlink(path.join(root, "runtime/versions/1.0.0/supaterm"), launcher);

      const launchersFile = path.join(root, "runtime/launchers");
      yield* repointLauncher({
        launchedAs: launcher,
        baseDir: root,
        targetEntryPath: path.join(root, "runtime/versions/2.0.0/supaterm"),
      }).pipe(
        Effect.provideService(FileSystem.FileSystem, {
          ...fs,
          readFileString: (file, encoding) =>
            fs
              .readFileString(file, encoding)
              .pipe(
                Effect.tap(() =>
                  cut === undefined || file !== launchersFile
                    ? Effect.void
                    : fs.writeFileString(file, cut, { flag: "a" }),
                ),
              ),
        }),
      );
      const removed = yield* prunePinnedRuntimes({ baseDir: root, keep: [] }).pipe(
        Effect.provideService(ProcessRunner.ProcessRunner, unrelatedLsof),
        Effect.provideService(HostProcess.Platform, "darwin"),
        Effect.provideService(HostProcess.Environment, { PATH: "" }),
        Effect.provideService(HostProcess.HomeDirectory, root),
      );

      assert.deepStrictEqual(removed, ["1.0.0"]);
      assert.equal(
        yield* readPosixLauncherTarget(launcher),
        path.join(root, "runtime/versions/2.0.0/supaterm"),
      );
    }).pipe(Effect.provideService(HostProcess.Platform, "linux")),
  );

  const launcherFixture = Effect.fnUntraced(function* () {
    const fs = yield* FileSystem.FileSystem;
    const path = yield* Path.Path;
    const root = yield* fs.makeTempDirectoryScoped({ prefix: "supaterm-update-" });
    const oldExe = path.join(root, "runtime/versions/1.0.0/supaterm");
    const newExe = path.join(root, "runtime/versions/2.0.0/supaterm");
    const launcher = path.join(root, "supaterm");
    for (const file of [oldExe, newExe]) {
      yield* fs.makeDirectory(path.dirname(file), { recursive: true });
      yield* fs.writeFileString(file, "");
    }
    yield* fs.symlink(oldExe, launcher);
    return { root, oldExe, newExe, launcher, launchersFile: path.join(root, "runtime/launchers") };
  });

  it.effect("records a relative launcher path as absolute", () =>
    Effect.gen(function* () {
      const fs = yield* FileSystem.FileSystem;
      const path = yield* Path.Path;
      const { root, newExe, launcher, launchersFile } = yield* launcherFixture();

      yield* repointLauncher({
        launchedAs: path.relative(path.resolve("."), launcher),
        baseDir: root,
        targetEntryPath: newExe,
      });

      assert.equal(yield* fs.readFileString(launchersFile), `\n${launcher}\n`);
    }).pipe(Effect.provideService(HostProcess.Platform, "linux")),
  );

  it.effect("fails instead of repointing a launcher it cannot record", () =>
    Effect.gen(function* () {
      const fs = yield* FileSystem.FileSystem;
      const { root, oldExe, newExe, launcher, launchersFile } = yield* launcherFixture();
      yield* fs.makeDirectory(launchersFile);

      const result = yield* repointLauncher({
        launchedAs: launcher,
        baseDir: root,
        targetEntryPath: newExe,
      }).pipe(Effect.exit);

      assert.isTrue(Exit.isFailure(result));
      assert.equal(yield* fs.readLink(launcher), oldExe);
    }).pipe(Effect.provideService(HostProcess.Platform, "linux")),
  );

  it.effect.each(["recording", "repointing"] as const)(
    "never leaves a repointed launcher unrecorded when supaterm update dies while %s",
    (step) =>
      Effect.gen(function* () {
        const fs = yield* FileSystem.FileSystem;
        const { root, newExe, launcher, launchersFile } = yield* launcherFixture();

        yield* repointLauncher({
          launchedAs: launcher,
          baseDir: root,
          targetEntryPath: newExe,
        }).pipe(
          Effect.provideService(FileSystem.FileSystem, {
            ...fs,
            writeFileString: (path, data, options) =>
              step === "recording" && path === launchersFile
                ? Effect.die("supaterm update was killed")
                : fs.writeFileString(path, data, options),
            rename: (from, to) =>
              step === "repointing" && to === launcher
                ? Effect.die("supaterm update was killed")
                : fs.rename(from, to),
          }),
          Effect.exit,
        );

        const repointed = (yield* readPosixLauncherTarget(launcher)) === newExe;
        const recorded = (yield* fs
          .readFileString(launchersFile)
          .pipe(Effect.orElseSucceed(() => "")))
          .split("\n")
          .includes(launcher);
        assert.isFalse(repointed && !recorded);
      }).pipe(Effect.provideService(HostProcess.Platform, "linux")),
  );

  it.effect("leaves a plain copy or a foreign symlink alone", () =>
    Effect.gen(function* () {
      const fs = yield* FileSystem.FileSystem;
      const path = yield* Path.Path;
      const root = yield* fs.makeTempDirectoryScoped({ prefix: "supaterm-update-" });
      const newExe = path.join(root, "runtime/versions/2.0.0/supaterm");
      const copy = path.join(root, "copy/supaterm");
      const foreign = path.join(root, "foreign/supaterm");
      const elsewhere = path.join(root, "elsewhere/supaterm");
      const otherHome = path.join(root, "other/runtime/versions/1.0.0/supaterm");
      const otherLauncher = path.join(root, "other/bin/supaterm");
      for (const file of [newExe, copy, elsewhere, otherHome]) {
        yield* fs.makeDirectory(path.dirname(file), { recursive: true });
        yield* fs.writeFileString(file, "");
      }
      yield* fs.makeDirectory(path.dirname(foreign), { recursive: true });
      yield* fs.symlink(elsewhere, foreign);
      yield* fs.makeDirectory(path.dirname(otherLauncher), { recursive: true });
      yield* fs.symlink(otherHome, otherLauncher);

      for (const launchedAs of [copy, foreign, otherLauncher, undefined]) {
        const repointed = yield* repointLauncher({
          launchedAs,
          baseDir: root,
          targetEntryPath: newExe,
        });
        assert.equal(repointed._tag, "None", launchedAs ?? "undefined");
      }
      assert.equal(yield* fs.readLink(foreign), elsewhere);
      assert.equal(yield* fs.readLink(otherLauncher), otherHome);
    }).pipe(Effect.provideService(HostProcess.Platform, "linux")),
  );

  it.effect("finds the launcher a bare command name resolved to on PATH", () =>
    Effect.gen(function* () {
      const fs = yield* FileSystem.FileSystem;
      const path = yield* Path.Path;
      const delimiter = (yield* HostProcess.Platform) === "win32" ? ";" : ":";
      const root = yield* fs.makeTempDirectoryScoped({ prefix: "supaterm-update-" });
      const launcher = path.join(root, "bin/supaterm");
      yield* fs.makeDirectory(path.dirname(launcher), { recursive: true });
      yield* fs.writeFileString(launcher, "", { mode: 0o755 });

      const bare = yield* resolveLauncherPath.pipe(
        Effect.provideService(HostProcess.InvokedAs, "supaterm"),
        Effect.provideService(HostProcess.Environment, {
          PATH: [path.join(root, "missing"), path.join(root, "bin")].join(delimiter),
        }),
        Effect.provideService(HostProcess.WorkingDirectory, root),
      );
      const relative = yield* resolveLauncherPath.pipe(
        Effect.provideService(HostProcess.InvokedAs, "./bin/supaterm"),
        Effect.provideService(HostProcess.Environment, { PATH: "" }),
        Effect.provideService(HostProcess.WorkingDirectory, root),
      );
      const absent = yield* resolveLauncherPath.pipe(
        Effect.provideService(HostProcess.InvokedAs, "supaterm"),
        Effect.provideService(HostProcess.Environment, { PATH: path.join(root, "missing") }),
        Effect.provideService(HostProcess.WorkingDirectory, root),
      );

      assert.equal(bare, launcher);
      assert.equal(relative, launcher);
      assert.equal(absent, undefined);
    }),
  );
});

const withoutTerminals = Effect.acquireRelease(
  Effect.sync(() =>
    [process.stdin, process.stdout].map((stream) => {
      const descriptor = Object.getOwnPropertyDescriptor(stream, "isTTY");
      Object.defineProperty(stream, "isTTY", { configurable: true, value: false });
      return { stream, descriptor };
    }),
  ),
  (saved) =>
    Effect.sync(() => {
      for (const { stream, descriptor } of saved) {
        if (descriptor === undefined) Reflect.deleteProperty(stream, "isTTY");
        else Object.defineProperty(stream, "isTTY", descriptor);
      }
    }),
);

it.layer(NodeServices.layer)("supaterm update with a background service", (it) => {
  it.effect("names the version a service with a pending restart still runs", () =>
    Effect.gen(function* () {
      yield* withoutTerminals;
      const fs = yield* FileSystem.FileSystem;
      const path = yield* Path.Path;
      const baseDir = yield* fs.makeTempDirectoryScoped({ prefix: "supaterm-update-" });
      const version = packageJson.version;
      const runtime = pinnedRuntimePaths(path, baseDir, version, "linux");
      yield* fs.makeDirectory(runtime.versionDir, { recursive: true });
      yield* fs.writeFileString(runtime.entryPath, "");
      yield* fs.writeFileString(runtime.sentinelPath, `${version}\n`);
      const unitPath = path.join(baseDir, "supaterm.service");
      const logPath = path.join(baseDir, "boot-service.log");
      const service = Layer.mock(BootService.BootService, {
        status: Effect.succeed<BootService.BootServiceStatus>({
          supported: true,
          installed: true,
          current: false,
          installedVersion: version,
          installedBaseDir: baseDir,
          problems: ["restart-pending"],
          unitPath,
          logPath,
        }),
        install: () => Effect.succeed({ program: [runtime.entryPath], baseDir, unitPath, logPath }),
      });
      const bootService = yield* BootService.BootService.pipe(Effect.provide(service));
      const runner = ProcessRunner.ProcessRunner.of({
        run: (input) =>
          input.args?.includes("__service-preflight") === true
            ? unrelatedLsof.run(input).pipe(
                Effect.map((result) => ({
                  ...result,
                  stdout: JSON.stringify({
                    status: "ready",
                    version,
                    launcherProtocol: SERVICE_LAUNCHER_PROTOCOL,
                  }),
                })),
              )
            : unrelatedLsof.run(input),
      });

      const output = yield* runUpdate({
        baseDir,
        logsDir: baseDir,
        databasePath: path.join(baseDir, "statev2.sqlite"),
        serverRuntimeStatePath: path.join(baseDir, "server-runtime.json"),
        channel: undefined,
        requestedVersion: version,
        allowDowngrade: false,
        assumeYes: false,
      }).pipe(
        Effect.andThen(TestConsole.logLines),
        Effect.map((lines) => lines.join("\n")),
        Effect.provide(
          Layer.mergeAll(
            service,
            Layer.succeed(ProcessRunner.ProcessRunner, runner),
            Layer.succeed(
              HttpClient.HttpClient,
              HttpClient.make(() => Effect.die("unexpected release lookup")),
            ),
            Layer.fresh(TestConsole.layer),
          ),
        ),
        Effect.provideService(BootService.ProvidedBootService, bootService),
      );

      assert.include(
        output,
        `Background service still running the version before ${version}. Run \`supaterm service restart\` when you are ready to switch it to ${version}.`,
      );
    }).pipe(
      Effect.provideService(HostProcess.Platform, "linux"),
      Effect.provideService(HostProcess.Environment, { PATH: "" }),
    ),
  );
});

it.layer(NodeServices.layer)("supaterm update checks the database before switching", (it) => {
  const preflightOutput = (stdout: string, code = 0) => ({
    stdout,
    stderr: code === 0 ? "" : "Unknown command: __service-preflight",
    code: ChildProcessSpawner.ExitCode(code),
    timedOut: false,
    stdoutTruncated: false,
    stderrTruncated: false,
    stdoutInvalidUtf8: false,
    stderrInvalidUtf8: false,
  });
  const blockedReason =
    "This database has migrations that supaterm@0.1.8 does not know: 79_example.";

  it.effect.each([
    {
      name: "installs an older target that accepts this database",
      targetVersion: "0.1.8",
      launcherProtocol: 3,
      preflight: preflightOutput(
        JSON.stringify({ status: "ready", version: "0.1.8", launcherProtocol: 3 }),
      ),
      failure: undefined,
    },
    {
      name: "refuses an older target the database is too new for",
      targetVersion: "0.1.8",
      launcherProtocol: 3,
      preflight: preflightOutput(
        JSON.stringify({ status: "blocked", version: "0.1.8", reason: blockedReason }),
      ),
      failure: blockedReason,
    },
    {
      name: "refuses an older target too old to check the database",
      targetVersion: "0.1.8",
      launcherProtocol: 3,
      preflight: preflightOutput("", 1),
      failure:
        "supaterm@0.1.8 could not confirm it supports this database (its check exited with code 1), so supaterm did not switch to it.",
    },
    {
      name: "checks a newer target with the current launcher protocol",
      targetVersion: "99.0.0",
      launcherProtocol: SERVICE_LAUNCHER_PROTOCOL,
      preflight: preflightOutput(
        JSON.stringify({
          status: "ready",
          version: "99.0.0",
          launcherProtocol: SERVICE_LAUNCHER_PROTOCOL,
        }),
      ),
      failure: undefined,
    },
  ])("$name", ({ targetVersion, launcherProtocol, preflight, failure }) =>
    Effect.gen(function* () {
      yield* withoutTerminals;
      const fs = yield* FileSystem.FileSystem;
      const path = yield* Path.Path;
      const baseDir = yield* fs.makeTempDirectoryScoped({ prefix: "supaterm-update-" });
      const databasePath = path.join(baseDir, "userdata", "statev2.sqlite");
      const runtime = pinnedRuntimePaths(path, baseDir, targetVersion, "linux");
      yield* fs.makeDirectory(runtime.versionDir, { recursive: true });
      yield* fs.writeFileString(runtime.entryPath, "");
      yield* fs.writeFileString(runtime.sentinelPath, `${targetVersion}\n`);
      const service = Layer.mock(BootService.BootService, {
        status: Effect.succeed<BootService.BootServiceStatus>({
          supported: true,
          installed: false,
          current: false,
          unitPath: path.join(baseDir, "supaterm.service"),
          logPath: path.join(baseDir, "boot-service.log"),
        }),
      });
      const preflightArgs: Array<ReadonlyArray<string>> = [];
      const runner = ProcessRunner.ProcessRunner.of({
        run: (input) => {
          if (input.args?.includes("__service-preflight") === true) {
            preflightArgs.push(input.args);
            return Effect.succeed(preflight);
          }
          return input.args?.includes("--version") === true
            ? Effect.succeed(preflightOutput(`supaterm v${targetVersion}\n`))
            : unrelatedLsof.run(input);
        },
      });

      const exit = yield* runUpdate({
        baseDir,
        logsDir: baseDir,
        databasePath,
        serverRuntimeStatePath: path.join(baseDir, "server-runtime.json"),
        channel: undefined,
        requestedVersion: targetVersion,
        allowDowngrade: true,
        assumeYes: true,
      }).pipe(
        Effect.exit,
        Effect.provide(
          Layer.mergeAll(
            service,
            Layer.succeed(ProcessRunner.ProcessRunner, runner),
            Layer.succeed(
              HttpClient.HttpClient,
              HttpClient.make(() => Effect.die("unexpected release lookup")),
            ),
            Layer.fresh(TestConsole.layer),
          ),
        ),
      );

      const error = Option.getOrUndefined(Exit.findErrorOption(exit));
      assert.equal(error?.message, failure);
      assert.equal(Exit.isSuccess(exit), failure === undefined);
      assert.deepEqual(preflightArgs, [
        [
          "__service-preflight",
          "--database-path",
          databasePath,
          "--launcher-protocol",
          String(launcherProtocol),
        ],
      ]);
    }).pipe(
      Effect.provideService(HostProcess.Platform, "linux"),
      Effect.provideService(HostProcess.Environment, { PATH: "" }),
    ),
  );
});
