// @effect-diagnostics nodeBuiltinImport:off globalDate:off - This CLI owns its simulator and emulator processes.
import * as NodeProcess from "node:process";
import * as NodeChildProcess from "node:child_process";
import * as NodeFS from "node:fs";
import * as NodeFSP from "node:fs/promises";
import * as NodeNet from "node:net";
import * as NodePath from "node:path";

import {
  androidSdkTool,
  ensureIosFullScreenAppsMode,
  normalizeIosSimulator,
  resolveAndroidSdkRoot,
  stopProcess,
  suppressIosSystemFollowUps,
} from "../mobile-showcase.ts";
import { BUNDLE_ID } from "./build.ts";
import type { Snapshot } from "./checks.ts";
import type { Pose } from "./poses.ts";
import { delay, REPO_ROOT, run } from "./process.ts";

const AGENT_DEVICE_ENTRY = NodePath.join(
  REPO_ROOT,
  "scripts/node_modules/agent-device/bin/agent-device.mjs",
);

export async function stopDeviceDaemon(root: string) {
  await run(NodeProcess.execPath, [
    AGENT_DEVICE_ENTRY,
    "daemon",
    "stop",
    "--clean",
    "--state-dir",
    NodePath.join(root, "agent-device"),
  ]);
}

async function emulatorPort() {
  for (let port = 5554; port <= 5680; port += 2) {
    const sockets: NodeNet.Server[] = [];
    try {
      for (const candidate of [port, port + 1]) {
        const server = NodeNet.createServer();
        sockets.push(server);
        await new Promise<void>((resolve, reject) => {
          server.once("error", reject);
          server.listen(candidate, "127.0.0.1", resolve);
        });
      }
      return port;
    } catch {
      continue;
    } finally {
      for (const socket of sockets) socket.close();
    }
  }
  throw new Error("No free port for the Android emulator.");
}

export class Device {
  readonly pose: Pose;
  readonly session: string;
  private readonly directory: string;
  private readonly env: NodeJS.ProcessEnv;
  private id = "";
  private emulator: NodeChildProcess.ChildProcess | null = null;
  private closed = false;
  private runnerLogPath: string | undefined;

  private constructor(pose: Pose, root: string, directory: string) {
    this.pose = pose;
    this.session = `supaterm-e2e-${pose.id}`;
    this.directory = directory;
    this.env = {
      ...NodeProcess.env,
      AGENT_DEVICE_STATE_DIR: NodePath.join(root, "agent-device"),
      AGENT_DEVICE_IOS_RUNNER_DERIVED_PATH: NodePath.join(root, "ios-runner"),
      ANDROID_AVD_HOME: NodePath.join(root, "avds"),
    };
  }

  static async create(pose: Pose, root: string, directory: string) {
    const device = new Device(pose, root, directory);
    try {
      if (pose.platform === "ios") await device.bootIos(pose.iosDeviceType);
      else await device.bootAndroid(pose.androidProfile);
      return device;
    } catch (error) {
      try {
        await device.release();
      } catch (cleanupError) {
        throw new Error(
          `${error instanceof Error ? error.message : String(error)}; device cleanup failed: ${cleanupError instanceof Error ? cleanupError.message : String(cleanupError)}`,
          { cause: cleanupError },
        );
      }
      throw error;
    }
  }

  private async bootIos(deviceType: string) {
    if (NodeProcess.platform !== "darwin") throw new Error("iOS checks require a macOS runner.");
    const selected = NodeProcess.env.SUPATERM_E2E_IOS_RUNTIME;
    const created = await run("xcrun", [
      "simctl",
      "create",
      this.session,
      `com.apple.CoreSimulator.SimDeviceType.${deviceType}`,
      ...(selected ? [selected] : []),
    ]);
    this.id = created.stdout.trim();
    if (!/^[A-F0-9-]{36}$/i.test(this.id))
      throw new Error("simctl did not return a simulator UDID.");
    const { stdout } = await run("xcrun", ["simctl", "list", "devices", this.id, "--json"]);
    const { devices } = JSON.parse(stdout) as {
      devices: Record<string, Array<{ udid: string }>>;
    };
    const runtime = Object.entries(devices).find(([, entries]) =>
      entries.some((device) => device.udid === this.id),
    )?.[0];
    NodeProcess.stderr.write(`[mobile-e2e] ${this.pose.id}: runtime ${runtime ?? "unknown"}\n`);
    await suppressIosSystemFollowUps(this.id);
    NodeProcess.stderr.write(`[mobile-e2e] ${this.pose.id}: waiting for simulator startup\n`);
    await run("xcrun", ["simctl", "bootstatus", this.id, "-b"], {
      timeoutMs: 900_000,
      logPath: NodePath.join(this.directory, "simulator-boot.log"),
    });
    if (this.pose.form === "tablet") await ensureIosFullScreenAppsMode(this.id);
  }

