import * as Path from "effect/Path";
import { CommandResolutionCache, resolveCommandPath } from "@supaterm/shared/shell";
import * as HostProcess from "@supaterm/shared/HostProcess";
import type { DesktopCliCommandState } from "@supaterm/contracts";
import * as Context from "effect/Context";
import * as Effect from "effect/Effect";
import * as FileSystem from "effect/FileSystem";
import * as Layer from "effect/Layer";
import * as Option from "effect/Option";
import * as Random from "effect/Random";
import * as Schema from "effect/Schema";
import * as Semaphore from "effect/Semaphore";
import * as Stream from "effect/Stream";
import * as ChildProcess from "effect/process/ChildProcess";
import * as ChildProcessSpawner from "effect/process/ChildProcessSpawner";

import { pathSetup, readUserLoginShell } from "@supaterm/shared/shell";

import * as DesktopCliShim from "./DesktopCliShim.ts";
import * as DesktopEnvironment from "./DesktopEnvironment.ts";
import { makeComponentLogger } from "./DesktopObservability.ts";

const { logInfo, logWarning } = makeComponentLogger("desktop-cli-command");

export class DesktopCliCommandError extends Schema.TaggedError<DesktopCliCommandError>()(
  "DesktopCliCommandError",
  { message: Schema.String },
) {}

const userCandidates = (home: string) => [`${home}/.local/bin`, `${home}/bin`];

// Older builds also linked into these macOS folders. Such a link is found, updated in place, and
// removed, but no new link goes there.
const knownLocations = (home: string, platform: NodeJS.Platform) =>
  platform === "darwin"
    ? [...userCandidates(home), "/opt/homebrew/bin", "/usr/local/bin"]
    : userCandidates(home);

const pathEntries = (value: string | undefined, separator: string) =>
  (value ?? "").split(separator).filter((entry) => entry.length > 0);

const sameWindowsPath = (left: string, right: string) =>
  left.replace(/[\\/]+$/, "").toLowerCase() === right.replace(/[\\/]+$/, "").toLowerCase();

const WINDOWS_USER_PATH_SCRIPT = `
$ErrorActionPreference = 'Stop'
if ($env:SUPATERM_SET -eq '1') {
  $key = [Microsoft.Win32.Registry]::CurrentUser.CreateSubKey('Environment')
  $kind = [Microsoft.Win32.RegistryValueKind]::ExpandString
  if ($key.GetValueNames() -contains 'Path' -and $key.GetValueKind('Path') -eq 'String') {
    $kind = [Microsoft.Win32.RegistryValueKind]::String
  }
  $key.SetValue('Path', $env:SUPATERM_PATH, $kind)
  Add-Type -Namespace Supaterm -Name Env -MemberDefinition '[DllImport("user32.dll", CharSet = CharSet.Unicode)] public static extern System.IntPtr SendMessageTimeout(System.IntPtr hWnd, uint Msg, System.UIntPtr wParam, string lParam, uint fuFlags, uint uTimeout, out System.UIntPtr lpdwResult);'
  $result = [System.UIntPtr]::Zero
  [void][Supaterm.Env]::SendMessageTimeout([System.IntPtr]0xffff, 0x1A, [System.UIntPtr]::Zero, 'Environment', 2, 5000, [ref]$result)
} else {
  $key = [Microsoft.Win32.Registry]::CurrentUser.OpenSubKey('Environment')
  $value = if ($key) { $key.GetValue('Path', '', 'DoNotExpandEnvironmentNames') } else { '' }
  [Console]::Out.Write([Convert]::ToBase64String([Text.Encoding]::UTF8.GetBytes([string]$value)))
}
`;

export class DesktopCliCommand extends Context.Service<
  DesktopCliCommand,
  {
    readonly state: Effect.Effect<DesktopCliCommandState>;
    readonly install: Effect.Effect<DesktopCliCommandState, DesktopCliCommandError>;
    readonly installAutomatically: Effect.Effect<void>;
    readonly uninstall: Effect.Effect<DesktopCliCommandState, DesktopCliCommandError>;
    /** Adds the installed command's folder to PATH in the user's shell startup file. */
    readonly addToPath: Effect.Effect<DesktopCliCommandState, DesktopCliCommandError>;
  }
>()("@supaterm/desktop/app/DesktopCliCommand") {}

