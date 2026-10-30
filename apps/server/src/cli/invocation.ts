import * as Effect from "effect/Effect";
import * as FileSystem from "effect/FileSystem";
import * as Option from "effect/Option";
import * as Path from "effect/Path";
import * as Schema from "effect/Schema";

import type { ServerInstallation } from "@supaterm/contracts";
import * as HostProcess from "@supaterm/shared/HostProcess";
import { isCommandAvailable } from "@supaterm/shared/shell";
import { resolveSelfInvocation } from "@supaterm/shared/nodeRuntime";

import packageJson from "../../package.json" with { type: "json" };

export type CliRunner = "npx" | "pnpm dlx" | "bunx";

/** Detection is best-effort; callers must fail closed to a plain `supaterm` command. */
function detectCliRunner(entryPath: string): CliRunner | null {
  const path = entryPath.replaceAll("\\", "/");
  if (path.includes("/_npx/")) {
    return "npx";
  }
  if (
    path.includes("/pnpm/dlx/") ||
    path.includes("/.pnpm/dlx/") ||
    path.includes("/pnpm-cache/dlx/")
  ) {
    return "pnpm dlx";
  }
  if (path.includes("/.bun/install/cache/") || path.includes("/bunx-")) {
    return "bunx";
  }
  return null;
}

const InstallManifest = Schema.Struct({
  name: Schema.String,
  version: Schema.String,
  bin: Schema.optionalKey(Schema.Struct({ supaterm: Schema.String })),
});
const decodeInstallManifest = Schema.decodeUnknownEffect(Schema.fromJsonString(InstallManifest));

/**
 * The npm launcher or source entry script this CLI started through, else its own path. Spawned
 * processes inherit `SUPATERM_NPM_LAUNCHER_PATH`, so a launcher counts only at this exact
 * version: a different `supaterm` run from an agent's shell must not claim to be the npm install.
 */
export const resolveEntryPath = Effect.gen(function* () {
  const npmLauncher = (yield* HostProcess.Environment).SUPATERM_NPM_LAUNCHER_PATH?.trim();
  if (npmLauncher) {
    const fs = yield* FileSystem.FileSystem;
    const path = yield* Path.Path;
    const manifest = yield* fs
      .readFileString(path.join(path.dirname(npmLauncher), "../package.json"))
      .pipe(Effect.flatMap(decodeInstallManifest), Effect.option);
    if (
      Option.isSome(manifest) &&
      manifest.value.name === "supaterm" &&
      manifest.value.version === packageJson.version
    ) {
      return npmLauncher;
    }
  }
  if (yield* HostProcess.IsExecutable) return yield* HostProcess.ExecutablePath;
  return (yield* HostProcess.Arguments)[1] ?? "";
});

export const resolveServerInstallation = Effect.gen(function* () {
  const fs = yield* FileSystem.FileSystem;
  const path = yield* Path.Path;
  const platform = yield* HostProcess.Platform;
  const entry = yield* fs.realPath(yield* resolveEntryPath);
  const match = /^(.*)\/lib\/node_modules\/supaterm\/bin\/supaterm\.mjs$/.exec(entry);
  if (!match) {
    const runner = detectCliRunner(entry);
    return runner === null
      ? null
      : ({ kind: runner === "pnpm dlx" ? "pnpm-dlx" : runner } satisfies ServerInstallation);
  }
  if (platform === "win32") return null;
  const prefix = match[1] || "/";
  if (
    prefix.includes("/node_modules/") ||
    /\/(?:Cellar|Caskroom)\//i.test(prefix) ||
    /\/mise\/installs\/(?!node\/)[^/]+\//.test(prefix)
  )
    return null;

  const packageRoot = path.join(prefix, "lib/node_modules/supaterm");
  const manifest = yield* fs
    .readFileString(path.join(packageRoot, "package.json"))
    .pipe(Effect.flatMap(decodeInstallManifest));
  if (manifest.name !== "supaterm" || !manifest.bin) return null;
  const bin = yield* fs.realPath(path.join(packageRoot, manifest.bin.supaterm));
  const globalBin = yield* fs.realPath(path.join(prefix, "bin/supaterm"));
  if (globalBin !== bin || bin !== entry) return null;
  return { kind: "npm-global", prefix } satisfies ServerInstallation;
}).pipe(Effect.orElseSucceed(() => null));

/**
 * The literal spec the user typed (e.g. `supaterm@nightly`) is resolved away before
 * our process starts, so re-derive it from the running version: nightly builds
 * re-suggest the nightly channel, anything else suggests the bare package.
 */
function suggestedPackageSpec(version: string): string {
  const channel = /^[^-+]+-(nightly|preview)\./.exec(version)?.[1];
  return channel === undefined ? "supaterm" : `supaterm@${channel}`;
}

/**
 * Render a `supaterm <subcommand>` suggestion that matches how this process was
 * launched, so copy/pasting it actually works: `npx supaterm triage` suggests
 * `npx supaterm serve`, a global install suggests `supaterm serve`, and a nightly build
 * keeps the `@nightly` tag.
 */
