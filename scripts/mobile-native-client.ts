import { FetchHttpClient } from "effect/http";
import * as Option from "effect/Option";
import * as DateTime from "effect/DateTime";
import * as Context from "effect/Context";
import * as Clock from "effect/Clock";
import * as NodeRuntime from "@effect/platform-node/NodeRuntime";
import * as NodeServices from "@effect/platform-node/NodeServices";
import * as HostProcess from "@supaterm/shared/HostProcess";
import { isCommandAvailable, resolveSpawnCommand } from "@supaterm/shared/shell";
import * as Console from "effect/Console";
import * as Effect from "effect/Effect";
import * as FileSystem from "effect/FileSystem";
import * as Path from "effect/Path";
import * as Schema from "effect/Schema";
import * as Stream from "effect/Stream";
import { Argument, Command, Flag } from "effect/cli";
import { ChildProcess, ChildProcessSpawner } from "effect/process";

import {
  NativeClientError,
  type NativePlatform,
  acquireArtifact,
  artifactNames,
  describe,
  digest,
  hashBundle,
  prune,
  publish,
  reportTelemetry,
  sharedSource,
} from "./mobile-native-artifact.ts";

export { NativeClientError, hashBundle };
export type { NativePlatform };

const NativeClientRecord = Schema.Struct({ fingerprint: Schema.String, binary: Schema.String });
const encodeRecord = Schema.encodeEffect(Schema.fromJsonString(NativeClientRecord));
const decodeRecord = Schema.decodeUnknownEffect(Schema.fromJsonString(NativeClientRecord));
const encodeOutput = Schema.encodeEffect(Schema.fromJsonString(Schema.Unknown));
const decodeSimulators = Schema.decodeUnknownEffect(
  Schema.fromJsonString(
    Schema.Struct({
      devices: Schema.Record(
        Schema.String,
        Schema.Array(
          Schema.Struct({ udid: Schema.String, state: Schema.String, name: Schema.String }),
        ),
      ),
    }),
  ),
);
export type NativeClientRecord = typeof NativeClientRecord.Type;
export type NativeClientStatus = "compatible" | "missing" | "unknown" | "stale";
export function clientStatus(
  fingerprint: string,
  binary: string | null,
  record: NativeClientRecord | null,
): NativeClientStatus {
  if (binary === null) return "missing";
  if (!record || record.binary !== binary) return "unknown";
  return record.fingerprint === fingerprint ? "compatible" : "stale";
}

export const ensureClient = Effect.fn("ensureClient")(function* <E, R, E2, R2>(operations: {
  fingerprint: Effect.Effect<string, E, R>;
  installedBinary: Effect.Effect<string | null, E, R>;
  readRecord: Effect.Effect<NativeClientRecord | null, E, R>;
  build: Effect.Effect<void, E, R>;
  saveRecord: (record: NativeClientRecord) => Effect.Effect<void, E2, R2>;
}) {
  const fingerprint = yield* operations.fingerprint;
  const status = clientStatus(
    fingerprint,
    yield* operations.installedBinary,
    yield* operations.readRecord,
  );
  const verifyInputs = Effect.gen(function* () {
    if ((yield* operations.fingerprint) !== fingerprint) {
      return yield* new NativeClientError({
        message:
          "Native inputs changed during verification. Run ensure again; this build was not recorded.",
      });
    }
  });
  yield* verifyInputs;
  if (status === "compatible") {
    return { status, rebuilt: false, fingerprint };
  }
  yield* operations.build;
  const binary = yield* operations.installedBinary;
  if (binary === null)
    return yield* new NativeClientError({
      message: "Build finished but the development client is not installed.",
    });
  yield* verifyInputs;
  yield* operations.saveRecord({ fingerprint, binary });
  return { status: "compatible" as const, rebuilt: true, fingerprint };
});

const bundleId = "com.supaterm.mobile.dev";
const roots = Effect.gen(function* () {
  const path = yield* Path.Path;
  const repo = yield* path.fromFileUrl(new URL("../", import.meta.url));
  return { repo, mobile: path.join(repo, "apps/mobile") };
});
const collect = <E>(stream: Stream.Stream<Uint8Array, E>) =>
  stream.pipe(
    Stream.decodeText(),
    Stream.runFold(
      () => "",
      (a, b) => a + b,
    ),
  );
