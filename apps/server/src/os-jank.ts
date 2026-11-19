import * as HostProcess from "@supaterm/shared/HostProcess";
import {
  buildEnvironmentCaptureCommand,
  extractEnvironmentValues,
  listLoginShellCandidates,
  mergePathEntries,
  mergePathValues,
  readEnvironmentFromLoginShell,
  readPathFromLaunchctl,
  resolveWindowsEnvironment,
  setWindowsPath,
  WindowsShellEnvironment,
} from "@supaterm/shared/shell";
import { resolveDefaultSupatermHome } from "@supaterm/shared/supatermHome";
import * as Duration from "effect/Duration";
import * as Effect from "effect/Effect";
import * as Option from "effect/Option";
import * as Path from "effect/Path";
import * as Stream from "effect/Stream";
import * as ChildProcess from "effect/process/ChildProcess";
import * as ChildProcessSpawner from "effect/process/ChildProcessSpawner";
// @effect-diagnostics-next-line nodeBuiltinImport:off -- the login shell probes run synchronously through execFileSync.
import * as NodeChildProcess from "node:child_process";
import * as NodeOS from "node:os";

function logPathHydrationWarning(message: string, error?: unknown) {
  process.stderr.write(
    `[server] ${message} ${error instanceof Error ? error.message : (error ?? "")}\n`,
  );
}

const LOGIN_SHELL_ENV_NAMES = ["PATH", "__MISE_DIFF", "JAVA_HOME"] as const;
const LOGIN_SHELL_TIMEOUT = Duration.seconds(5);
const SLOW_LOGIN_SHELL_TIMEOUT_MS = 20_000;

type ExecFileSync = NonNullable<Parameters<typeof readPathFromLaunchctl>[0]>;

function readSlowLoginShellEnvironment(shell: string, execFileSync: ExecFileSync) {
  return readEnvironmentFromLoginShell(shell, LOGIN_SHELL_ENV_NAMES, (file, args, options) =>
    execFileSync(file, args, {
      ...options,
      timeout: SLOW_LOGIN_SHELL_TIMEOUT_MS,
    }),
  );
}

function applyLoginShellEnvironment(
  env: NodeJS.ProcessEnv,
  platform: NodeJS.Platform,
  shellEnvironment: Partial<Record<string, string>>,
  fallbackPath?: string,
) {
  const shellPath = shellEnvironment.PATH;
  const mergedPath = mergePathEntries(shellPath ?? fallbackPath, env.PATH, platform);
  if (mergedPath) {
    env.PATH = mergedPath;
  }
  if (shellPath && shellEnvironment.__MISE_DIFF) {
    env.__MISE_DIFF = shellEnvironment.__MISE_DIFF;
  }
  if (!env.JAVA_HOME && shellEnvironment.JAVA_HOME) {
    env.JAVA_HOME = shellEnvironment.JAVA_HOME;
  }
}

function hydratePosixPath(
  env: NodeJS.ProcessEnv,
  platform: NodeJS.Platform,
  execFileSync: ExecFileSync,
) {
  let shellEnvironment: Partial<Record<string, string>> = {};
  let waitedForSlowShell = false;
  for (const shell of listLoginShellCandidates(platform, env.SHELL)) {
    try {
      shellEnvironment = readEnvironmentFromLoginShell(shell, LOGIN_SHELL_ENV_NAMES, execFileSync);
    } catch (error) {
      logPathHydrationWarning(`Failed to read PATH from login shell ${shell}.`, error);
      if (!waitedForSlowShell && (error as NodeJS.ErrnoException | null)?.code === "ETIMEDOUT") {
        waitedForSlowShell = true;
        try {
          shellEnvironment = readSlowLoginShellEnvironment(shell, execFileSync);
        } catch (retryError) {
          logPathHydrationWarning(
            `Failed to read PATH from slow login shell ${shell}.`,
            retryError,
          );
        }
      }
    }

    if (shellEnvironment.PATH) break;
  }

  const launchctlPath =
    platform === "darwin" && !shellEnvironment.PATH
      ? readPathFromLaunchctl(execFileSync)
      : undefined;
  applyLoginShellEnvironment(env, platform, shellEnvironment, launchctlPath);
}

export function hydratePosixHome(
  env: NodeJS.ProcessEnv,
  resolveHomeDir = () => NodeOS.userInfo().homedir,
) {
  if ((env.HOME?.trim() ?? "").length > 0) return;

  const homeDir = resolveHomeDir();
  if (homeDir.length > 0) {
    env.HOME = homeDir;
  }
}

