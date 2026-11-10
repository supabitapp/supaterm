import type { SidePulseEjectGuardStatus } from "@supaterm/contracts";
import * as Context from "effect/Context";
import * as Effect from "effect/Effect";
import * as FileSystem from "effect/FileSystem";
import * as Layer from "effect/Layer";
import * as Schema from "effect/Schema";
import * as Stream from "effect/Stream";
import * as ChildProcess from "effect/process/ChildProcess";
import * as ChildProcessSpawner from "effect/process/ChildProcessSpawner";

import * as DesktopEnvironment from "../app/DesktopEnvironment.ts";
import { makeComponentLogger } from "../app/DesktopObservability.ts";

export const LABEL = "com.supaterm.sidepulse-eject-guard";
export const DAEMON_PLIST = `/Library/LaunchDaemons/${LABEL}.plist`;
const INSTALLED_BINARY = "/Library/Application Support/Supaterm/sidepulse-eject-guard";
const LOG_FILE = "/Library/Logs/Supaterm/sidepulse-eject-guard.log";
const BINARY_NAME = "supaterm-sd-eject-guard";

// macOS shows this above "Enter your password to allow this."
export const INSTALL_PROMPT =
  "Supaterm wants to install a background helper that keeps SidePulse connected when your Mac wakes from sleep.";
export const UNINSTALL_PROMPT =
  "Supaterm wants to remove the background helper that keeps SidePulse connected after sleep.";

// AppleScript error -128 is the user choosing Cancel in the password prompt.
const USER_CANCELED = /\(-128\)\s*$/;

const { logWarning } = makeComponentLogger("desktop-sidepulse");

export class SidePulseEjectGuardError extends Schema.TaggedError<SidePulseEjectGuardError>()(
  "SidePulseEjectGuardError",
  { operation: Schema.Literals(["install", "uninstall"]), detail: Schema.String },
) {
  override get message(): string {
    return `Could not ${this.operation} the SidePulse eject guard: ${this.detail}`;
  }
}

const shellQuote = (value: string) => `'${value.replaceAll("'", `'\\''`)}'`;

const daemonPlist = `<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
<dict>
  <key>Label</key><string>${LABEL}</string>
  <key>ProgramArguments</key><array><string>${INSTALLED_BINARY}</string></array>
  <key>RunAtLoad</key><true/>
  <key>KeepAlive</key><true/>
  <key>ProcessType</key><string>Background</string>
  <key>StandardOutPath</key><string>${LOG_FILE}</string>
  <key>StandardErrorPath</key><string>${LOG_FILE}</string>