export const resolveAdb = Effect.gen(function* () {
  if (yield* isCommandAvailable("adb")) return "adb";
  const environment = yield* HostProcess.Environment;
  const path = yield* Path.Path;
  const executable = (yield* HostProcess.Platform) === "win32" ? "adb.exe" : "adb";
  for (const sdk of [environment.ANDROID_SDK_ROOT, environment.ANDROID_HOME]) {
    if (!sdk) continue;
    const candidate = path.join(sdk, "platform-tools", executable);
    if (yield* isCommandAvailable(candidate)) return candidate;
  }
  return yield* new NativeClientError({
    message:
      "adb was not found on PATH or in ANDROID_SDK_ROOT/ANDROID_HOME. Install Android SDK platform-tools.",
  });
});

const BuildLog = Context.Reference<string | null>("nativeClient/BuildLog", {
  defaultValue: () => null,
});

const command = Effect.fn("nativeClient.command")(function* (
  program: string,
  args: string[],
  inherit = false,
  cwd?: string,
) {
  const spawner = yield* ChildProcessSpawner.ChildProcessSpawner;
  const environment = yield* HostProcess.Environment;
  const log = inherit ? yield* BuildLog : null;
  const spawn = yield* resolveSpawnCommand(program === "adb" ? yield* resolveAdb : program, args);
  const child = yield* spawner.spawn(
    ChildProcess.make(spawn.command, spawn.args, {
      shell: spawn.shell,
      cwd: cwd ?? (yield* roots).mobile,
      env: {
        ...environment,
        APP_VARIANT: "development",
        MOBILE_VERSION_POLICY: "appVersion",
        SUPATERM_IOS_PERSONAL_TEAM: "0",
        CI: "1",
        EXPO_NO_GIT_STATUS: "1",

        COPYFILE_DISABLE: "1",
      },
      stdin: "ignore",
      stdout: inherit && !log ? "inherit" : "pipe",
      stderr: inherit && !log ? "inherit" : "pipe",
    }),
  );
  if (log) {
    const fs = yield* FileSystem.FileSystem;
    const append = <E>(stream: Stream.Stream<Uint8Array, E>) =>
      stream.pipe(Stream.run(fs.sink(log, { flag: "a" })));
    const [, , code] = yield* Effect.all(
      [append(child.stdout), append(child.stderr), child.exitCode],
      { concurrency: "unbounded" },
    );
    if (code === 0) return "";
    const tail = (yield* fs.readFileString(log)).trimEnd().split("\n").slice(-40).join("\n");
    return yield* new NativeClientError({
      message: `${program} ${args[0]} failed (${code}). Last lines:\n${tail}\nFull log: ${log}`,
    });
  }
  const [stdout, stderr, code] = yield* Effect.all(
    [collect(child.stdout), collect(child.stderr), child.exitCode],
    { concurrency: "unbounded" },
  );
  if (code !== 0)
    return yield* new NativeClientError({
      message: `${program} ${args[0]} failed (${code}): ${stderr || "see build output"}`,
    });
  return stdout.trim();
}, Effect.scoped);

const fingerprint = Effect.fn("nativeClient.fingerprint")(function* (platform: NativePlatform) {
  const output = yield* command(yield* HostProcess.ExecutablePath, [
    "--eval",

    `const f = require('expo/fingerprint'); f.createFingerprintAsync(process.cwd(), { platforms: [process.argv[1]], silent: true, ignorePaths: ['android/**', 'ios/**'], sourceSkips: f.DEFAULT_SOURCE_SKIPS | f.SourceSkips.ExpoConfigExtraSection }).then(fp => console.log('SUPATERM_NATIVE_FINGERPRINT=' + fp.hash)).catch(e => { console.error(e); process.exitCode = 1; });`,
    platform,
  ]);
  const hash = output
    .split("\n")
    .find((line) => line.startsWith("SUPATERM_NATIVE_FINGERPRINT="))
    ?.split("=")[1];
  if (!hash || !/^[a-f0-9]{40,64}$/.test(hash))
    return yield* new NativeClientError({ message: "Expo did not return a native fingerprint." });
  return hash;
});