  private async bootAndroid(profile: string) {
    await run(androidSdkTool("platform-tools/adb"), ["start-server"], { env: this.env });
    const image =
      NodeProcess.env.SUPATERM_E2E_ANDROID_IMAGE ??
      `system-images;android-36;google_apis;${NodeProcess.arch === "arm64" ? "arm64-v8a" : "x86_64"}`;
    const manager = NodePath.join(
      resolveAndroidSdkRoot(this.env),
      "cmdline-tools/latest/bin/avdmanager",
    );
    await NodeFSP.mkdir(this.env.ANDROID_AVD_HOME!, { recursive: true });
    await run(
      manager,
      ["create", "avd", "--force", "--name", this.session, "--package", image, "--device", profile],
      { env: this.env },
    );
    const port = await emulatorPort();
    this.id = `emulator-${port}`;
    const log = NodeFS.openSync(NodePath.join(this.directory, "emulator.log"), "w");
    try {
      this.emulator = NodeChildProcess.spawn(
        NodePath.join(resolveAndroidSdkRoot(this.env), "emulator/emulator"),
        [
          "-avd",
          this.session,
          "-port",
          String(port),
          "-no-window",
          "-no-audio",
          "-no-boot-anim",
          "-no-snapshot",
          "-cores",
          "2",
          "-gpu",
          "swiftshader",
          "-camera-back",
          "none",
          "-camera-front",
          "none",
        ],
        { env: this.env, stdio: ["ignore", log, log] },
      );
      this.emulator.on("error", () => undefined);
    } finally {
      NodeFS.closeSync(log);
    }
    await run(androidSdkTool("platform-tools/adb"), ["-s", this.id, "wait-for-device"], {
      timeoutMs: 240_000,
    });
    const deadline = Date.now() + 240_000;
    while (Date.now() < deadline) {
      if (this.emulator.exitCode !== null)
        throw new Error(`Android emulator exited: ${this.emulator.exitCode}; see emulator.log.`);
      const result = await run(
        androidSdkTool("platform-tools/adb"),
        ["-s", this.id, "shell", "getprop", "sys.boot_completed"],
        {
          allowFailure: true,
          timeoutMs: 10_000,
        },
      );
      if (result.stdout.trim() === "1") {
        await run(androidSdkTool("platform-tools/adb"), [
          "-s",
          this.id,
          "shell",
          "settings",
          "put",
          "secure",
          "show_ime_with_hard_keyboard",
          "1",
        ]);
        return;
      }
      await delay(1_000);
    }
    throw new Error("Android emulator did not finish booting; see emulator.log.");
  }

  async install(artifact: string) {
    if (this.pose.platform === "ios") await run("xcrun", ["simctl", "install", this.id, artifact]);
    else
      await run(androidSdkTool("platform-tools/adb"), [
        "-s",
        this.id,
        "install",
        "-r",
        "-d",
        artifact,
      ]);
  }

  async agent(
    args: ReadonlyArray<string>,
    options: { readonly timeoutMs?: number } = {},
  ): Promise<Record<string, unknown>> {
    const target = this.pose.platform === "ios" ? ["--udid", this.id] : ["--serial", this.id];
    const { code, stdout, stderr } = await run(
      NodeProcess.execPath,
      [
        AGENT_DEVICE_ENTRY,
        ...args,
        "--platform",
        this.pose.platform,
        ...target,
        "--session",
        this.session,
        "--json",
      ],
      {
        cwd: REPO_ROOT,
        env: this.env,
        allowFailure: true,
        ...(options.timeoutMs === undefined ? {} : { timeoutMs: options.timeoutMs }),
      },
    );
    let result: { success: boolean; data?: Record<string, unknown>; error?: { message?: string } };
    try {
      result = JSON.parse(stdout);
    } catch {
      throw new Error(
        `agent-device ${args[0]} exited ${code}: ${(stderr || stdout).slice(-2_000)}`,
      );
    }
    if (!result.success)
      throw new Error(`agent-device ${args[0]}: ${result.error?.message ?? "unknown error"}`);
    return result.data ?? {};
  }

  async prepare() {
    if (this.pose.platform === "ios") {
      await this.agent(["prepare", "ios-runner", "--timeout", "300000"], {
        timeoutMs: 360_000,
      });
      await normalizeIosSimulator(this.pose.appearance, this.id);
      if (this.pose.textSize)
        await run("xcrun", ["simctl", "ui", this.id, "content_size", "accessibility-large"]);
    } else {
      await run(androidSdkTool("platform-tools/adb"), [
        "-s",
        this.id,
        "shell",
        "cmd",
        "uimode",
        "night",
        this.pose.appearance === "dark" ? "yes" : "no",
      ]);
      if (this.pose.textSize)
        await run(androidSdkTool("platform-tools/adb"), [
          "-s",
          this.id,
          "shell",
          "settings",
          "put",
          "system",
          "font_scale",
          "1.5",
        ]);
    }
  }

  async launch(metroUrl: string) {
    const result = await this.agent(
      [
        "open",
        BUNDLE_ID,
        `supaterm-dev://expo-development-client/?url=${encodeURIComponent(metroUrl)}&disableOnboarding=1&disableFab=1&disableAutoLaunch=1`,
        ...(this.pose.platform === "android" ? ["--no-test-ime"] : []),
      ],
      { timeoutMs: 180_000 },
    );
    if (typeof result.runnerLogPath === "string") this.runnerLogPath = result.runnerLogPath;
    await this.acceptOpenPrompt();
    if (this.pose.fold) await this.agent(["fold", this.pose.fold]);
  }