export const make = Effect.gen(function* () {
  const environment = yield* DesktopEnvironment.DesktopEnvironment;
  const fs = yield* FileSystem.FileSystem;
  const spawner = yield* ChildProcessSpawner.ChildProcessSpawner;
  const path = environment.path;
  const windows = environment.platform === "win32";
  // Read the live env: shell discovery patches PATH after startup.
  const env = yield* HostProcess.Environment;
  const launcher = DesktopCliShim.launcherPath(environment);
  const binDirectory = path.dirname(launcher);

  const ownedPathMarker = path.join(environment.stateDir, "cli-command-path-entry");
  const autoInstallDisabledMarker = path.join(
    environment.stateDir,
    "cli-command-auto-install-disabled",
  );
  const operations = yield* Semaphore.make(1);

  const fail = (message: string) => new DesktopCliCommandError({ message });
  const exists = (target: string) => fs.exists(target).pipe(Effect.orElseSucceed(() => false));
  const writableDirectory = (directory: string) =>
    fs.access(directory, { writable: true }).pipe(
      Effect.as(true),
      Effect.orElseSucceed(() => false),
    );

  const isOurLink = Effect.fn("DesktopCliCommand.isOurLink")(
    function* (link: string) {
      yield* fs.readLink(link);

      const info = yield* fs.stat(link);
      if (info.type !== "File" || Number(info.size) > 16_384) return false;
      const content = yield* fs.readFileString(link);
      return content.includes(DesktopCliShim.MARKER);
    },
    Effect.orElseSucceed(() => false),
  );

  // PATH can reach the regular launcher directly; removal still requires isOurLink.
  const runsOurLauncher = Effect.fn("DesktopCliCommand.runsOurLauncher")(
    // Another Supaterm home's link is marked too, so compare where it leads, not the marker alone.
    function* (candidate: string) {
      const [resolved, ours] = yield* Effect.all([fs.realPath(candidate), fs.realPath(launcher)]);
      if (resolved !== ours) return false;
      const info = yield* fs.stat(candidate);
      if (info.type !== "File" || Number(info.size) > 16_384) return false;
      return (yield* fs.readFileString(candidate)).includes(DesktopCliShim.MARKER);
    },
    Effect.orElseSucceed(() => false),
  );

  const powershell = (env: Record<string, string>) =>
    Effect.scoped(
      Effect.gen(function* () {
        const root = env.SystemRoot ?? env.WINDIR;
        const handle = yield* spawner.spawn(
          ChildProcess.make(
            root ? `${root}\\System32\\WindowsPowerShell\\v1.0\\powershell.exe` : "powershell.exe",
            ["-NoLogo", "-NoProfile", "-NonInteractive", "-Command", WINDOWS_USER_PATH_SCRIPT],
            { stdin: "ignore", stderr: "ignore", env, extendEnv: true },
          ),
        );
        const [stdout, exitCode] = yield* Effect.all(
          [handle.stdout.pipe(Stream.decodeText(), Stream.mkString), handle.exitCode],
          { concurrency: "unbounded" },
        );
        if (exitCode !== 0) return yield* Effect.fail(`powershell exited with ${exitCode}`);
        return stdout;
      }),
    );
  // Explicit, so an inherited SUPATERM_SET=1 can never turn a read into a PATH write.
  const readUserPath = powershell({ SUPATERM_SET: "0" }).pipe(
    Effect.map((encoded) => Buffer.from(encoded.trim(), "base64").toString("utf8")),
    Effect.mapError(() => fail("Could not read your PATH, so it was left unchanged.")),
  );
  const writeUserPath = (value: string) =>
    powershell({ SUPATERM_SET: "1", SUPATERM_PATH: value }).pipe(
      Effect.asVoid,
      Effect.mapError(() => fail("Could not update your PATH.")),
    );

  const firstOnPath = Effect.suspend(() =>
    resolveCommandPath("supaterm", { env }).pipe(
      Effect.provideService(HostProcess.Platform, environment.platform),
      Effect.provideService(FileSystem.FileSystem, fs),
      Effect.provideService(Path.Path, path),
      Effect.provideService(CommandResolutionCache, new Map()),
      Effect.map(Option.fromNullishOr),
    ),
  );

  const foreignFirstOnPath = Effect.gen(function* () {
    const first = yield* firstOnPath;
    if (Option.isNone(first)) return first;
    const ours = windows
      ? sameWindowsPath(first.value, launcher)
      : yield* runsOurLauncher(first.value);
    if (ours) return Option.none<string>();
    return first;
  });

  /** A link to this home's launcher; another home's link is marked too. */
  const leadsHere = (link: string) =>
    fs.readLink(link).pipe(
      Effect.map((target) => target === launcher),
      Effect.orElseSucceed(() => false),
    );

  const installedAt = Effect.gen(function* () {
    if (windows) {
      if (!(yield* exists(ownedPathMarker))) return Option.none<string>();
      const entries = pathEntries(yield* readUserPath, ";");
      return entries.some((entry) => sameWindowsPath(entry, binDirectory))
        ? Option.some(launcher)
        : Option.none<string>();
    }
    for (const directory of knownLocations(environment.homeDirectory, environment.platform)) {
      const link = path.join(directory, "supaterm");
      if (yield* isOurLink(link)) return Option.some(link);
    }
    return Option.none<string>();
  });

  const startupLine = (installedPath: string) => {
    const setup = pathSetup({
      directory: path.dirname(installedPath),
      home: environment.homeDirectory,
      // A Finder or desktop launch may not set SHELL.
      shell: env.SHELL || readUserLoginShell(),
      platform: environment.platform,
      configHome: env.XDG_CONFIG_HOME,
      zdotdir: env.ZDOTDIR,
    });
    if (setup === undefined) return undefined;
    const file = setup.file.startsWith("~/")
      ? path.join(environment.homeDirectory, setup.file.slice(2))
      : setup.file;
    return { ...setup, path: file };
  };
  const hasLine = (setup: { readonly path: string; readonly line: string }) =>
    fs.readFileString(setup.path).pipe(
      Effect.map((content) => content.split("\n").some((line) => line.trim() === setup.line)),
      Effect.orElseSucceed(() => false),
    );

  const folderOnPath = (link: string) =>
    Effect.sync(() =>
      pathEntries(env.PATH, ":").some((entry) => entry.replace(/\/+$/, "") === path.dirname(link)),
    );

  const state: DesktopCliCommand["Service"]["state"] = Effect.gen(function* () {
    if (!environment.isPackaged) {
      return { supported: false, installedPath: null, onPath: false, launcherPath: null } as const;
    }
    const launcherPath = (yield* exists(launcher)) ? launcher : null;
    const found = yield* installedAt;
    // Our link into another Supaterm home is not this app's command; Install updates it in place.
    const installed =
      windows || (Option.isSome(found) && (yield* leadsHere(found.value)))
        ? found
        : Option.none<string>();
    const shadowedBy = (yield* foreignFirstOnPath).pipe(
      Option.filter((first) => first !== Option.getOrUndefined(found)),
    );
    const shadow = Option.isSome(shadowedBy) ? { shadowedBy: shadowedBy.value } : {};
    const first = yield* firstOnPath;
    const onPath = windows
      ? Option.isSome(installed)
      : Option.isSome(first) && (yield* runsOurLauncher(first.value));
    // Only a folder missing from PATH, with no other supaterm first: with one, the added folder (last
    // on PATH) would still not run this supaterm.
    const setup =
      onPath ||
      Option.isSome(shadowedBy) ||
      Option.isNone(installed) ||
      (yield* folderOnPath(installed.value))
        ? undefined
        : startupLine(installed.value);
    return {
      supported: true,
      installedPath: Option.getOrNull(installed),
      onPath,
      launcherPath,
      ...shadow,
      ...(setup === undefined
        ? {}
        : { pathSetup: { file: setup.file, added: yield* hasLine(setup) } }),
    };
  }).pipe(
    Effect.orElseSucceed(() => ({
      supported: false,
      installedPath: null,
      onPath: false,
      launcherPath: null,
    })),
  );

  const ensureLauncher = DesktopCliShim.install.pipe(
    Effect.provideService(DesktopEnvironment.DesktopEnvironment, environment),
    Effect.provideService(FileSystem.FileSystem, fs),
    Effect.flatMap(
      Option.match({
        onNone: () => Effect.fail(fail(`Could not set up the supaterm launcher at ${launcher}.`)),
        onSome: () => Effect.void,
      }),
    ),
  );

  const install: DesktopCliCommand["Service"]["install"] = Effect.gen(function* () {
    if (!environment.isPackaged) return yield* fail("The supaterm command needs an installed app.");
    yield* ensureLauncher;
    if (windows) {
      // PATH would split the folder at the `;`, leaving two wrong entries behind.
      if (binDirectory.includes(";")) {
        return yield* fail(
          `Supaterm cannot put ${binDirectory} on PATH because it has a ";". Run ${launcher} directly.`,
        );
      }
      const shadowedBy = yield* foreignFirstOnPath;
      if (Option.isSome(shadowedBy)) {
        return yield* fail(
          `Another supaterm at ${shadowedBy.value} runs first in a new terminal. Remove it, or run the launcher directly at ${launcher}.`,
        );
      }
      const entries = pathEntries(yield* readUserPath, ";");
      if (!entries.some((entry) => sameWindowsPath(entry, binDirectory))) {
        yield* writeUserPath([...entries, binDirectory].join(";"));
        yield* fs
          .writeFileString(ownedPathMarker, `${binDirectory}\n`)
          .pipe(
            Effect.mapError(() => fail("Added supaterm to your PATH but could not record it.")),
          );
      }
      return yield* state;
    }
    const candidates = userCandidates(environment.homeDirectory);
    const replaced = Option.getOrUndefined(yield* installedAt);
    if (replaced !== undefined) {
      const target = yield* fs.readLink(replaced).pipe(Effect.option);
      if (Option.getOrUndefined(target) === launcher) return yield* state;
    }
    const shadowedBy = yield* foreignFirstOnPath;
    // Our own link into another Supaterm home runs first too; it is the one this install updates.
    if (Option.isSome(shadowedBy) && shadowedBy.value !== replaced) {
      return yield* fail(
        `Another supaterm at ${shadowedBy.value} runs first in a new terminal. Remove it, or run the launcher directly at ${launcher}.`,
      );
    }
    // An old link of ours is updated where it is, so a supaterm that works now keeps working. It is
    // removed only once a new link exists elsewhere.
    const onPath = pathEntries(env.PATH, ":").map((entry) => entry.replace(/\/+$/, ""));
    for (const directory of new Set([
      ...(replaced === undefined ? [] : [path.dirname(replaced)]),
      ...candidates.filter((candidate) => onPath.includes(candidate)),
      ...candidates.filter((candidate) => !onPath.includes(candidate)),
    ])) {
      const link = path.join(directory, "supaterm");
      const created = (yield* exists(directory))
        ? yield* writableDirectory(directory)
        : yield* fs.makeDirectory(directory, { recursive: true }).pipe(
            Effect.as(true),
            Effect.orElseSucceed(() => false),
          );
      if (!created) continue;
      // Our own link is swapped in place; anything else there makes symlink fail and stays.
      const staging = `${link}.${yield* Random.nextIntBetween(0, 0xffffff)}.tmp`;
      const linked = yield* (
        link === replaced
          ? fs
              .symlink(launcher, staging)
              .pipe(
                Effect.andThen(
                  fs
                    .rename(staging, link)
                    .pipe(Effect.tapError(() => fs.remove(staging).pipe(Effect.ignore))),
                ),
              )
          : fs.symlink(launcher, link)
      ).pipe(
        Effect.as(true),
        Effect.orElseSucceed(() => false),
      );
      if (!linked) continue;
      if (replaced !== undefined && replaced !== link) {
        yield* fs.remove(replaced).pipe(Effect.ignore);
      }
      return yield* state;
    }
    return yield* fail(
      `Another supaterm command is already in ~/.local/bin and ~/bin, or neither is writable. Run the launcher directly at ${launcher}.`,
    );
  }).pipe(
    Effect.tap(() =>
      fs
        .remove(autoInstallDisabledMarker, { force: true })
        .pipe(
          Effect.mapError(() =>
            fail("Installed supaterm but could not enable automatic installation."),
          ),
        ),
    ),
    Effect.withSpan("desktop.cliCommand.install"),
  );

  const installAutomatically = Effect.gen(function* () {
    if (!environment.isPackaged || (yield* fs.exists(autoInstallDisabledMarker))) return;
    if (Option.isSome(yield* foreignFirstOnPath)) return;
    // Another Supaterm home's app owns the existing link; only Install in Settings may take it over.
    const existing = Option.getOrUndefined(yield* installedAt);
    if (existing !== undefined && !windows && !(yield* leadsHere(existing))) {
      return yield* logInfo("left another Supaterm app's supaterm command in place", { existing });
    }
    // A supaterm that is not ours in these folders, even off PATH, means the user has one already. On
    // Windows the app never writes there, so any supaterm there is someone else's.
    for (const directory of userCandidates(environment.homeDirectory)) {
      for (const name of windows ? ["supaterm.cmd", "supaterm.exe"] : ["supaterm"]) {
        const other = path.join(directory, name);
        const present =
          (yield* exists(other)) || Option.isSome(yield* fs.readLink(other).pipe(Effect.option));
        if (present && (windows || !(yield* isOurLink(other)))) {
          return yield* logInfo("left the supaterm command to Settings beside another supaterm", {
            other,
          });
        }
      }
    }
    yield* install;
  }).pipe(
    operations.withPermit,
    Effect.catch((error) =>
      logWarning("automatic CLI installation failed", {
        category: error._tag,
        message: error.message,
      }),
    ),
    Effect.withSpan("desktop.cliCommand.installAutomatically"),
  );

  const uninstall: DesktopCliCommand["Service"]["uninstall"] = Effect.gen(function* () {
    if (!environment.isPackaged) return yield* state;
    yield* fs.makeDirectory(environment.stateDir, { recursive: true }).pipe(
      Effect.andThen(fs.writeFileString(autoInstallDisabledMarker, "")),
      Effect.mapError(() => fail("Could not disable automatic supaterm installation.")),
    );
    if (windows) {
      if (yield* exists(ownedPathMarker)) {
        const entries = pathEntries(yield* readUserPath, ";");
        const ownedEntryIndex = entries.findLastIndex((entry) =>
          sameWindowsPath(entry, binDirectory),
        );
        if (ownedEntryIndex !== -1) {
          entries.splice(ownedEntryIndex, 1);
          yield* writeUserPath(entries.join(";"));
        }
        yield* fs.remove(ownedPathMarker).pipe(Effect.ignore);
      }
      return yield* state;
    }
    for (const directory of knownLocations(environment.homeDirectory, environment.platform)) {
      const link = path.join(directory, "supaterm");
      if (yield* isOurLink(link)) {
        yield* fs.remove(link).pipe(Effect.mapError(() => fail(`Could not remove ${link}.`)));
      }
    }
    return yield* state;
  }).pipe(Effect.withSpan("desktop.cliCommand.uninstall"));

  const addToPath: DesktopCliCommand["Service"]["addToPath"] = Effect.gen(function* () {
    const installed = yield* installedAt;
    if (Option.isNone(installed) || !(yield* leadsHere(installed.value))) {
      return yield* fail("Install the supaterm command first.");
    }
    const setup = startupLine(installed.value);
    if (setup === undefined)
      return yield* fail("Supaterm cannot add supaterm to this shell's PATH.");
    const shadowedBy = yield* foreignFirstOnPath;
    if (Option.isSome(shadowedBy)) {
      return yield* fail(
        `Another supaterm at ${shadowedBy.value} runs first; Supaterm leaves it in place.`,
      );
    }
    if (!(yield* folderOnPath(installed.value)) && !(yield* hasLine(setup))) {
      yield* fs.makeDirectory(path.dirname(setup.path), { recursive: true }).pipe(
        Effect.andThen(
          fs.writeFileString(setup.path, `\n# Added by Supaterm\n${setup.line}\n`, { flag: "a" }),
        ),
        Effect.mapError(() => fail(`Could not add supaterm to ${setup.file}.`)),
      );
    }
    return yield* state;
  }).pipe(Effect.withSpan("desktop.cliCommand.addToPath"));

  return DesktopCliCommand.of({
    state: state.pipe(operations.withPermit),
    install: install.pipe(operations.withPermit),
    installAutomatically,
    uninstall: uninstall.pipe(operations.withPermit),
    // One at a time, so Settings and onboarding cannot both append the line.
    addToPath: addToPath.pipe(operations.withPermit),
  });
});

export const layer = Layer.effect(DesktopCliCommand, make);