const runtimeName = (runtime: string) =>
  runtime
    .replace(/^com\.apple\.CoreSimulator\.SimRuntime\./, "")
    .replace(/-(\d+)-(\d+)$/, " $1.$2");

const resolveDevice = Effect.fn("nativeClient.resolveDevice")(function* (
  platform: NativePlatform,
  requested: string | undefined,
) {
  const choose = (candidates: ReadonlyArray<{ id: string; label: string }>, problem: string) =>
    new NativeClientError({
      message: [
        problem,
        ...candidates.map(
          ({ id, label }) => `  vp run mobile:install ${platform} ${id}   # ${label}`,
        ),
      ].join("\n"),
    });
  if (platform === "ios") {
    if ((yield* HostProcess.Platform) !== "darwin")
      return yield* new NativeClientError({
        message: "Run iOS installs on the Mac that hosts the simulator.",
      });

    if ((yield* HostProcess.Architecture) !== "arm64")
      return yield* new NativeClientError({
        message: "mobile:install needs an Apple silicon Mac. Use vp run ios:dev on Intel Macs.",
      });
    const listing = yield* decodeSimulators(
      yield* command("xcrun", ["simctl", "list", "devices", "available", "--json"]),
    );
    const simulators = Object.entries(listing.devices).flatMap(([runtime, devices]) =>
      devices.map((device) => ({ ...device, label: `${device.name} (${runtimeName(runtime)})` })),
    );
    const booted = simulators
      .filter((simulator) => simulator.state === "Booted")
      .map(({ udid, label }) => ({ id: udid, label }));
    if (requested === undefined) {
      if (booted.length === 1) return booted[0]!;
      return yield* booted.length === 0
        ? new NativeClientError({
            message:
              "No iOS simulator is booted. Open one with device_open, or boot one: xcrun simctl boot <udid>",
          })
        : choose(booted, "Several iOS simulators are booted. Pick one:");
    }
    const simulator = simulators.find((entry) => entry.udid === requested);
    if (!simulator)
      return yield* choose(booted, `No available iOS simulator with UDID ${requested}. Booted:`);
    if (simulator.state !== "Booted")
      return yield* new NativeClientError({
        message: `Boot the selected simulator first: xcrun simctl boot ${requested}`,
      });
    return { id: simulator.udid, label: simulator.label };
  }
  const attached = (yield* command("adb", ["devices", "-l"]))
    .split("\n")
    .slice(1)
    .map((line) => line.trim().split(/\s+/))
    .filter((parts) => parts.length >= 2)
    .map(([id, state, ...details]) => ({
      id: id!,
      state: state!,
      label: details.find((detail) => detail.startsWith("model:"))?.slice(6) ?? id!,
    }));
  const ready = attached.filter((device) => device.state === "device");
  const device =
    requested === undefined ? ready : attached.filter((entry) => entry.id === requested);
  if (requested === undefined && ready.length !== 1)
    return yield* ready.length === 0
      ? new NativeClientError({
          message:
            "No Android emulator or phone is connected. Open one with device_open, or start an emulator.",
        })
      : choose(ready, "Several Android devices are connected. Pick one:");
  const selected = device[0];
  if (!selected)
    return yield* choose(ready, `Android device ${requested} is not connected. Ready:`);
  if (selected.state === "unauthorized")
    return yield* new NativeClientError({
      message: `Unlock ${selected.label} and accept the USB debugging prompt, then run this again.`,
    });
  if (selected.state !== "device")
    return yield* new NativeClientError({
      message: `Android device ${selected.id} is ${selected.state}, not ready.`,
    });

  const avd = selected.id.startsWith("emulator-")
    ? yield* command("adb", ["-s", selected.id, "emu", "avd", "name"]).pipe(
        Effect.map((output) => output.split("\n")[0]?.trim()),
        Effect.orElseSucceed(() => undefined),
      )
    : undefined;
  return { id: selected.id, label: avd || selected.label };
});

