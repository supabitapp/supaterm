import * as NodeServices from "@effect/platform-node/NodeServices";
import { afterEach, beforeEach, expect, it } from "@effect/vitest";
import * as Deferred from "effect/Deferred";
import * as Effect from "effect/Effect";
import * as FileSystem from "effect/FileSystem";
import * as Option from "effect/Option";
import * as Path from "effect/Path";
import * as Ref from "effect/Ref";
import * as Sink from "effect/Sink";
import * as Stream from "effect/Stream";
import * as ChildProcessSpawner from "effect/process/ChildProcessSpawner";

import * as DesktopCliCommand from "./DesktopCliCommand.ts";
import * as DesktopCliShim from "./DesktopCliShim.ts";
import * as DesktopEnvironment from "./DesktopEnvironment.ts";

const environmentFor = (
  path: Path.Path,
  input: { home: string; baseDir: string; platform?: NodeJS.Platform; isPackaged?: boolean },
) =>
  DesktopEnvironment.DesktopEnvironment.of({
    path,
    platform: input.platform ?? "linux",
    isPackaged: input.isPackaged ?? true,
    homeDirectory: input.home,
    baseDir: input.baseDir,
    stateDir: path.join(input.baseDir, "userdata"),
    serverRoot: "/opt/Supaterm/resources/app.asar",
    appImagePath: Option.none(),
  } as unknown as DesktopEnvironment.DesktopEnvironment["Service"]);

const commandIn = (
  input: { home: string; baseDir?: string; platform?: NodeJS.Platform; isPackaged?: boolean },
  spawner?: ChildProcessSpawner.ChildProcessSpawner["Service"],
) =>
  Effect.gen(function* () {
    const path = yield* Path.Path;
    const fs = yield* FileSystem.FileSystem;
    const baseDir = input.baseDir ?? path.join(input.home, ".supaterm");
    yield* fs.makeDirectory(path.join(baseDir, "userdata"), { recursive: true });
    const make = DesktopCliCommand.make.pipe(
      Effect.provideService(
        DesktopEnvironment.DesktopEnvironment,
        environmentFor(path, { ...input, baseDir }),
      ),
    );
    return yield* spawner
      ? make.pipe(Effect.provideService(ChildProcessSpawner.ChildProcessSpawner, spawner))
      : make;
  });

const fakePowerShell = (initial: string) => {
  const registry = { path: initial, failReads: false, writes: 0 };
  const spawner = ChildProcessSpawner.make((command) =>
    Effect.sync(() => {
      const { options } = command as unknown as {
        readonly options: { readonly env?: Record<string, string> };
      };
      const env = options.env ?? {};
      let exitCode = 0;
      let stdout = "";
      if (env.SUPATERM_SET === "1") {
        registry.path = env.SUPATERM_PATH ?? "";
        registry.writes += 1;
      } else if (registry.failReads) {
        exitCode = 1;
      } else {
        stdout = Buffer.from(registry.path, "utf8").toString("base64");
      }
      return ChildProcessSpawner.makeHandle({
        pid: ChildProcessSpawner.ProcessId(1),
        exitCode: Effect.succeed(ChildProcessSpawner.ExitCode(exitCode)),
        isRunning: Effect.succeed(false),
        kill: () => Effect.void,
        unref: Effect.succeed(Effect.void),
        stdin: Sink.drain,
        stdout: Stream.make(new TextEncoder().encode(stdout)),
        stderr: Stream.empty,
        all: Stream.empty,
        getInputFd: () => Sink.drain,
        getOutputFd: () => Stream.empty,
      });
    }),
  );
  return { registry, spawner };
};

const machinePath = process.env.PATH;
beforeEach(() => {
  process.env.PATH = "";
});
afterEach(() => {
  process.env.PATH = machinePath;
});