</dict>
</plist>
`;

export const installScript = (bundledBinary: string, stagedPlist: string) =>
  [
    "set -e",
    `/usr/bin/install -d -m 755 -o root -g wheel ${shellQuote("/Library/Application Support/Supaterm")} /Library/Logs/Supaterm`,
    `/usr/bin/install -m 755 -o root -g wheel ${shellQuote(bundledBinary)} ${shellQuote(INSTALLED_BINARY)}`,
    `/usr/bin/install -m 644 -o root -g wheel ${shellQuote(stagedPlist)} ${DAEMON_PLIST}`,
    `/bin/launchctl bootout system/${LABEL} 2>/dev/null || true`,
    `/bin/launchctl bootstrap system ${DAEMON_PLIST}`,
  ].join("\n");

export const uninstallScript = [
  `/bin/launchctl bootout system/${LABEL} 2>/dev/null || true`,
  `/bin/rm -f ${DAEMON_PLIST} ${shellQuote(INSTALLED_BINARY)}`,
].join("\n");

export class SidePulseEjectGuard extends Context.Service<
  SidePulseEjectGuard,
  {
    readonly status: Effect.Effect<SidePulseEjectGuardStatus>;
    /** Asks macOS for an administrator password; cancelling leaves the status unchanged. */
    readonly setInstalled: (
      installed: boolean,
    ) => Effect.Effect<SidePulseEjectGuardStatus, SidePulseEjectGuardError>;
  }
>()("@supaterm/desktop/sidePulse/SidePulseEjectGuard") {}

export const make = Effect.fn("SidePulseEjectGuard.make")(function* (
  bundledBinary: string | undefined,
) {
  const fs = yield* FileSystem.FileSystem;
  const spawner = yield* ChildProcessSpawner.ChildProcessSpawner;

  const status = Effect.gen(function* () {
    if (yield* fs.exists(DAEMON_PLIST)) return "installed" as const;
    return bundledBinary === undefined ? ("unavailable" as const) : ("not-installed" as const);
  }).pipe(Effect.orElseSucceed(() => "unavailable" as const));

  const runAsAdministrator = (operation: "install" | "uninstall", script: string, prompt: string) =>
    Effect.scoped(
      Effect.gen(function* () {
        const handle = yield* spawner.spawn(
          ChildProcess.make(
            "/usr/bin/osascript",
            [
              "-e",
              "on run argv",
              "-e",
              "do shell script (item 1 of argv) with prompt (item 2 of argv) with administrator privileges",
              "-e",
              "end run",
              script,
              prompt,
            ],
            { stdin: "ignore", stdout: "ignore" },
          ),
        );
        const [stderr, exitCode] = yield* Effect.all(
          [handle.stderr.pipe(Stream.decodeText(), Stream.mkString), handle.exitCode],
          { concurrency: "unbounded" },
        );
        if (exitCode === 0 || USER_CANCELED.test(stderr.trim())) return;
        return yield* new SidePulseEjectGuardError({ operation, detail: stderr.trim() });
      }),
    ).pipe(
      Effect.catchTags({
        PlatformError: (cause) =>
          Effect.fail(new SidePulseEjectGuardError({ operation, detail: cause.message })),
      }),
      Effect.tapError((error) => logWarning(error.message)),
    );

  const install = Effect.scoped(
    Effect.gen(function* () {
      if (bundledBinary === undefined) {
        return yield* new SidePulseEjectGuardError({
          operation: "install",
          detail: "this build does not include the helper",
        });
      }
      const directory = yield* fs.makeTempDirectoryScoped({ prefix: "supaterm-eject-guard-" });
      const stagedPlist = `${directory}/${LABEL}.plist`;
      yield* fs.writeFileString(stagedPlist, daemonPlist);
      yield* runAsAdministrator(
        "install",
        installScript(bundledBinary, stagedPlist),
        INSTALL_PROMPT,
      );
    }),
  ).pipe(
    Effect.catchTags({
      PlatformError: (cause) =>
        Effect.fail(new SidePulseEjectGuardError({ operation: "install", detail: cause.message })),
    }),
  );

  const setInstalled = Effect.fn("SidePulseEjectGuard.setInstalled")(function* (
    installed: boolean,
  ) {
    yield* installed ? install : runAsAdministrator("uninstall", uninstallScript, UNINSTALL_PROMPT);
    return yield* status;
  });

  return SidePulseEjectGuard.of({ status, setInstalled });
});

export const layer = Layer.effect(
  SidePulseEjectGuard,
  Effect.gen(function* () {
    const environment = yield* DesktopEnvironment.DesktopEnvironment;
    const fs = yield* FileSystem.FileSystem;
    if (environment.platform !== "darwin") return yield* make(undefined);
    const candidates = environment.isPackaged
      ? [environment.path.join(environment.resourcesPath, "sd-eject-guard", BINARY_NAME)]
      : [
          environment.path.join(
            environment.rootDir,
            "native",
            "sd-eject-guard",
            "build",
            BINARY_NAME,
          ),
        ];
    const bundled = yield* Effect.findFirst(candidates, (candidate) =>
      fs.exists(candidate).pipe(Effect.orElseSucceed(() => false)),
    );
    return yield* make(bundled._tag === "Some" ? bundled.value : undefined);
  }),
);