export const installedBinary = Effect.fn("installedBinary")(function* (
  platform: NativePlatform,
  device: string,
  run: typeof command = command,
) {
  if (platform === "ios") {
    const apps = yield* run("xcrun", ["simctl", "listapps", device]);
    if (!apps.includes(`"${bundleId}"`)) return null;
    return yield* hashBundle(
      yield* run("xcrun", ["simctl", "get_app_container", device, bundleId, "app"]),
    );
  }
  const installed = yield* run("adb", ["-s", device, "shell", "pm", "list", "packages", bundleId]);
  if (!installed.split("\n").some((line) => line.trim() === `package:${bundleId}`)) return null;
  const packages = yield* run("adb", ["-s", device, "shell", "pm", "path", bundleId]);
  const apks = packages
    .split("\n")
    .filter((line) => line.startsWith("package:"))
    .map((line) => line.slice(8).trim())
    .sort();
  if (apks.length === 0) return null;
  const hashes = yield* Effect.forEach(apks, (apk) =>
    Effect.gen(function* () {
      if (!/^\/[\w/+=.~-]+\.apk$/.test(apk))
        return yield* new NativeClientError({ message: "Unexpected installed APK path." });
      const hash = (yield* run("adb", ["-s", device, "shell", "sha256sum", apk])).split(/\s/)[0];
      if (!hash || !/^[a-f0-9]{64}$/.test(hash))
        return yield* new NativeClientError({ message: "Could not hash installed APK." });
      return hash;
    }),
  );
  return yield* digest(hashes.sort().join("\n"));
});

export const prebuildAndroid = Effect.fn("nativeClient.prebuildAndroid")(function* <E, R>(
  mobile: string,
  prebuild: Effect.Effect<void, E, R>,
) {
  const fs = yield* FileSystem.FileSystem;
  const path = yield* Path.Path;
  const android = path.join(mobile, "android");

  const saved = path.join(mobile, ".android-cache");
  const caches = [".gradle", "app/.cxx"];
  const clear = fs.remove(saved, { recursive: true, force: true }).pipe(Effect.ignore);
  const move = (from: string, to: string) =>
    Effect.forEach(
      caches,
      (cache) =>
        Effect.gen(function* () {
          const source = path.join(from, cache);
          const target = path.join(to, cache);
          if (!(yield* fs.exists(source)) || (yield* fs.exists(target))) return;
          yield* fs.makeDirectory(path.dirname(target), { recursive: true });
          yield* fs.rename(source, target);
        }).pipe(Effect.ignore),
      { discard: true },
    );
  yield* Effect.acquireUseRelease(
    clear.pipe(Effect.andThen(move(android, saved))),
    () => prebuild,
    () => move(saved, android).pipe(Effect.andThen(clear)),
  );
});

const decodeEasBuilds = Schema.decodeUnknownEffect(
  Schema.fromJsonString(
    Schema.Array(Schema.Struct({ artifacts: Schema.Struct({ buildUrl: Schema.String }) })),
  ),
);

const easCli = "eas-cli@25.3.0";

const hasXcode = Effect.gen(function* () {
  if ((yield* HostProcess.Platform) !== "darwin") return false;
  return yield* command("xcrun", ["--find", "xcodebuild"]).pipe(
    Effect.as(true),
    Effect.orElseSucceed(() => false),
  );
});