function formatCliCommand(input: {
  readonly subcommand: string;
  readonly entryPath: string;
  readonly version: string;
}): string {
  const runner = detectCliRunner(input.entryPath);
  if (runner === null) {
    return `supaterm ${input.subcommand}`;
  }
  return `${runner} ${suggestedPackageSpec(input.version)} ${input.subcommand}`;
}

export const resolveCliCommand = (subcommand: string) =>
  Effect.map(resolveEntryPath, (entryPath) =>
    formatCliCommand({ subcommand, entryPath, version: packageJson.version }),
  );

const shellWord = (value: string) =>
  /^[\w@%+=:,./-]+$/.test(value) ? value : `'${value.replaceAll("'", `'"'"'`)}'`;

/**
 * Quotes `value` for PowerShell, the default Windows terminal. Always quoted,
 * so a path reads the same whether or not it holds a space. Inside double
 * quotes `"` and its typographic forms (which also end the string) double,
 * and `$` and the backtick are escaped so nothing expands.
 */
const powershellWord = (value: string) =>
  `"${value
    .replaceAll("`", "``")
    .replaceAll("$", "`$")
    .replace(/["\u201C\u201D\u201E]/g, "$&$&")}"`;

/** Quotes a word for the host's shell: POSIX, or PowerShell on Windows. */
const hostShellWord = (platform: NodeJS.Platform, value: string) =>
  platform === "win32" ? powershellWord(value) : shellWord(value);

const electronRunAsNodePrefix = (platform: NodeJS.Platform) =>
  platform === "win32" ? "$env:ELECTRON_RUN_AS_NODE=1; " : "env ELECTRON_RUN_AS_NODE=1 ";

/**
 * The words a person can type to run this install when `supaterm` is not on
 * PATH: the desktop app's `supaterm` shim, a standalone binary, or this
 * process's runtime and entrypoint, which an Electron runtime only runs as
 * Node with `ELECTRON_RUN_AS_NODE=1`.
 */
const resolveInstallLauncher = Effect.gen(function* () {
  const fs = yield* FileSystem.FileSystem;
  const environment = yield* HostProcess.Environment;
  const shim = environment.SUPATERM_CLI_SHIM_PATH?.trim();
  if (shim && (yield* fs.exists(shim).pipe(Effect.orElseSucceed(() => false)))) {
    return Option.some({ words: [shim], runAsNode: false });
  }
  const invocation = yield* resolveSelfInvocation();
  if (invocation.entrypoint === undefined) {
    return Option.some({ words: [invocation.command], runAsNode: false });
  }
  if (!(yield* fs.exists(invocation.entrypoint).pipe(Effect.orElseSucceed(() => false)))) {
    return Option.none();
  }
  return Option.some({
    words: [invocation.command, invocation.entrypoint],
    runAsNode: environment.ELECTRON_RUN_AS_NODE === "1",
  });
});

/**
 * `supaterm <subcommand> <args>` for a person to run on this host, via PATH, the package runner
 * this process came from, or this install's launcher path. `args` are quoted for the host's
 * shell: POSIX, or PowerShell on Windows.
 */
export const resolveHostCliCommand = Effect.fn("invocation.resolveHostCliCommand")(function* (
  subcommand: string,
  args: ReadonlyArray<string> = [],
) {
  const platform = yield* HostProcess.Platform;
  const withArgs = (prefix: string) =>
    [prefix, ...args.map((arg) => hostShellWord(platform, arg))].join(" ");
  const command = yield* resolveCliCommand(subcommand);
  if (command !== `supaterm ${subcommand}`) return { command: withArgs(command), launcher: false };
  if (yield* isCommandAvailable("supaterm")) return { command: withArgs(command), launcher: false };
  const launcher = yield* resolveInstallLauncher;
  if (Option.isNone(launcher)) return { command: withArgs(command), launcher: false };
  const quoted = launcher.value.words.map((word) => hostShellWord(platform, word)).join(" ");
  // PowerShell runs a quoted path only through the call operator.
  const call = platform === "win32" ? `& ${quoted}` : quoted;
  const runAsNode = launcher.value.runAsNode ? electronRunAsNodePrefix(platform) : "";
  return { command: withArgs(`${runAsNode}${call} ${subcommand}`), launcher: true };
});

export const resolveRootCliCommand = Effect.fn("invocation.resolveRootCliCommand")(function* (
  subcommand: string,
) {
  const { command, launcher } = yield* resolveHostCliCommand(subcommand);
  if (launcher) return `sudo ${command}`;
  const executablePath = yield* HostProcess.ExecutablePath;
  const systemNode = ROOT_PATH_DIRECTORIES.some((directory) =>
    executablePath.startsWith(`${directory}/`),
  );
  return systemNode ? `sudo ${command}` : `sudo env "PATH=$PATH" ${command}`;
});

const ROOT_PATH_DIRECTORIES = [
  "/usr/local/sbin",
  "/usr/local/bin",
  "/usr/sbin",
  "/usr/bin",
  "/sbin",
  "/bin",
];
