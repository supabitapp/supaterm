import * as Path from "effect/Path";
import { CommandResolutionCache, resolveCommandPath } from "@supaterm/shared/shell";
import * as HostProcess from "@supaterm/shared/HostProcess";
import type { DesktopCliCommandState } from "@supaterm/contracts";
import * as Context from "effect/Context";
import * as Effect from "effect/Effect";
import * as FileSystem from "effect/FileSystem";
import * as Layer from "effect/Layer";
import * as Option from "effect/Option";
import * as Schema from "effect/Schema";
import * as Semaphore from "effect/Semaphore";
import * as Stream from "effect/Stream";
import * as ChildProcess from "effect/process/ChildProcess";
import * as ChildProcessSpawner from "effect/process/ChildProcessSpawner";

import * as DesktopCliShim from "./DesktopCliShim.ts";
import * as DesktopEnvironment from "./DesktopEnvironment.ts";
import { makeComponentLogger } from "./DesktopObservability.ts";

const { logWarning } = makeComponentLogger("desktop-cli-command");

export class DesktopCliCommandError extends Schema.TaggedError<DesktopCliCommandError>()(
  "DesktopCliCommandError",
  { message: Schema.String },
) {}

const unixCandidates = (home: string, platform: NodeJS.Platform) =>
  platform === "darwin"
    ? ["/opt/homebrew/bin", "/usr/local/bin", `${home}/.local/bin`, `${home}/bin`]
    : [`${home}/.local/bin`, `${home}/bin`];

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
  }
>()("@supaterm/desktop/app/DesktopCliCommand") {}

export const make = Effect.gen(function* () {
  const environment = yield* DesktopEnvironment.DesktopEnvironment;
  const fs = yield* FileSystem.FileSystem;
  const spawner = yield* ChildProcessSpawner.ChildProcessSpawner;
  const path = environment.path;
  const windows = environment.platform === "win32";
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

  const runsOurLauncher = Effect.fn("DesktopCliCommand.runsOurLauncher")(
    function* (candidate: string) {
      if (yield* isOurLink(candidate)) return true;
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
        const root = process.env.SystemRoot ?? process.env.WINDIR;
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
  const readUserPath = powershell({}).pipe(
    Effect.map((encoded) => Buffer.from(encoded.trim(), "base64").toString("utf8")),
    Effect.mapError(() => fail("Could not read your PATH, so it was left unchanged.")),
  );
  const writeUserPath = (value: string) =>
    powershell({ SUPATERM_SET: "1", SUPATERM_PATH: value }).pipe(
      Effect.asVoid,
      Effect.mapError(() => fail("Could not update your PATH.")),
    );

  const firstOnPath = Effect.suspend(() =>
    resolveCommandPath("supaterm", { env: process.env }).pipe(
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

  const installedAt = Effect.gen(function* () {
    if (windows) {
      if (!(yield* exists(ownedPathMarker))) return Option.none<string>();
      const entries = pathEntries(yield* readUserPath, ";");
      return entries.some((entry) => sameWindowsPath(entry, binDirectory))
        ? Option.some(launcher)
        : Option.none<string>();
    }
    for (const directory of unixCandidates(environment.homeDirectory, environment.platform)) {
      const link = path.join(directory, "supaterm");
      if (yield* isOurLink(link)) return Option.some(link);
    }
    return Option.none<string>();
  });

  const state: DesktopCliCommand["Service"]["state"] = Effect.gen(function* () {
    if (!environment.isPackaged) {
      return { supported: false, installedPath: null, onPath: false, launcherPath: null } as const;
    }
    const launcherPath = (yield* exists(launcher)) ? launcher : null;
    const installed = yield* installedAt;
    const shadowedBy = yield* foreignFirstOnPath;
    const shadow = Option.isSome(shadowedBy) ? { shadowedBy: shadowedBy.value } : {};
    const first = yield* firstOnPath;
    const onPath = windows
      ? Option.isSome(installed)
      : Option.isSome(first) && (yield* runsOurLauncher(first.value));
    return {
      supported: true,
      installedPath: Option.getOrNull(installed),
      onPath,
      launcherPath,
      ...shadow,
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
    const shadowedBy = yield* foreignFirstOnPath;
    if (Option.isSome(shadowedBy)) {
      return yield* fail(
        `Another supaterm at ${shadowedBy.value} runs first in a new terminal. Remove it, or run the launcher directly at ${launcher}.`,
      );
    }
    if (windows) {
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
    const existing = yield* installedAt;
    if (Option.isSome(existing)) {
      const target = yield* fs.readLink(existing.value).pipe(Effect.option);
      if (Option.getOrUndefined(target) === launcher) return yield* state;

      yield* fs
        .remove(existing.value)
        .pipe(Effect.mapError(() => fail(`Could not replace ${existing.value}.`)));
    }

    const onPath = pathEntries(process.env.PATH, ":");
    const candidates = unixCandidates(environment.homeDirectory, environment.platform);

    for (const directory of [
      ...candidates.filter((candidate) => onPath.includes(candidate)),
      ...candidates.filter((candidate) => !onPath.includes(candidate)),
    ]) {
      const link = path.join(directory, "supaterm");
      const created = (yield* exists(directory))
        ? yield* writableDirectory(directory)
        : yield* fs.makeDirectory(directory, { recursive: true }).pipe(
            Effect.as(true),
            Effect.orElseSucceed(() => false),
          );
      if (!created) continue;

      const linked = yield* fs.symlink(launcher, link).pipe(
        Effect.as(true),
        Effect.orElseSucceed(() => false),
      );
      if (linked) return yield* state;
    }
    return yield* fail(
      `Another supaterm command is already installed, or no folder on your PATH is writable. Run the launcher directly at ${launcher}.`,
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
    for (const directory of unixCandidates(environment.homeDirectory, environment.platform)) {
      const link = path.join(directory, "supaterm");
      if (yield* isOurLink(link)) {
        yield* fs.remove(link).pipe(Effect.mapError(() => fail(`Could not remove ${link}.`)));
      }
    }
    return yield* state;
  }).pipe(Effect.withSpan("desktop.cliCommand.uninstall"));

  return DesktopCliCommand.of({
    state: state.pipe(operations.withPermit),
    install: install.pipe(operations.withPermit),
    installAutomatically,
    uninstall: uninstall.pipe(operations.withPermit),
  });
});

export const layer = Layer.effect(DesktopCliCommand, make);