const buildIosOnEas = Effect.fn("nativeClient.buildIosOnEas")(function* (staging: string) {
  const fs = yield* FileSystem.FileSystem;
  const path = yield* Path.Path;

  yield* command("npx", ["-y", easCli, "whoami"]).pipe(
    Effect.mapError(
      () =>
        new NativeClientError({
          message:
            "iOS builds need Xcode on macOS, or an EAS login (`npx eas-cli login`, or EXPO_TOKEN) to build in the cloud.",
        }),
    ),
  );
  yield* Console.error("No Xcode here; building the iOS simulator client on EAS (10-30 min).");
  const [build] = yield* decodeEasBuilds(
    yield* command("npx", [
      "-y",
      easCli,
      "build",
      "--platform",
      "ios",
      "--profile",
      "development-simulator",
      "--non-interactive",
      "--wait",
      "--json",
    ]),
  );
  if (!build) return yield* new NativeClientError({ message: "EAS returned no build." });
  const archive = path.join(staging, "eas-build.tar.gz");
  yield* command("curl", ["-fsSL", "--retry", "3", "-o", archive, build.artifacts.buildUrl]);
  yield* command("tar", ["-xzf", archive, "-C", staging]);
  yield* fs.remove(archive);
  const app = (yield* fs.readDirectory(staging)).find((name) => name.endsWith(".app"));
  if (!app) return yield* new NativeClientError({ message: "The EAS build archive has no .app." });
  if (app !== artifactNames.ios)
    yield* fs.rename(path.join(staging, app), path.join(staging, artifactNames.ios));
});

const build = Effect.fn("nativeClient.build")(function* (
  platform: NativePlatform,
  abi: string | null,
  target: string,
  expected: string,
) {
  const fs = yield* FileSystem.FileSystem;
  const path = yield* Path.Path;
  const { repo, mobile } = yield* roots;
  const tracked = yield* command("git", ["ls-files", `apps/mobile/${platform}`], false, repo);
  if (tracked)
    return yield* new NativeClientError({
      message: "Native directory contains tracked files; clean prebuild would overwrite them.",
    });
  const prebuild = command(
    "vp",
    ["exec", "expo", "prebuild", "--clean", "--platform", platform, "--no-install"],
    true,
  ).pipe(Effect.asVoid);
  const onEas = platform === "ios" && !(yield* hasXcode);
  if (platform === "android") yield* prebuildAndroid(mobile, prebuild);
  else if (!onEas) yield* prebuild;
  const staging = yield* fs.makeTempDirectory({
    directory: path.dirname(target),
    prefix: ".build-",
  });
  yield* Effect.gen(function* () {
    if (onEas) {
      yield* buildIosOnEas(staging);
    } else if (platform === "ios") {
      const output = yield* fs.makeTempDirectoryScoped({ prefix: "supaterm-native-client-" });
      yield* command("pod", ["install"], true, path.join(mobile, "ios"));

      yield* command(
        "xcrun",
        [
          "xcodebuild",
          "-workspace",
          path.join(mobile, "ios/SupatermDev.xcworkspace"),
          "-scheme",
          "SupatermDev",
          "-configuration",
          "Debug",
          "-destination",
          "generic/platform=iOS Simulator",
          "-derivedDataPath",
          output,
          "ARCHS=arm64",
          "ONLY_ACTIVE_ARCH=NO",
          "build",
        ],
        true,
      );
      yield* command("ditto", [
        path.join(output, "Build/Products/Debug-iphonesimulator", artifactNames.ios),
        path.join(staging, artifactNames.ios),
      ]);
    } else {
      const android = path.join(mobile, "android");
      yield* command(
        path.join(android, (yield* HostProcess.Platform) === "win32" ? "gradlew.bat" : "gradlew"),
        ["app:assembleDebug", `-PreactNativeArchitectures=${abi}`],
        true,
        android,
      );
      yield* fs.copyFile(
        path.join(android, "app/build/outputs/apk/debug", artifactNames.android),
        path.join(staging, artifactNames.android),
      );
    }

    if ((yield* fingerprint(platform)) !== expected)
      return yield* new NativeClientError({
        message: "Native inputs changed during the build, so it was discarded. Run this again.",
      });
    yield* publish(staging, target);
  }).pipe(
    Effect.scoped,
    Effect.ensuring(fs.remove(staging, { recursive: true, force: true }).pipe(Effect.ignore)),
  );
});

