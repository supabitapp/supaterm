#!/usr/bin/env node
// @effect-diagnostics nodeBuiltinImport:off globalDate:off - This host-side CLI runs an isolated mobile test environment.
import * as NodeProcess from "node:process";
import * as NodeChildProcess from "node:child_process";
import * as NodeFSP from "node:fs/promises";
import * as NodeOS from "node:os";
import * as NodePath from "node:path";
import * as NodeUtil from "node:util";

import { BUILD_ENV, prepareClient } from "./mobile-e2e/build.ts";
import { Device, stopDeviceDaemon } from "./mobile-e2e/device.ts";
import { runJourney, type StepResult } from "./mobile-e2e/journey.ts";
import { POSES, type Pose } from "./mobile-e2e/poses.ts";
import { MOBILE_ROOT, REPO_ROOT } from "./mobile-e2e/process.ts";
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

const log = (message: string) => NodeProcess.stderr.write(`[mobile-e2e] ${message}\n`);

async function runPose(
  pose: Pose,
  root: string,
  output: string,
  metroPort: number,
  pair: (host: string) => Promise<string>,
  client: (deviceId: string, logPath: string) => Promise<string>,
): Promise<PoseResult> {
  const directory = NodePath.join(output, pose.id);
  await NodeFSP.mkdir(directory, { recursive: true });
  const steps: StepResult[] = [];
  let device: Device | undefined;
  let result: PoseResult = { pose, steps };
  try {
    log(`${pose.id}: booting ${pose.device}`);
    device = await Device.create(pose, root, directory);
    log(`${pose.id}: preparing native client`);
    await device.install(
      await client(device.deviceId, NodePath.join(directory, "native-build.log")),
    );
    await device.prepare();
    const host = pose.platform === "ios" ? "127.0.0.1" : "10.0.2.2";
    await device.launch(`http://${host}:${metroPort}`);
    await runJourney(device, directory, () => pair(host), steps);
  } catch (error) {
    const stopped = NodePath.join(directory, "stopped.png");
    const screenshot = await device?.screenshot(stopped).then(
      () => stopped,
      () => undefined,
    );
    result = {
      pose,
      steps,
      error: error instanceof Error ? error.message : String(error),
      ...(screenshot ? { stopped: screenshot } : {}),
    };
  } finally {
    try {
      await device?.release();
    } catch (error) {
      result = appendError(
        result,
        `Device cleanup failed: ${error instanceof Error ? error.message : String(error)}`,
      );
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
  let preparedClient: Promise<string> | undefined;
  const client = (deviceId: string, logPath: string) =>
    (preparedClient ??= prepareClient(platform, deviceId, logPath));
  try {
    const [environment] = await startShowcaseEnvironments(
      root,
      (server) => servers.push(server),
      SHOWCASE_ENVIRONMENTS.slice(0, 1),
    );
    if (!environment) throw new Error("The fixture environment did not start.");
    const metroPort = await reserveAvailablePort();
    metro = NodeChildProcess.spawn(
      "vp",
      [
        "exec",
        "expo",
        "start",
        "--dev-client",
        "--scheme",
        "supaterm-dev",
        "--port",
        String(metroPort),
      ],
      {
        cwd: MOBILE_ROOT,
        env: BUILD_ENV,
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
      const result = await runPose(pose, root, output, metroPort, pair, client);
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
    }
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    log(message);
    for (const pose of poses)
      if (!results.some((result) => result.pose.id === pose.id))
        results.push({ pose, steps: [], error: message });
  } finally {
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
    await NodeFSP.writeFile(
      NodePath.join(output, "index.html"),
      renderReport(results, output, errors),
    );
    await NodeFSP.writeFile(
      NodePath.join(output, "report.json"),
      JSON.stringify({ poses: results, errors }, null, 2),
    );
  }
  const failed = results.filter(poseFailed).length;
  NodeProcess.stdout.write(
    `${JSON.stringify({ report: NodePath.join(output, "index.html"), poses: results.length, failed, errors: errors.length })}\n`,
  );
  process.exitCode = failed || errors.length ? 1 : 0;
}

if (import.meta.main) await main();
