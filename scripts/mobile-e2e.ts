#!/usr/bin/env node
// @effect-diagnostics nodeBuiltinImport:off globalDate:off - This host-side CLI runs an isolated mobile test environment.
import * as NodeProcess from "node:process";
import * as NodeChildProcess from "node:child_process";
import * as NodeFSP from "node:fs/promises";
import * as NodeOS from "node:os";
import * as NodePath from "node:path";
import * as NodeUtil from "node:util";

import { BUILD_ENV, prepareClient } from "./mobile-e2e/build.ts";
import { Device, DeviceCleanupError, stopDeviceDaemon } from "./mobile-e2e/device.ts";
import { captureHostResources } from "./mobile-e2e/diagnostics.ts";
import { runJourney, type StepResult } from "./mobile-e2e/journey.ts";
import { POSES, type Pose } from "./mobile-e2e/poses.ts";
import { MOBILE_ROOT, REPO_ROOT, setRunSignal } from "./mobile-e2e/process.ts";
import {
  appendError,
  failedChecks,
  poseFailed,
  type PoseResult,
  renderReport,
} from "./mobile-e2e/report.ts";
import { reviewPose } from "./mobile-e2e/review.ts";
import { SHOWCASE_ENVIRONMENTS } from "./mobile-showcase-environment.ts";
import {
  buildShowcasePairingUrl,
  issuePairingCredential,
  reserveAvailablePort,
  startShowcaseEnvironments,
  stopProcess,
  waitForPort,
  warmMetroBundle,
} from "./mobile-showcase.ts";

const log = (message: string) =>
  NodeProcess.stderr.write(`[mobile-e2e] ${new Date().toISOString()} ${message}\n`);

async function runPose(
  pose: Pose,
  root: string,
  output: string,
  metroPort: number,
  pair: (host: string) => Promise<string>,
  client: string,
  saveReport: (result: PoseResult) => Promise<void>,
): Promise<PoseResult> {
  const directory = NodePath.join(output, pose.id);
  await NodeFSP.mkdir(directory, { recursive: true });
  const steps: StepResult[] = [];
  let device: Device | undefined;
  let result: PoseResult = { pose, steps };
  try {
    await captureHostResources(directory, "Before device startup");
    log(`${pose.id}: booting ${pose.device}`);
    device = await Device.create(pose, root, directory);
    log(`${pose.id}: installing native client`);
    await device.install(client);
    log(`${pose.id}: preparing device automation`);
    await device.prepare();
    log(`${pose.id}: warming Metro before launch`);
    await warmMetroBundle(pose.platform, "127.0.0.1", metroPort);
    const host = pose.platform === "ios" ? "127.0.0.1" : "10.0.2.2";
    log(`${pose.id}: launching app`);
    await device.launch(metroPort);
    await runJourney(device, directory, () => pair(host), steps);
  } catch (error) {
    await captureHostResources(directory, "Device failure");
    await device?.saveDiagnostics().catch(() => undefined);
    const stopped = NodePath.join(directory, "stopped.png");
    const screenshot = await device?.screenshot(stopped).then(
      () => stopped,
      () => undefined,
    );
    result = {
      pose,
      steps,
      error: error instanceof Error ? error.message : String(error),
      ...(error instanceof DeviceCleanupError ? { cleanupFailed: true } : {}),
      ...(screenshot ? { stopped: screenshot } : {}),
    };
  } finally {
    await saveReport(result).catch((error: unknown) => {
      result = appendError(result, `Report update failed: ${String(error)}`);
    });
    try {
      await device?.release();
    } catch (error) {
      result = {
        ...appendError(
          result,
          `Device cleanup failed: ${error instanceof Error ? error.message : String(error)}`,
        ),
        cleanupFailed: true,
      };
    }
    try {
      await stopDeviceDaemon(root);
    } catch (error) {
      result = {
        ...appendError(
          result,
          `Device daemon cleanup failed: ${error instanceof Error ? error.message : String(error)}`,
        ),
        cleanupFailed: true,
      };
    }
  }
  return result;
}