export const fixPath = Effect.fn("fixPath")(function* (options?: {
  readonly shellEnvironmentPrepared?: boolean | undefined;
  readonly execFileSync?: ExecFileSync;
}) {
  const platform = yield* HostProcess.Platform;
  const env = yield* HostProcess.Environment;

  if (platform === "win32") {
    if (options?.shellEnvironmentPrepared === true) return;
    const repairedEnvironment = yield* resolveWindowsEnvironment(env).pipe(
      Effect.catchDefect((defect) =>
        Effect.sync(() => {
          logPathHydrationWarning("Failed to hydrate PATH from the user environment.", defect);
          return {} as Partial<NodeJS.ProcessEnv>;
        }),
      ),
    );
    for (const [key, value] of Object.entries(repairedEnvironment)) {
      if (value === undefined) continue;
      if (key === "PATH") {
        setWindowsPath(env, value);
      } else {
        env[key] = value;
      }
    }
    return;
  }

  if (platform !== "darwin" && platform !== "linux") return;

  yield* Effect.sync(() => hydratePosixHome(env)).pipe(
    Effect.catchDefect((defect) =>
      Effect.sync(() => {
        logPathHydrationWarning("Failed to hydrate HOME from the user account.", defect);
      }),
    ),
  );
  if (options?.shellEnvironmentPrepared === true) return;
  yield* Effect.sync(() =>
    hydratePosixPath(env, platform, options?.execFileSync ?? NodeChildProcess.execFileSync),
  ).pipe(
    Effect.catchDefect((defect) =>
      Effect.sync(() => {
        logPathHydrationWarning("Failed to hydrate PATH from the user environment.", defect);
      }),
    ),
  );
});

const readLoginShellOutput = Effect.fn("readLoginShellOutput")(
  function* (shell: string) {
    const spawner = yield* ChildProcessSpawner.ChildProcessSpawner;
    const child = yield* spawner.spawn(
      ChildProcess.make(
        shell,
        ["-ilc", buildEnvironmentCaptureCommand(shell, LOGIN_SHELL_ENV_NAMES)],
        {
          stdin: "ignore",
          stdout: "pipe",
          stderr: "ignore",
          forceKillAfter: "1 second",
        },
      ),
    );
    const [stdout, exitCode] = yield* Effect.all(
      [Stream.mkString(Stream.decodeText(child.stdout)), child.exitCode],
      { concurrency: 2 },
    );
    if (exitCode === 0) return stdout;
    yield* Effect.logWarning(
      `Login shell ${shell} exited with code ${exitCode} while reading PATH.`,
    );
    return "";
  },
  Effect.scoped,
  Effect.timeoutOption(LOGIN_SHELL_TIMEOUT),
);

export const refreshPathFromLoginShell = Effect.fn("refreshPathFromLoginShell")(function* () {
  const platform = yield* HostProcess.Platform;
  if (platform !== "darwin" && platform !== "linux") return;
  const env = yield* HostProcess.Environment;
  const [shell] = listLoginShellCandidates(platform, env.SHELL);
  if (!shell) return;

  const output = yield* readLoginShellOutput(shell).pipe(
    Effect.catchCause((cause) =>
      Effect.logWarning(`Failed to read PATH from login shell ${shell}.`, cause).pipe(
        Effect.as(Option.some("")),
      ),
    ),
  );
  if (Option.isNone(output)) {
    yield* Effect.logWarning(
      `Timed out reading PATH from login shell ${shell} after ${Duration.format(LOGIN_SHELL_TIMEOUT)}; PATH is unchanged.`,
    );
    return;
  }
  const shellEnvironment = extractEnvironmentValues(output.value, LOGIN_SHELL_ENV_NAMES);
  if (shellEnvironment.PATH) {
    applyLoginShellEnvironment(env, platform, shellEnvironment);
  } else {
    yield* Effect.logWarning(`Login shell ${shell} printed no PATH; PATH is unchanged.`);
  }
});

export const refreshWindowsPath = Effect.fn("refreshWindowsPath")(function* () {
  if ((yield* HostProcess.Platform) !== "win32") return false;
  const env = yield* HostProcess.Environment;
  const readEnvironment = yield* WindowsShellEnvironment;
  const { PATH: registryPath } = yield* readEnvironment(["PATH"], { loadProfile: false });
  const currentPath = env.PATH ?? env.Path ?? env.path;
  const mergedPath = mergePathValues(currentPath, registryPath, "win32");
  if (!mergedPath || mergedPath === currentPath) return false;
  setWindowsPath(env, mergedPath);
  return true;
});

export const expandHomePath = Effect.fn(function* (input: string) {
  const { join } = yield* Path.Path;
  const home = yield* HostProcess.HomeDirectory;
  if (input === "~") {
    return home;
  }
  if (input.startsWith("~/") || input.startsWith("~\\")) {
    return join(home, input.slice(2));
  }
  return input;
});

export const resolveBaseDir = Effect.fn(function* (raw: string | undefined) {
  const { join, resolve } = yield* Path.Path;
  if (!raw || raw.trim().length === 0) {
    return resolveDefaultSupatermHome(yield* HostProcess.HomeDirectory, join);
  }
  return resolve(yield* expandHomePath(raw.trim()));
});