it.layer(NodeServices.layer)("DesktopCliCommand", (it) => {
  it.effect("refreshes the launcher concurrently without losing an installation", () =>
    Effect.gen(function* () {
      const fs = yield* FileSystem.FileSystem;
      const path = yield* Path.Path;
      const home = yield* fs.makeTempDirectoryScoped();
      const environment = environmentFor(path, { home, baseDir: path.join(home, ".supaterm") });
      const launcher = DesktopCliShim.launcherPath(environment);
      const writes = yield* Ref.make(0);
      const written = yield* Deferred.make<void>();
      const installations = yield* Effect.all([DesktopCliShim.install, DesktopCliShim.install], {
        concurrency: 2,
      }).pipe(
        Effect.provideService(DesktopEnvironment.DesktopEnvironment, environment),
        Effect.provideService(FileSystem.FileSystem, {
          ...fs,
          writeFileString: (target, content, options) =>
            fs.writeFileString(target, content, options).pipe(
              Effect.andThen(
                Effect.gen(function* () {
                  if ((yield* Ref.updateAndGet(writes, (count) => count + 1)) === 2) {
                    yield* Deferred.succeed(written, undefined);
                  }
                  yield* Deferred.await(written);
                }),
              ),
            ),
        }),
      );

      expect(installations.map(Option.getOrNull)).toEqual([launcher, launcher]);
      expect(yield* fs.readFileString(launcher)).toContain(DesktopCliShim.MARKER);
      expect((yield* fs.stat(launcher)).mode & 0o777).toBe(0o755);
      expect(yield* fs.readDirectory(path.dirname(launcher))).toEqual(["supaterm"]);
    }).pipe(Effect.scoped),
  );

  it.effect.each(["linux", "win32"] as const)(
    "automatically installs on %s and remembers removal across restarts",
    (platform) =>
      Effect.gen(function* () {
        const fs = yield* FileSystem.FileSystem;
        const path = yield* Path.Path;
        const home = yield* fs.makeTempDirectoryScoped();
        const { registry, spawner } = fakePowerShell("C:\\Tools");
        if (platform === "linux") process.env.PATH = path.join(home, ".local", "bin");
        const command = yield* commandIn({ home, platform }, spawner);

        yield* command.installAutomatically;
        const installed = yield* command.state;
        expect(installed.installedPath).not.toBeNull();
        expect(installed.onPath).toBe(true);
        if (platform === "linux") {
          expect(yield* fs.readLink(installed.installedPath!)).toBe(
            path.join(home, ".supaterm", "bin", "supaterm"),
          );
        } else {
          expect(registry.path).toBe(`C:\\Tools;${path.dirname(installed.installedPath!)}`);
        }
        yield* command.installAutomatically;
        expect(yield* command.state).toEqual(installed);
        if (platform === "win32") expect(registry.writes).toBe(1);

        yield* command.uninstall;
        const restarted = yield* commandIn({ home, platform }, spawner);
        yield* restarted.installAutomatically;
        expect((yield* restarted.state).installedPath).toBeNull();
        if (platform === "win32") expect(registry.path).toBe("C:\\Tools");

        yield* restarted.install;
        const enabledAgain = yield* commandIn({ home, platform }, spawner);
        yield* enabledAgain.installAutomatically;
        expect(yield* enabledAgain.state).toEqual(installed);
      }).pipe(Effect.scoped),
  );

  it.effect.each(["linux", "win32"] as const)(
    "preserves an existing command on %s during automatic installation",
    (platform) =>
      Effect.gen(function* () {
        const fs = yield* FileSystem.FileSystem;
        const path = yield* Path.Path;
        const home = yield* fs.makeTempDirectoryScoped();
        const directory = path.join(home, "other-cli");
        const theirs = path.join(directory, platform === "win32" ? "supaterm.cmd" : "supaterm");
        yield* fs.makeDirectory(directory);
        yield* fs.writeFileString(theirs, "existing supaterm\n", { mode: 0o755 });
        process.env.PATH = directory;
        const { registry, spawner } = fakePowerShell(directory);
        const command = yield* commandIn({ home, platform }, spawner);

        yield* command.installAutomatically;
        expect((yield* command.state).installedPath).toBeNull();
        expect((yield* command.state).shadowedBy?.toLowerCase()).toBe(theirs.toLowerCase());
        expect(yield* fs.readFileString(theirs)).toBe("existing supaterm\n");
        expect(yield* fs.exists(path.join(home, ".supaterm", "bin"))).toBe(false);
        expect(registry).toMatchObject({ path: directory, writes: 0 });
      }).pipe(Effect.scoped),
  );

  it.effect("continues startup when its launcher cannot be installed", () =>
    Effect.gen(function* () {
      const fs = yield* FileSystem.FileSystem;
      const path = yield* Path.Path;
      const home = yield* fs.makeTempDirectoryScoped();
      const launcher = path.join(home, ".supaterm", "bin", "supaterm");
      yield* fs.makeDirectory(path.dirname(launcher), { recursive: true });
      yield* fs.writeFileString(launcher, "user-owned launcher\n");
      const command = yield* commandIn({ home });

      yield* command.installAutomatically;
      expect((yield* command.state).installedPath).toBeNull();
      expect(yield* fs.readFileString(launcher)).toBe("user-owned launcher\n");
    }).pipe(Effect.scoped),
  );

  it.effect("links the launcher onto PATH and removes only that link", () =>
    Effect.gen(function* () {
      const fs = yield* FileSystem.FileSystem;
      const path = yield* Path.Path;
      const home = yield* fs.makeTempDirectoryScoped();
      const command = yield* commandIn({ home });
      const link = path.join(home, ".local", "bin", "supaterm");

      expect(yield* command.state).toEqual({ supported: true, installedPath: null, onPath: false });

      const installed = yield* command.install;
      expect(installed.installedPath).toBe(link);
      expect(yield* fs.readLink(link)).toBe(path.join(home, ".supaterm", "bin", "supaterm"));
      expect((yield* command.install).installedPath).toBe(link);

      expect((yield* command.uninstall).installedPath).toBeNull();
      expect(yield* fs.exists(link)).toBe(false);

      expect(yield* fs.exists(path.join(home, ".supaterm", "bin", "supaterm"))).toBe(true);
    }).pipe(Effect.scoped),
  );

  it.effect("never replaces or removes a supaterm it did not create", () =>
    Effect.gen(function* () {
      const fs = yield* FileSystem.FileSystem;
      const path = yield* Path.Path;
      const home = yield* fs.makeTempDirectoryScoped();
      const command = yield* commandIn({ home });
      const theirs = path.join(home, ".local", "bin", "supaterm");
      yield* fs.makeDirectory(path.dirname(theirs), { recursive: true });
      yield* fs.writeFileString(theirs, "npm's supaterm\n");

      yield* fs.makeDirectory(path.join(home, "bin"), { recursive: true });
      yield* fs.symlink(path.join(home, "gone"), path.join(home, "bin", "supaterm"));

      const error = yield* Effect.flip(command.install);
      expect(error.message).toContain("Another supaterm command is already installed");
      yield* command.uninstall;
      expect(yield* fs.readFileString(theirs)).toBe("npm's supaterm\n");
      expect(yield* fs.readLink(path.join(home, "bin", "supaterm"))).toBe(path.join(home, "gone"));
    }).pipe(Effect.scoped),
  );

  it.effect("finds and removes a link left by a previous Supaterm home", () =>
    Effect.gen(function* () {
      const fs = yield* FileSystem.FileSystem;
      const path = yield* Path.Path;
      const home = yield* fs.makeTempDirectoryScoped();
      const before = yield* commandIn({ home, baseDir: path.join(home, "old-supaterm") });
      const link = (yield* before.install).installedPath;

      const after = yield* commandIn({ home, baseDir: path.join(home, "new-supaterm") });
      expect((yield* after.state).installedPath).toBe(link);

      expect((yield* after.install).installedPath).toBe(link);
      expect(yield* fs.readLink(link!)).toBe(path.join(home, "new-supaterm", "bin", "supaterm"));
      yield* after.uninstall;
      expect(yield* fs.exists(path.join(home, ".local", "bin", "supaterm"))).toBe(false);
      expect(yield* fs.exists(path.join(home, "bin", "supaterm"))).toBe(false);
    }).pipe(Effect.scoped),
  );

  it.effect("refuses to install behind another supaterm that runs first", () =>
    Effect.gen(function* () {
      const fs = yield* FileSystem.FileSystem;
      const path = yield* Path.Path;
      const home = yield* fs.makeTempDirectoryScoped();
      const shadow = path.join(home, "shadow");
      yield* fs.makeDirectory(shadow);
      yield* fs.writeFileString(path.join(shadow, "supaterm"), "#!/bin/sh\n", { mode: 0o755 });
      process.env.PATH = [shadow, path.join(home, ".local", "bin")].join(":");

      const command = yield* commandIn({ home });
      const theirs = path.join(shadow, "supaterm");
      expect((yield* command.state).shadowedBy).toBe(theirs);

      const error = yield* Effect.flip(command.install);
      expect(error.message).toContain(theirs);
      expect(yield* fs.exists(path.join(home, ".local", "bin", "supaterm"))).toBe(false);

      yield* fs.remove(theirs);
      const installed = yield* command.install;
      expect(installed).toMatchObject({
        onPath: true,
        installedPath: path.join(home, ".local", "bin", "supaterm"),
      });
      expect(installed.shadowedBy).toBeUndefined();
    }).pipe(Effect.scoped),
  );

  it.effect.each(["directory", "non-executable"])(
    "ignores an earlier %s path when looking for an executable command",
    (kind) =>
      Effect.gen(function* () {
        const fs = yield* FileSystem.FileSystem;
        const path = yield* Path.Path;
        const home = yield* fs.makeTempDirectoryScoped();
        const shadow = path.join(home, "shadow");
        yield* fs.makeDirectory(shadow);
        const candidate = path.join(shadow, "supaterm");
        if (kind === "directory") yield* fs.makeDirectory(candidate);
        else yield* fs.writeFileString(candidate, "plain text", { mode: 0o644 });
        process.env.PATH = [shadow, path.join(home, ".local", "bin")].join(":");
        const command = yield* commandIn({ home });
        const installed = yield* command.install;
        expect(installed.onPath).toBe(true);
        expect(installed.shadowedBy).toBeUndefined();
        expect(installed.installedPath).toBe(path.join(home, ".local", "bin", "supaterm"));
      }).pipe(Effect.scoped),
  );

  it.effect("leaves the Windows PATH alone when it cannot be read", () =>
    Effect.gen(function* () {
      const fs = yield* FileSystem.FileSystem;
      const home = yield* fs.makeTempDirectoryScoped();
      const userPath = "C:\\Users\\Me\\npm;%USERPROFILE%\\tools";
      const { registry, spawner } = fakePowerShell(userPath);
      const command = yield* commandIn({ home, platform: "win32" }, spawner);

      registry.failReads = true;
      yield* command.installAutomatically;
      const error = yield* Effect.flip(command.install);
      expect(error.message).toContain("left unchanged");
      expect(registry).toMatchObject({ path: userPath, writes: 0 });

      registry.failReads = false;
      const launcherDir = DesktopCliShim.launcherPath(
        environmentFor(yield* Path.Path, { home, baseDir: `${home}/.supaterm`, platform: "win32" }),
      ).replace(/[\\/]supaterm\.cmd$/, "");
      yield* command.install;
      expect(registry.path).toBe(`${userPath};${launcherDir}`);
      yield* command.uninstall;
      expect(registry.path).toBe(userPath);
    }).pipe(Effect.scoped),
  );

  it.effect("preserves a user-added duplicate after removing its Windows PATH entry", () =>
    Effect.gen(function* () {
      const fs = yield* FileSystem.FileSystem;
      const home = yield* fs.makeTempDirectoryScoped();
      const userPath = "C:\\Tools";
      const { registry, spawner } = fakePowerShell(userPath);
      const command = yield* commandIn({ home, platform: "win32" }, spawner);
      yield* command.install;
      const installedPath = registry.path;
      const binDirectory = installedPath.slice(userPath.length + 1);
      registry.path = `${installedPath};${binDirectory}`;
      yield* command.uninstall;
      expect(registry.path).toBe(installedPath);
      yield* command.uninstall;
      expect(registry.path).toBe(installedPath);
    }).pipe(Effect.scoped),
  );

  it.effect("does not claim or remove a Windows PATH entry the user added", () =>
    Effect.gen(function* () {
      const fs = yield* FileSystem.FileSystem;
      const path = yield* Path.Path;
      const home = yield* fs.makeTempDirectoryScoped();
      const launcherDir = path.dirname(
        DesktopCliShim.launcherPath(
          environmentFor(path, { home, baseDir: path.join(home, ".supaterm"), platform: "win32" }),
        ),
      );
      const userPath = `C:\\Tools;${launcherDir}`;
      const { registry, spawner } = fakePowerShell(userPath);
      const command = yield* commandIn({ home, platform: "win32" }, spawner);

      expect((yield* command.state).installedPath).toBeNull();
      yield* command.uninstall;
      expect(registry.path).toBe(userPath);
    }).pipe(Effect.scoped),
  );

  it.effect("offers nothing for a development build", () =>
    Effect.gen(function* () {
      const fs = yield* FileSystem.FileSystem;
      const path = yield* Path.Path;
      const home = yield* fs.makeTempDirectoryScoped();
      const command = yield* commandIn({
        home,
        isPackaged: false,
      });
      yield* command.installAutomatically;
      expect((yield* command.state).supported).toBe(false);
      expect(yield* fs.exists(path.join(home, ".supaterm", "bin"))).toBe(false);
    }).pipe(Effect.scoped),
  );
});