async function main() {
  const { values } = NodeUtil.parseArgs({
    options: {
      platform: { type: "string" },
      pose: { type: "string", multiple: true },
      list: { type: "boolean" },
      review: { type: "boolean", default: false },
      output: { type: "string" },
      help: { type: "boolean" },
    },
  });
  if (values.help) {
    NodeProcess.stdout.write(
      "Usage: vp run mobile:e2e [--platform ios|android] [--pose <id>] [--review] [--output <directory>] [--list]\n",
    );
    return;
  }
  if (values.list) {
    for (const pose of POSES)
      NodeProcess.stdout.write(
        `${pose.id}\t${pose.platform}\t${pose.device}${pose.pending ? `\tpending: ${pose.pending}` : ""}\n`,
      );
    return;
  }
  const platform = values.platform ?? (NodeProcess.platform === "darwin" ? "ios" : "android");
  if (platform !== "ios" && platform !== "android")
    throw new Error("--platform must be ios or android.");
  const selected = values.pose ?? [];
  const unknown = selected.filter((id) => !POSES.some((pose) => pose.id === id));
  if (unknown.length) throw new Error(`Unknown pose: ${unknown.join(", ")}. Use --list.`);
  const poses = POSES.filter(
    (pose) =>
      pose.platform === platform && (selected.length ? selected.includes(pose.id) : !pose.pending),
  );
  if (!poses.length) {
    log(`No ${platform} poses selected; skipping this platform.`);
    return;
  }

  const stamp = new Date().toISOString().replaceAll(/[:.]/g, "-");
  const output = NodePath.resolve(
    values.output ?? NodePath.join(REPO_ROOT, "artifacts/mobile-e2e", stamp),
  );
  await NodeFSP.mkdir(output, { recursive: true });
  const root = await NodeFSP.mkdtemp(NodePath.join(NodeOS.tmpdir(), "supaterm-mobile-e2e-"));
  const servers: NodeChildProcess.ChildProcess[] = [];
  let metro: NodeChildProcess.ChildProcess | undefined;
  const results: PoseResult[] = [];
  const errors: string[] = [];
  const saveReport = async (active?: PoseResult, complete = false) => {
    const poses = active ? [...results, active] : results;
    await Promise.all([
      NodeFSP.writeFile(
        NodePath.join(output, "index.html"),
        renderReport(poses, output, errors, !complete),
      ),
      NodeFSP.writeFile(
        NodePath.join(output, "report.json"),
        JSON.stringify({ poses, errors, complete }, null, 2),
      ),
    ]);
  };
  const interruption = new AbortController();
  const interrupt = (signal: "SIGINT" | "SIGTERM") => {
    interruption.abort(new Error(`Interrupted by ${signal}`));
    if (metro?.pid) {
      try {
        NodeProcess.kill(-metro.pid, signal);
      } catch {}
    }
    for (const server of servers) void stopProcess(server).catch(() => undefined);
  };
  const onSigint = () => interrupt("SIGINT");
  const onSigterm = () => interrupt("SIGTERM");
  NodeProcess.once("SIGINT", onSigint);
  NodeProcess.once("SIGTERM", onSigterm);
  setRunSignal(interruption.signal);
  try {
    await saveReport();
    await captureHostResources(output, "Before native build");
    log(`Preparing the ${platform} native client before starting devices.`);
    const client = await prepareClient(platform, output);
    interruption.signal.throwIfAborted();
    await NodeFSP.writeFile(NodePath.join(output, "native-client.txt"), `${client}\n`);
    await captureHostResources(output, "After native build");
    const [environment] = await startShowcaseEnvironments(
      root,
      (server) => servers.push(server),
      SHOWCASE_ENVIRONMENTS.slice(0, 1),
    );
    if (!environment) throw new Error("The fixture environment did not start.");
    interruption.signal.throwIfAborted();
    const metroPort = await reserveAvailablePort();
    metro = NodeChildProcess.spawn(
      "vp",
      [
        "exec",
        "expo",
        "start",
        "--dev-client",
        "--max-workers",
        "2",
        "--scheme",
        "supaterm-dev",
        "--port",
        String(metroPort),
      ],
      {
        cwd: MOBILE_ROOT,
        env: { ...BUILD_ENV, NODE_OPTIONS: "--max-old-space-size=3072" },
        stdio: "inherit",
        detached: true,
      },
    );
    await waitForPort(metroPort, "Metro", 120_000);
    await warmMetroBundle(platform, "127.0.0.1", metroPort);
    const pair = async (host: string) =>
      buildShowcasePairingUrl(
        host,
        environment.port,
        await issuePairingCredential(environment.baseDir),
      );
    for (const pose of poses) {
      interruption.signal.throwIfAborted();
      const result = await runPose(pose, root, output, metroPort, pair, client, saveReport);
      if (values.review) {
        try {
          const findings = await reviewPose(result, output);
          results.push({ ...result, findings });
        } catch (error) {
          results.push(
            appendError(
              result,
              `Screenshot review failed: ${error instanceof Error ? error.message : String(error)}`,
            ),
          );
        }
      } else results.push(result);
      log(
        `${pose.id}: ${result.error ?? (failedChecks(result).length ? "checks failed" : "passed")}`,
      );
      await saveReport();
      interruption.signal.throwIfAborted();
      if (result.cleanupFailed) {
        const message = `Stopping after ${pose.id}: device cleanup failed`;
        errors.push(message);
        throw new Error(message);
      }
    }
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    log(message);
    for (const pose of poses)
      if (!results.some((result) => result.pose.id === pose.id))
        results.push({ pose, steps: [], error: message });
  } finally {
    setRunSignal(undefined);
    await saveReport().catch((error: unknown) => {
      errors.push(`Report update failed: ${String(error)}`);
    });
    try {
      await stopDeviceDaemon(root);
    } catch (error) {
      errors.push(
        `Device daemon cleanup failed: ${error instanceof Error ? error.message : String(error)}`,
      );
    }
    if (metro?.pid) {
      try {
        NodeProcess.kill(-metro.pid, "SIGTERM");
      } catch {}
      await stopProcess(metro);
    }
    await Promise.all(servers.map((server) => stopProcess(server)));
    await NodeFSP.rm(root, { recursive: true, force: true }).catch((error: unknown) => {
      errors.push(
        `Temporary state cleanup failed: ${error instanceof Error ? error.message : String(error)}`,
      );
    });
    await saveReport(undefined, true);
    NodeProcess.removeListener("SIGINT", onSigint);
    NodeProcess.removeListener("SIGTERM", onSigterm);
  }
  const failed = results.filter(poseFailed).length;
  NodeProcess.stdout.write(
    `${JSON.stringify({ report: NodePath.join(output, "index.html"), poses: results.length, failed, errors: errors.length })}\n`,
  );
  process.exitCode = failed || errors.length ? 1 : 0;
}

if (import.meta.main) await main();
