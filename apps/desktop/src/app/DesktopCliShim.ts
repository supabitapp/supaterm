import * as Cause from "effect/Cause";
import * as Effect from "effect/Effect";
import * as FileSystem from "effect/FileSystem";
import * as Option from "effect/Option";

import * as DesktopEnvironment from "./DesktopEnvironment.ts";
import { makeComponentLogger } from "./DesktopObservability.ts";

const { logInfo, logWarning } = makeComponentLogger("desktop-cli-shim");

export const MARKER = "Written by Supaterm: runs the desktop app's bundled supaterm CLI.";

const SERVER_ENTRY = "apps/server/dist/bin.mjs";

const shellWord = (value: string) => `'${value.replaceAll("'", `'"'"'`)}'`;

const cmdText = (value: string) => value.replaceAll("%", "%%");
const cmdWord = (value: string) => `"${cmdText(value)}"`;

const MOVED = "Supaterm has moved or been removed. Open the app once to update this command.";

export type CliShimTarget =
  | { readonly kind: "appimage"; readonly appImage: string; readonly executableName: string }
  | { readonly kind: "direct"; readonly executable: string; readonly entry: string }
  | { readonly kind: "windows"; readonly executable: string; readonly entry: string };

export const renderCliShim = (input: {
  readonly target: CliShimTarget;
  readonly shimPath: string;
  readonly supatermHome: string;
}) => {
  const { target } = input;
  if (target.kind === "windows") {
    const utf8 = [target.executable, target.entry, input.shimPath, input.supatermHome].some(
      (value) => [...value].some((character) => character.codePointAt(0)! > 0x7f),
    );
    const restore = utf8 ? ["chcp %supaterm_codepage% >nul"] : [];
    return [
      "@echo off",
      `rem ${MARKER}`,

      "setlocal EnableExtensions DisableDelayedExpansion",

      ...(utf8
        ? [
            `for /f "tokens=2 delims=:." %%c in ('chcp') do set "supaterm_codepage=%%c"`,
            "chcp 65001 >nul",
          ]
        : []),
      `set "SUPATERM_CLI_SHIM_PATH=${cmdText(input.shimPath)}"`,
      `if not defined SUPATERM_HOME set "SUPATERM_HOME=${cmdText(input.supatermHome)}"`,
      'set "ELECTRON_RUN_AS_NODE=1"',
      'set "SUPATERM_DESKTOP_CLI_LAUNCHER=1"',

      `if exist ${cmdWord(target.executable)} goto run`,
      ...restore,
      `echo ${MOVED} 1>&2`,
      "exit /b 127",
      ":run",
      `${cmdWord(target.executable)} ${cmdWord(target.entry)} %*`,
      'set "supaterm_exit=%ERRORLEVEL%"',
      ...restore,
      "exit /b %supaterm_exit%",
      "",
    ].join("\r\n");
  }
  const header = [
    "#!/bin/sh",
    `# ${MARKER}`,
    `export SUPATERM_CLI_SHIM_PATH=${shellWord(input.shimPath)}`,
    `home=${shellWord(input.supatermHome)}`,
    'export SUPATERM_HOME="${SUPATERM_HOME:-$home}"',
    "export ELECTRON_RUN_AS_NODE=1",
    `app=${shellWord(target.kind === "appimage" ? target.appImage : target.executable)}`,
    'if [ ! -x "$app" ]; then',
    `  echo "${MOVED}" >&2`,
    "  exit 127",
    "fi",
  ];
  if (target.kind === "direct") {
    return [...header, `exec "$app" ${shellWord(target.entry)} "$@"`, ""].join("\n");
  }
  const run = (root: string) =>
    `"${root}/${target.executableName}" "${root}/resources/app.asar/${SERVER_ENTRY}" "$@"`;
  return [
    ...header,

    "unset APPIMAGE_EXTRACT_AND_RUN",

    "work=$(mktemp -d) || exit 1",
    'setsid "$app" --appimage-mount >"$work/mount" 2>/dev/null &',
    "mounter=$!",
    `trap 'kill "$mounter" 2>/dev/null; rm -rf "$work"' EXIT`,
    "trap 'exit 130' INT TERM HUP",
    "mount=",
    'while kill -0 "$mounter" 2>/dev/null; do',
    '  mount=$(head -n 1 "$work/mount")',
    '  [ -d "$mount" ] && break',
    "  mount=",
    "  sleep 0.05",
    "done",

    'if [ -z "$mount" ]; then',
    '  (cd "$work" && "$app" --appimage-extract >/dev/null) || { echo "Could not open $app." >&2; exit 1; }',
    '  mount="$work/squashfs-root"',
    "fi",
    run("$mount"),
    "",
  ].join("\n");
};

export const launcherPath = (environment: DesktopEnvironment.DesktopEnvironment["Service"]) =>
  environment.path.join(
    environment.baseDir,
    "bin",
    environment.platform === "win32" ? "supaterm.cmd" : "supaterm",
  );

export const install = Effect.gen(function* () {
  const environment = yield* DesktopEnvironment.DesktopEnvironment;
  if (!environment.isPackaged) return Option.none<string>();
  const fs = yield* FileSystem.FileSystem;
  const path = environment.path;
  const windows = environment.platform === "win32";
  const shimPath = launcherPath(environment);
  const entry = path.join(environment.serverRoot, SERVER_ENTRY);
  const target: CliShimTarget = windows
    ? { kind: "windows", executable: process.execPath, entry }
    : Option.match(environment.appImagePath, {
        onSome: (appImage) => ({
          kind: "appimage" as const,
          appImage,
          executableName: path.basename(process.execPath),
        }),

        onNone: () => ({ kind: "direct" as const, executable: process.execPath, entry }),
      });
  const content = renderCliShim({ target, shimPath, supatermHome: environment.baseDir });

  return yield* Effect.gen(function* () {
    const existing = yield* fs.readFileString(shimPath).pipe(Effect.option);
    if (Option.isSome(existing) && !existing.value.includes(MARKER)) {
      yield* logWarning("leaving a supaterm launcher the app did not write", { shimPath });
      return Option.none<string>();
    }
    if (Option.getOrUndefined(existing) !== content) {
      yield* fs.makeDirectory(path.dirname(shimPath), { recursive: true });

      const stagingDirectory = yield* fs.makeTempDirectoryScoped({
        directory: path.dirname(shimPath),
        prefix: ".supaterm-cli-",
      });
      const staging = path.join(stagingDirectory, path.basename(shimPath));
      yield* fs.writeFileString(staging, content, { mode: 0o755 });
      yield* fs.rename(staging, shimPath);
      yield* logInfo("installed supaterm launcher", { shimPath });
    }
    return Option.some(shimPath);
  }).pipe(
    Effect.scoped,
    Effect.catchCause((cause) =>
      logWarning("could not install supaterm launcher", {
        shimPath,
        cause: Cause.pretty(cause),
      }).pipe(Effect.as(Option.none<string>())),
    ),
    Effect.withSpan("desktop.cliShim.install"),
  );
});