export const resolveArtifact = Effect.fn("nativeClient.resolveArtifact")(function* (
  home: string,
  platform: NativePlatform,
  abi: string | null,
  fingerprint: string,
) {
  return yield* acquireArtifact(home, platform, abi, fingerprint, {
    build: Effect.fn(function* (directory: string) {
      const log = yield* BuildLog;
      const key = `${platform}/${abi ? `development-${abi}` : "development"}/${fingerprint}`;
      yield* Console.error(
        `No cached client for ${key}. Building it once for every machine (5-15 min)${log ? `. Log: ${log}` : ""}`,
      );
      const started = yield* Clock.currentTimeMillis;
      yield* build(platform, abi, directory, fingerprint);
      return (yield* Clock.currentTimeMillis) - started;
    }),
    tar: (args) => command("tar", args),
  });
});

const install = Effect.fn("nativeClient.install")(function* (
  platform: NativePlatform,
  device: string,
  file: string,
) {
  if (platform === "ios") {
    yield* command("xcrun", ["simctl", "install", device, file], true);
    return;
  }
  yield* command("adb", ["-s", device, "install", "-r", "-d", file]).pipe(
    Effect.catchTags({
      NativeClientError: (error) =>
        Effect.fail(
          error.message.includes("INSTALL_FAILED_UPDATE_INCOMPATIBLE")
            ? new NativeClientError({
                message: `The installed client has a different signature. Remove it with adb -s ${device} uninstall ${bundleId} (this clears its pairings), then run ensure again.`,
              })
            : error,
        ),
    }),
  );

  if ((yield* command("adb", ["-s", device, "shell", "getprop", "ro.kernel.qemu"])) !== "1")
    yield* command("adb", ["-s", device, "reverse", "tcp:8081", "tcp:8081"]).pipe(Effect.ignore);
});

const installIntoSession = Effect.fn("nativeClient.installIntoSession")(function* (
  home: string,
  platform: NativePlatform,
  session: string,
  abi: string,
  metro: string | undefined,
  launcher: string | undefined,
  config: string | undefined,
) {
  const started = yield* Clock.currentTimeMillis;
  const path = yield* Path.Path;
  const node = yield* HostProcess.ExecutablePath;
  const agentDevice = path.join(
    (yield* roots).repo,
    "scripts/node_modules/agent-device/bin/agent-device.mjs",
  );

  const workspace = yield* HostProcess.WorkingDirectory;
  const script = launcher ?? agentDevice;
  const launchWithNode = /\.[cm]?js$/.test(script);
  const sessionRun = (args: ReadonlyArray<string>) =>
    command(
      launchWithNode ? node : script,
      [
        ...(launchWithNode ? [script] : []),
        ...args,
        ...(config ? ["--config", config] : []),
        "--session",
        session,
      ],
      true,
      workspace,
    );
  const deviceAbi = platform === "android" ? abi : null;
  const task = deviceAbi ? `native-client:android-${deviceAbi}` : `native-client:${platform}`;
  const current = yield* fingerprint(platform);
  const key = `${platform}/${deviceAbi ? `development-${deviceAbi}` : "development"}/${current}`;
  const source = yield* sharedSource(home, key);

  const downloadOnDevice = source
    ? sessionRun(["install-from-source", source.url, "--header", source.header]).pipe(
        Effect.as(true),
        Effect.catch((error) =>
          Console.error(`The device could not download ${key} (${describe(error)}).`).pipe(
            Effect.as(false),
          ),
        ),
      )
    : Effect.succeed(false);
  const fetched = yield* downloadOnDevice;
  const artifact = fetched
    ? { source: "remote" as const, buildMs: 0 }
    : yield* Effect.gen(function* () {
        const local = yield* resolveArtifact(home, platform, deviceAbi, current).pipe(
          Effect.tapError(() => reportTelemetry(home, task, "failed", 0)),
        );

        if (local.source === "build" && (yield* downloadOnDevice)) return local;
        yield* Console.error(`Installing into agent-device session ${session}...`);
        yield* sessionRun(["install", bundleId, local.file]);
        return local;
      });
  if (metro) {
    const url = encodeURIComponent(metro);
    yield* sessionRun([
      "open",
      bundleId,
      `supaterm-dev://expo-development-client/?url=${url}&__expo_disable_onboarding=1&__expo_disable_fab=1&__expo_disable_auto_launch=1`,
    ]);
  }
  yield* reportTelemetry(
    home,
    task,
    artifact.source === "build" ? "executed" : artifact.source,
    artifact.buildMs,
  );
  const seconds = Math.round(((yield* Clock.currentTimeMillis) - started) / 1000);
  yield* Console.error(
    `Installed into session ${session} in ${seconds}s (${artifact.source}).${metro ? "" : " Open it with Metro: --metro http://<this-machine>:8081."}`,
  );
  yield* Console.log(
    yield* encodeOutput({
      status: "installed",
      source: artifact.source,
      fingerprint: current,
      session,
      seconds,
    }),
  );
});