  async openUrl(url: string) {
    await this.agent([
      "open",
      BUNDLE_ID,
      url,
      ...(this.pose.platform === "android" ? ["--no-test-ime"] : []),
    ]);
    await this.acceptOpenPrompt();
  }

  private async acceptOpenPrompt() {
    if (this.pose.platform !== "ios") return;
    await this.agent(["alert", "accept"]).catch(() => undefined);
  }

  async orient(shape: "landscape" | "portrait"): Promise<Snapshot> {
    let snapshot = await this.snapshot();
    for (const name of ["landscape-left", "portrait", "landscape-right"]) {
      if (snapshot.viewport.width > snapshot.viewport.height === (shape === "landscape"))
        return snapshot;
      await this.agent(["orientation", name]);
      await delay(1_000);
      snapshot = await this.snapshot();
    }
    if (snapshot.viewport.width > snapshot.viewport.height === (shape === "landscape"))
      return snapshot;
    throw new Error(`Device did not rotate to ${shape}.`);
  }

  async snapshot(timeoutMs?: number): Promise<Snapshot> {
    const value = await this.agent(["snapshot"], timeoutMs === undefined ? {} : { timeoutMs });
    const snapshot = value as unknown as Snapshot;
    if (
      !Array.isArray(snapshot.nodes) ||
      !snapshot.nodes.length ||
      !(snapshot.viewport?.width > 0) ||
      !(snapshot.viewport?.height > 0)
    ) {
      throw new Error("agent-device returned an empty or invalid accessibility snapshot.");
    }
    return snapshot;
  }

  async waitFor(predicate: (snapshot: Snapshot) => boolean, label: string, timeoutMs = 60_000) {
    const deadline = Date.now() + timeoutMs;
    let lastError = "";
    while (Date.now() < deadline) {
      try {
        const snapshot = await this.snapshot();
        if (predicate(snapshot)) return snapshot;
      } catch (error) {
        lastError = error instanceof Error ? error.message : String(error);
      }
      await delay(750);
    }
    throw new Error(`Timed out waiting for ${label}${lastError ? `: ${lastError}` : ""}`);
  }

  async screenshot(path: string) {
    await this.agent([
      "screenshot",
      path,
      ...(this.pose.platform === "ios" ? ["--pixel-density", "2"] : []),
    ]);
  }

  async saveDiagnostics() {
    if (this.emulator)
      await NodeFSP.writeFile(
        NodePath.join(this.directory, "emulator-status.json"),
        JSON.stringify(
          {
            exitCode: this.emulator.exitCode,
            signalCode: this.emulator.signalCode,
          },
          null,
          2,
        ),
      );
    if (this.pose.platform === "ios" && this.id) {
      const state = await run("xcrun", ["simctl", "list", "devices", this.id, "--json"], {
        allowFailure: true,
        timeoutMs: 15_000,
      }).catch(() => undefined);
      if (state)
        await NodeFSP.writeFile(
          NodePath.join(this.directory, "simulator-state.json"),
          state.stdout,
        );
    }
    if (this.runnerLogPath)
      await NodeFSP.copyFile(
        this.runnerLogPath,
        NodePath.join(this.directory, "device-runner.log"),
      ).catch(() => undefined);
    const snapshot = await this.snapshot(15_000).catch(() => undefined);
    if (snapshot)
      await NodeFSP.writeFile(
        NodePath.join(this.directory, "stopped.json"),
        JSON.stringify(snapshot, null, 2),
      );
  }

  async recorded(directory: string, name: string, action: () => Promise<unknown>) {
    const path = NodePath.join(directory, `${name}.mp4`);
    await this.agent(["record", "start", path, "--hide-touches"]);
    const stop = () => this.agent(["record", "stop"], { timeoutMs: 180_000 });
    try {
      await action();
      await delay(2_000);
    } catch (error) {
      await stop().catch(() => undefined);
      throw error;
    }
    await stop();
    return path;
  }

  async release() {
    if (this.closed) return;
    this.closed = true;
    if (!this.id) return;
    await this.agent(["close"], { timeoutMs: 15_000 }).catch(() => undefined);
    if (this.pose.platform === "ios") {
      await run("xcrun", ["simctl", "shutdown", this.id], { allowFailure: true });
      await run("xcrun", ["simctl", "delete", this.id]);
    } else if (this.emulator) {
      await run(androidSdkTool("platform-tools/adb"), ["-s", this.id, "emu", "kill"], {
        allowFailure: true,
        timeoutMs: 10_000,
      });
      await stopProcess(this.emulator);
      await run(
        NodePath.join(resolveAndroidSdkRoot(this.env), "cmdline-tools/latest/bin/avdmanager"),
        ["delete", "avd", "--name", this.session],
        { env: this.env },
      );
    }
  }
}
