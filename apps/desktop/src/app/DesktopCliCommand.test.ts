import * as NodeServices from "@effect/platform-node/NodeServices";
import { afterEach, beforeEach, expect, it } from "@effect/vitest";
import * as Deferred from "effect/Deferred";
import * as HostProcess from "@supaterm/shared/HostProcess";
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

/** `inherited` stands in for the app's own environment, which `extendEnv` passes on. */
const fakePowerShell = (initial: string, inherited: Record<string, string> = {}) => {
  const registry = { path: initial, failReads: false, writes: 0, commands: [] as Array<string> };
  const spawner = ChildProcessSpawner.make((command) =>
    Effect.sync(() => {
      const { options, command: executable } = command as unknown as {
        readonly command: string;
        readonly options: { readonly env?: Record<string, string>; readonly extendEnv?: boolean };
      };
      registry.commands.push(executable);
      const env = { ...(options.extendEnv ? inherited : {}), ...options.env };
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

const SHELL_ENV_NAMES = ["PATH", "SHELL", "ZDOTDIR", "XDG_CONFIG_HOME"] as const;
const machineEnv = SHELL_ENV_NAMES.map((name) => [name, process.env[name]] as const);
beforeEach(() => {
  process.env.PATH = "";
  process.env.SHELL = "/bin/zsh";
  delete process.env.ZDOTDIR;
  delete process.env.XDG_CONFIG_HOME;
});
afterEach(() => {
  for (const [name, value] of machineEnv) {
    if (value === undefined) delete process.env[name];
    else process.env[name] = value;
  }
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

      expect(yield* command.state).toEqual({
        supported: true,
        installedPath: null,
        onPath: false,
        launcherPath: null,
      });
      const installed = yield* command.install;
      expect(installed.installedPath).toBe(link);
      expect(installed.launcherPath).toBe(path.join(home, ".supaterm", "bin", "supaterm"));
      expect(installed.pathSetup).toEqual({ file: "~/.zshrc", added: false });
      expect(yield* fs.readLink(link)).toBe(path.join(home, ".supaterm", "bin", "supaterm"));
      expect((yield* command.install).installedPath).toBe(link);

      // Add to PATH appends one line, once, and keeps a final line with no newline intact.
      const zshrc = path.join(home, ".zshrc");
      yield* fs.writeFileString(zshrc, "# mine");
      // A folder already on PATH needs nothing.
      process.env.PATH = path.join(home, ".local", "bin");
      yield* command.addToPath;
      expect(yield* fs.readFileString(zshrc)).toBe("# mine");
      process.env.PATH = "";
      yield* Effect.all([command.addToPath, command.addToPath], { concurrency: "unbounded" });
      expect((yield* command.addToPath).pathSetup).toEqual({ file: "~/.zshrc", added: true });
      expect(yield* fs.readFileString(zshrc)).toBe(
        '# mine\n# Added by Supaterm\nexport PATH="$PATH:$HOME/.local/bin"\n',
      );

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
      expect(error.message).toContain("Another supaterm command is already in");
      yield* command.uninstall;
      expect(yield* fs.readFileString(theirs)).toBe("npm's supaterm\n");
      expect(yield* fs.readLink(path.join(home, "bin", "supaterm"))).toBe(path.join(home, "gone"));

      // Installing automatically beside someone else's supaterm (even off PATH or a dangling link)
      // adds no second supaterm in ~/bin.
      for (const dangling of [false, true]) {
        const besideHome = yield* fs.makeTempDirectoryScoped();
        const other = path.join(besideHome, ".local", "bin", "supaterm");
        yield* fs.makeDirectory(path.dirname(other), { recursive: true });
        yield* dangling
          ? fs.symlink(path.join(besideHome, "gone"), other)
          : fs.writeFileString(other, "npm's supaterm\n");
        yield* (yield* commandIn({ home: besideHome })).installAutomatically;
        expect(yield* fs.exists(path.join(besideHome, "bin", "supaterm"))).toBe(false);
      }

      const launcher = path.join(home, ".supaterm", "bin", "supaterm");
      yield* fs.writeFileString(launcher, "npm's supaterm\n");
      process.env.PATH = path.dirname(launcher);
      expect(yield* command.state).toMatchObject({ onPath: false, shadowedBy: launcher });
      expect((yield* Effect.flip(command.install)).message).toContain("Could not set up");
      yield* command.uninstall;
      expect(yield* fs.readFileString(launcher)).toBe("npm's supaterm\n");
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
      // Installing automatically leaves another home's command alone; only Install takes it over.
      yield* after.installAutomatically;
      expect(yield* fs.readLink(link!)).toBe(path.join(home, "old-supaterm", "bin", "supaterm"));
      // On PATH, it runs the other home's launcher. Settings offers Install (not Remove, and not
      // "another supaterm runs first"), which updates that link in place.
      process.env.PATH = path.dirname(link!);
      expect(yield* after.state).toMatchObject({ installedPath: null, onPath: false });
      expect((yield* after.state).shadowedBy).toBeUndefined();
      process.env.PATH = "";
      // Off PATH, Add to PATH would expose the other home's command, not this one.
      expect((yield* after.state).pathSetup).toBeUndefined();
      yield* Effect.flip(after.addToPath);
      expect(yield* fs.exists(path.join(home, ".zshrc"))).toBe(false);
      // Behind another supaterm the install fails, and the old link still works.
      const shadow = path.join(home, "shadow");
      yield* fs.makeDirectory(shadow);
      yield* fs.writeFileString(path.join(shadow, "supaterm"), "#!/bin/sh\n", { mode: 0o755 });
      process.env.PATH = shadow;
      yield* Effect.flip(after.install);
      expect(yield* fs.readLink(link!)).toBe(path.join(home, "old-supaterm", "bin", "supaterm"));
      // Install takes it over, also with its folder first on PATH.
      process.env.PATH = path.dirname(link!);
      expect((yield* after.install).installedPath).toBe(link);
      expect(yield* fs.readLink(link!)).toBe(path.join(home, "new-supaterm", "bin", "supaterm"));
      process.env.PATH = "";
      yield* after.uninstall;
      expect(yield* fs.exists(path.join(home, ".local", "bin", "supaterm"))).toBe(false);
      expect(yield* fs.exists(path.join(home, "bin", "supaterm"))).toBe(false);

      // A folder already on PATH wins, even written with a trailing slash.
      process.env.PATH = `${path.join(home, "bin")}/`;
      expect((yield* after.install).installedPath).toBe(path.join(home, "bin", "supaterm"));

      // An old link of ours is updated where it is, not moved to a folder that may be off PATH.
      yield* fs.writeFileString(path.join(home, "bin", "supaterm.staging"), "mine");
      yield* fs.remove(path.join(home, "bin", "supaterm"));
      yield* fs.symlink(
        path.join(home, "old-supaterm", "bin", "supaterm"),
        path.join(home, "bin", "supaterm"),
      );
      process.env.PATH = "";
      expect((yield* after.install).installedPath).toBe(path.join(home, "bin", "supaterm"));
      expect(yield* fs.readLink(path.join(home, "bin", "supaterm"))).toBe(
        path.join(home, "new-supaterm", "bin", "supaterm"),
      );
      expect(yield* fs.exists(path.join(home, ".local", "bin", "supaterm"))).toBe(false);
      expect(yield* fs.readFileString(path.join(home, "bin", "supaterm.staging"))).toBe("mine");
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
      process.env.PATH = [shadow, `${path.join(home, ".local", "bin")}/`].join(":");

      const command = yield* commandIn({ home });
      const theirs = path.join(shadow, "supaterm");
      expect((yield* command.state).shadowedBy).toBe(theirs);

      const error = yield* Effect.flip(command.install);
      expect(error.message).toContain(theirs);
      yield* command.installAutomatically;
      expect(yield* fs.exists(path.join(home, ".local", "bin", "supaterm"))).toBe(false);
      expect(yield* fs.readFileString(theirs)).toBe("#!/bin/sh\n");

      // Its folder is already on PATH behind theirs; adding it again would change which supaterm runs.
      yield* fs.makeDirectory(path.join(home, ".local", "bin"), { recursive: true });
      yield* fs.symlink(
        path.join(home, ".supaterm", "bin", "supaterm"),
        path.join(home, ".local", "bin", "supaterm"),
      );
      const behind = yield* command.state;
      expect(behind.installedPath).toBe(path.join(home, ".local", "bin", "supaterm"));
      expect(behind.pathSetup).toBeUndefined();
      // Off PATH behind theirs, adding the folder would still put ours first.
      process.env.PATH = shadow;
      expect((yield* command.state).pathSetup).toBeUndefined();
      yield* Effect.flip(command.addToPath);
      expect(yield* fs.exists(path.join(home, ".zshrc"))).toBe(false);
      process.env.PATH = [shadow, `${path.join(home, ".local", "bin")}/`].join(":");
      yield* fs.remove(path.join(home, ".local", "bin", "supaterm"));

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

  it.effect(
    "does not treat its own launcher as another supaterm when its folder is first on PATH",
    () =>
      Effect.gen(function* () {
        const fs = yield* FileSystem.FileSystem;
        const path = yield* Path.Path;
        const home = yield* fs.makeTempDirectoryScoped();
        const launcher = path.join(home, ".supaterm", "bin", "supaterm");
        process.env.PATH = [path.dirname(launcher), path.join(home, ".local", "bin")].join(":");

        const command = yield* commandIn({ home });
        const installed = yield* command.install;

        expect(yield* fs.exists(launcher)).toBe(true);
        expect(installed).toMatchObject({
          onPath: true,
          installedPath: path.join(home, ".local", "bin", "supaterm"),
        });
        expect(installed.shadowedBy).toBeUndefined();
        expect(yield* command.state).toEqual(installed);

        const removed = yield* command.uninstall;
        expect(removed.installedPath).toBeNull();
        expect(removed.onPath).toBe(true);
        expect(yield* command.state).toEqual(removed);
        expect(yield* fs.exists(installed.installedPath!)).toBe(false);
        expect(yield* fs.exists(launcher)).toBe(true);
      }).pipe(Effect.scoped),
  );

  it.effect("leaves the Windows PATH alone when it cannot be read", () =>
    Effect.gen(function* () {
      const fs = yield* FileSystem.FileSystem;
      const home = yield* fs.makeTempDirectoryScoped();
      const userPath = "C:\\Users\\Me\\npm;%USERPROFILE%\\tools";
      const { registry, spawner } = fakePowerShell(userPath);
      const command = yield* commandIn({ home, platform: "win32" }, spawner).pipe(
        Effect.provideService(HostProcess.Environment, { SystemRoot: "C:\\Windows" }),
      );

      registry.failReads = true;
      yield* command.installAutomatically;
      const error = yield* Effect.flip(command.install);
      expect(error.message).toContain("left unchanged");
      expect(registry).toMatchObject({ path: userPath, writes: 0 });
      expect(new Set(registry.commands)).toEqual(
        new Set(["C:\\Windows\\System32\\WindowsPowerShell\\v1.0\\powershell.exe"]),
      );

      registry.failReads = false;
      const launcherDir = DesktopCliShim.launcherPath(
        environmentFor(yield* Path.Path, { home, baseDir: `${home}/.supaterm`, platform: "win32" }),
      ).replace(/[\\/]supaterm\.cmd$/, "");
      yield* command.install;
      expect(registry.path).toBe(`${userPath};${launcherDir}`);
      yield* command.uninstall;
      expect(registry.path).toBe(userPath);

      // A `;` in the folder would split it into two PATH entries, so nothing is written.
      const split = fakePowerShell(userPath);
      const semicolon = yield* commandIn(
        { home, baseDir: `${home}\\Supaterm;Home`, platform: "win32" },
        split.spawner,
      );
      expect((yield* Effect.flip(semicolon.install)).message).toContain('has a ";"');
      expect(split.registry).toMatchObject({ path: userPath, writes: 0 });

      // An inherited SUPATERM_SET=1 never turns a read into a write of the whole PATH.
      const inherited = fakePowerShell(userPath, {
        SUPATERM_SET: "1",
        SUPATERM_PATH: "C:\\other",
      });
      const reader = yield* commandIn({ home, platform: "win32" }, inherited.spawner);
      yield* reader.install;
      expect(inherited.registry).toMatchObject({ path: `${userPath};${launcherDir}`, writes: 1 });
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

      // Installing automatically beside a standalone supaterm.cmd (from `supaterm install`), even off
      // PATH, leaves PATH alone.
      const besideHome = yield* fs.makeTempDirectoryScoped();
      yield* fs.makeDirectory(path.join(besideHome, ".local", "bin"), { recursive: true });
      yield* fs.writeFileString(
        path.join(besideHome, ".local", "bin", "supaterm.cmd"),
        "@echo off\r\n",
      );
      const beside = fakePowerShell("C:\\Tools");
      yield* (yield* commandIn({ home: besideHome, platform: "win32" }, beside.spawner))
        .installAutomatically;
      expect(beside.registry).toMatchObject({ path: "C:\\Tools", writes: 0 });
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