const main = Command.make(
  "mobile-native-client",
  {
    mode: Argument.Literals("mode", ["check", "ensure"]),
    platform: Argument.Literals("platform", ["ios", "android"]),
    device: Argument.String("device").pipe(Argument.optional),
    agentDevice: Flag.String("agent-device").pipe(Flag.optional),
    config: Flag.String("config").pipe(Flag.optional),
    session: Flag.String("session").pipe(
      Flag.withDescription(
        "Install into this already-open agent-device session (a device pool, cloud, or remote host) instead of a local device.",
      ),
      Flag.optional,
    ),
    abi: Flag.Literals("abi", ["x86_64", "arm64-v8a"]).pipe(
      Flag.withDescription("Android ABI of the session's device (default x86_64)."),
      Flag.withDefault("x86_64" as const),
    ),
    metro: Flag.String("metro").pipe(
      Flag.withDescription("With --session, open the dev client against this Metro URL."),
      Flag.optional,
    ),
    prepare: Flag.Boolean("prepare").pipe(
      Flag.withDescription(
        "Fetch or build the client for this checkout without a device (Android: for --abi). Run it before leasing a device: a build can outlast the lease.",
      ),
      Flag.withDefault(false),
    ),
  },
  Effect.fn("nativeClient.main")(function* ({
    mode,
    platform,
    device: requested,
    session,
    abi: sessionAbi,
    metro,
    prepare,
    agentDevice,
    config,
  }) {
    const started = yield* Clock.currentTimeMillis;
    if (prepare) {
      if (mode !== "ensure" || Option.isSome(requested) || Option.isSome(session))
        return yield* new NativeClientError({
          message: "--prepare needs no device; use it with ensure and no device id or --session.",
        });
      const environment = yield* HostProcess.Environment;
      const home = environment.HOME ?? environment.USERPROFILE;
      if (!home)
        return yield* new NativeClientError({ message: "HOME or USERPROFILE must be set." });
      const current = yield* fingerprint(platform);
      const artifact = yield* resolveArtifact(
        home,
        platform,
        platform === "android" ? sessionAbi : null,
        current,
      );
      yield* Console.error(
        `Client ready for ${platform} (${artifact.source}); lease a device and install.`,
      );
      return yield* Console.log(
        yield* encodeOutput({
          status: "ready",
          source: artifact.source,
          fingerprint: current,
          file: artifact.file,
        }),
      );
    }
    if (Option.isSome(session)) {
      if (mode !== "ensure" || Option.isSome(requested))
        return yield* new NativeClientError({
          message:
            "--session installs into an agent-device session; use it with ensure and no device id.",
        });
      const environment = yield* HostProcess.Environment;
      const home = environment.HOME ?? environment.USERPROFILE;
      if (!home)
        return yield* new NativeClientError({ message: "HOME or USERPROFILE must be set." });
      return yield* installIntoSession(
        home,
        platform,
        session.value,
        sessionAbi,
        Option.getOrUndefined(metro),
        Option.getOrUndefined(agentDevice),
        Option.getOrUndefined(config),
      );
    }
    const target = yield* resolveDevice(platform, Option.getOrUndefined(requested));
    const device = target.id;
    yield* Console.error(`Device: ${target.label} (${device})`);
    const fs = yield* FileSystem.FileSystem;
    const path = yield* Path.Path;
    const environment = yield* HostProcess.Environment;
    const home = environment.HOME ?? environment.USERPROFILE;
    if (!home)
      return yield* new NativeClientError({
        message: "HOME or USERPROFILE must be set to store native client records.",
      });
    const cache = path.join(home, ".cache/supaterm/native-clients");
    const recordPath = path.join(cache, platform, `${yield* digest(device)}.json`);

    const abi = Effect.gen(function* () {
      if (platform === "ios") return null;
      const value = yield* command("adb", ["-s", device, "shell", "getprop", "ro.product.cpu.abi"]);
      if (value !== "x86_64" && value !== "arm64-v8a")
        return yield* new NativeClientError({ message: `Unsupported Android ABI ${value}.` });
      return value;
    });
    let task = `native-client:${platform}`;
    let savedMs = 0;
    let artifactSource: "local" | "remote" | "build" | undefined;
    const operations = {
      fingerprint: fingerprint(platform),
      installedBinary: installedBinary(platform, device),
      readRecord: fs.readFileString(recordPath).pipe(
        Effect.flatMap(decodeRecord),
        Effect.catchTags({ SchemaError: () => Effect.succeed(null) }),
        Effect.catchIf(
          (error) => error.reason._tag === "NotFound",
          () => Effect.succeed(null),
        ),
      ),
      build: Effect.gen(function* () {
        const current = yield* fingerprint(platform);
        const deviceAbi = yield* abi;
        if (deviceAbi) task = `native-client:android-${deviceAbi}`;
        const artifact = yield* resolveArtifact(home, platform, deviceAbi, current);
        savedMs = artifact.buildMs;
        yield* Console.error(`Installing on ${target.label}...`);
        yield* install(platform, device, artifact.file);
        artifactSource = artifact.source;
      }),
      saveRecord: Effect.fn(function* (record: NativeClientRecord) {
        yield* fs.makeDirectory(path.dirname(recordPath), { recursive: true });
        yield* fs.writeFileString(recordPath, yield* encodeRecord(record));
      }),
    };
    if (mode === "check") {
      const current = yield* operations.fingerprint;
      const status = clientStatus(
        current,
        yield* operations.installedBinary,
        yield* operations.readRecord,
      );
      yield* Console.log(
        yield* encodeOutput({
          status,
          fingerprint: current,
          device,
          next:
            status === "compatible"
              ? "Start Metro with vp run dev:client"
              : `vp run mobile:install ${platform} ${device}`,
        }),
      );
      process.exitCode = status === "compatible" ? 0 : 2;
      return;
    }
    const logs = path.join(cache, "logs");
    yield* fs.makeDirectory(logs, { recursive: true });
    yield* prune(logs, "");
    const stamp = DateTime.formatIso(DateTime.makeUnsafe(started)).replaceAll(":", "-");
    const log = path.join(logs, `${stamp}-${platform}.log`);
    const result = yield* ensureClient(operations).pipe(
      Effect.provideService(
        BuildLog,
        environment.SUPATERM_NATIVE_CLIENT_VERBOSE === "1" ? null : log,
      ),
      Effect.tapError(() => reportTelemetry(home, task, "failed", 0)),
    );
    if (result.rebuilt && artifactSource)
      yield* reportTelemetry(
        home,
        task,
        artifactSource === "build" ? "executed" : artifactSource,
        artifactSource === "build" ? 0 : savedMs,
      );
    const seconds = Math.round(((yield* Clock.currentTimeMillis) - started) / 1000);
    yield* Console.error(
      result.rebuilt
        ? `Installed on ${target.label} in ${seconds}s (${artifactSource}). Next: start Metro with vp run dev:client.`
        : `${target.label} already has the client for this checkout. Next: start Metro with vp run dev:client.`,
    );
    yield* Console.log(yield* encodeOutput({ ...result, source: artifactSource, device, seconds }));
  }),
);

if (import.meta.main) {
  Command.run(main, { version: "0.0.0" }).pipe(
    Effect.catchTags({
      NativeClientError: (error) =>
        Console.error(error.message).pipe(
          Effect.andThen(Effect.sync(() => (process.exitCode = 1))),
        ),
    }),
    Effect.scoped,
    Effect.provide([NodeServices.layer, FetchHttpClient.layer]),
    NodeRuntime.runMain,
  );
}
