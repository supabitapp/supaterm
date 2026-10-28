// @effect-diagnostics nodeBuiltinImport:off globalDate:off - Captures diagnostics on an owned CI simulator.
import * as NodeFSP from "node:fs/promises";
import * as NodeOS from "node:os";
import * as NodePath from "node:path";
import * as NodeProcess from "node:process";
import * as NodeTimersPromises from "node:timers/promises";

import { BUNDLE_ID } from "./build.ts";
import { run } from "./process.ts";

async function observe(
  command: string,
  args: ReadonlyArray<string>,
  options: { timeoutMs?: number; signal?: AbortSignal; logPath?: string } = {},
) {
  const started = Date.now();
  try {
    const result = await run(command, args, {
      allowFailure: true,
      timeoutMs: 10_000,
      ...options,
    });
    return {
      command,
      args,
      ...result,
      durationMs: Date.now() - started,
      ...(options.logPath ? { logPath: options.logPath, stdout: "" } : {}),
    };
  } catch (error) {
    return {
      command,
      args,
      code: -1,
      stdout: "",
      stderr: String(error),
      durationMs: Date.now() - started,
    };
  }
}

function processList(output: string) {
  return output.split("\n").flatMap((line) => {
    const match = /^\s*(\d+)\s+(\d+)\s+\S+\s+(\d+)\s+\S+\s+\S+\s+(.+)$/.exec(line);
    return match
      ? [
          {
            pid: Number(match[1]),
            parent: Number(match[2]),
            rss: Number(match[3]),
            command: match[4]!,
            line,
          },
        ]
      : [];
  });
}

async function bundlePaths(root: string, name: string) {
  try {
    const directories = await NodeFSP.readdir(root);
    const paths: string[] = [];
    for (const directory of directories) {
      const path = NodePath.join(root, directory, name);
      if (
        await NodeFSP.stat(path).then(
          () => true,
          () => false,
        )
      )
        paths.push(path);
    }
    return { paths };
  } catch (error) {
    return { paths: [], error: String(error) };
  }
}

export const installProbeEnabled = () =>
  NodeProcess.env.GITHUB_ACTIONS === "true" &&
  NodeProcess.env.SUPATERM_E2E_IOS_INSTALL_PROBE === "1";

export async function installIos(udid: string, artifact: string, directory: string) {
  const probe = installProbeEnabled();
  const install = (onSpawn?: (pid: number) => void) =>
    run("xcrun", ["simctl", "install", udid, artifact], {
      timeoutMs: probe ? 900_000 : 300_000,
      logPath: NodePath.join(directory, "simulator-install.log"),
      ...(onSpawn ? { onSpawn } : {}),
    });
  if (!probe) {
    await install();
    return;
  }

  const append = (name: string, value: unknown) =>
    NodeFSP.appendFile(NodePath.join(directory, name), `${JSON.stringify(value)}\n`).catch(
      () => undefined,
    );
  const entries = await NodeFSP.readdir(artifact, { recursive: true, withFileTypes: true }).catch(
    () => [],
  );
  const executable = await observe("/usr/libexec/PlistBuddy", [
    "-c",
    "Print CFBundleExecutable",
    NodePath.join(artifact, "Info.plist"),
  ]);
  const plugins = await NodeFSP.readdir(NodePath.join(artifact, "PlugIns")).catch(() => []);
  await append("install-facts.jsonl", {
    artifact,
    udid,
    image: NodeProcess.env.ImageOS,
    imageVersion: NodeProcess.env.ImageVersion,
    files: entries.filter((entry) => entry.isFile()).length,
    commands: await Promise.all([
      observe("du", ["-sk", artifact]),
      observe("file", [NodePath.join(artifact, executable.stdout.trim() || "Info.plist")]),
      observe("df", ["-h", artifact, NodeOS.homedir()]),
      observe("xcrun", ["xcodebuild", "-version"]),
      observe("xcrun", ["xcodebuild", "-checkFirstLaunchStatus"]),
      observe("/usr/libexec/PlistBuddy", [
        "-c",
        "Print CFBundleVersion",
        "/Library/Developer/PrivateFrameworks/CoreSimulator.framework/Resources/Info.plist",
      ]),
      observe("xcrun", ["simctl", "list", "runtimes", "--json"]),
      observe("xcrun", ["simctl", "list", "devices", udid, "--json"]),
      ...plugins.map((plugin) =>
        observe("du", ["-sk", NodePath.join(artifact, "PlugIns", plugin)]),
      ),
    ]),
  });

  const started = Date.now();
  const stop = new AbortController();
  const dataPath = NodePath.join(
    NodeOS.homedir(),
    "Library/Developer/CoreSimulator/Devices",
    udid,
    "data",
  );
  let installPid: number | undefined;
  let stackCapture: Promise<void> | undefined;
  let normalDeadlineObserved = false;
  let registeredAfterMs: number | undefined;
  let nextProgressAt = 0;
  const read = (command: string, args: ReadonlyArray<string>) =>
    observe(command, args, { signal: stop.signal });
  const monitor = (async () => {
    while (!stop.signal.aborted) {
      const observations = [
        await read("vm_stat", []),
        await read("sysctl", ["vm.loadavg", "vm.swapusage"]),
        await read("ps", ["-ww", "-Ao", "pid,ppid,state,rss,pcpu,etime,comm"]),
      ];
      if (stop.signal.aborted) break;
      const elapsedMs = Date.now() - started;
      const processes = processList(observations.at(-1)!.stdout);
      const largest = new Set(
        processes
          .toSorted((a, b) => b.rss - a.rss)
          .slice(0, 8)
          .map((entry) => entry.pid),
      );
      observations[observations.length - 1]!.stdout = processes
        .filter(
          (entry) =>
            /(?:installd|installcoordinationd|CoreSimulatorService|simctl|lsd|pkd|chronod|mds_stores|spindump|node)$/.test(
              entry.command,
            ) || largest.has(entry.pid),
        )
        .map((entry) => entry.line)
        .join("\n");
      if (elapsedMs >= nextProgressAt) {
        nextProgressAt = elapsedMs + 30_000;
        const files = await bundlePaths(
          NodePath.join(dataPath, "Containers/Bundle/Application"),
          NodePath.basename(artifact),
        );
        const staging = await read("du", ["-sk", NodePath.join(dataPath, "Library/Caches")]);
        const bundles = files.paths.length ? await read("du", ["-sk", ...files.paths]) : undefined;
        const appinfo = await read("xcrun", ["simctl", "appinfo", udid, BUNDLE_ID]);
        const registered =
          appinfo.code === 0 && appinfo.stdout.includes("CFBundleIdentifier")
            ? appinfo.stdout.includes(BUNDLE_ID)
            : null;
        if (registered) registeredAfterMs ??= Date.now() - started;
        await append("install-progress.jsonl", {
          time: new Date().toISOString(),
          elapsedMs: Date.now() - started,
          files,
          staging,
          bundles,
          registered,
          appinfo: {
            code: appinfo.code,
            stderr: appinfo.stderr,
            fields: appinfo.stdout
              .split("\n")
              .filter((line) =>
                /CFBundleIdentifier|CFBundleName|CFBundleExecutable|Path/.test(line),
              )
              .join("\n")
              .slice(0, 4_000),
          },
        });
      }
      if (elapsedMs >= 300_000 && !normalDeadlineObserved) {
        normalDeadlineObserved = true;
        await append("install-summary.jsonl", {
          event: "normal-deadline-observed",
          time: new Date().toISOString(),
          elapsedMs,
        });
      }
      await append("install-samples.jsonl", {
        time: new Date().toISOString(),
        elapsedMs,
        installPid,
        observations,
      });
      if (!stackCapture && installPid && elapsedMs >= 240_000 && !stop.signal.aborted) {
        const targets = processes.filter(
          (entry) =>
            (entry.pid === installPid &&
              entry.parent === NodeProcess.pid &&
              /\/(simctl|xcrun)$/.test(entry.command)) ||
            /\/(?:com\.apple\.CoreSimulator\.)?CoreSimulatorService$/.test(entry.command) ||
            (entry.command.includes("/RuntimeRoot/") &&
              /\/(installd|installcoordinationd|lsd|pkd)$/.test(entry.command)),
        );
        stackCapture = (async () => {
          const samples = await Promise.all(
            targets.map((entry) =>
              observe(
                "sample",
                [
                  String(entry.pid),
                  "5",
                  "-file",
                  NodePath.join(
                    directory,
                    `${NodePath.basename(entry.command)}-${entry.pid}.sample.txt`,
                  ),
                ],
                { timeoutMs: 60_000 },
              ),
            ),
          );
          await append("install-stacks.jsonl", { elapsedMs, targets, samples });
        })();
      }
      await NodeTimersPromises.setTimeout(10_000, undefined, { signal: stop.signal }).catch(
        () => undefined,
      );
    }
  })().catch((error: unknown) => append("install-samples.jsonl", { error: String(error) }));

  let failure: string | undefined;
  try {
    await install((pid) => {
      installPid = pid;
    });
  } catch (error) {
    failure = String(error);
    throw error;
  } finally {
    const elapsedMs = Date.now() - started;
    stop.abort();
    await monitor;
    await stackCapture;
    const registered = await observe("xcrun", ["simctl", "appinfo", udid, BUNDLE_ID]);
    await append("install-summary.jsonl", {
      elapsedMs,
      installPid,
      registeredAfterMs,
      failure,
      registeredAfterInstall:
        registered.code === 0 &&
        registered.stdout.includes("CFBundleIdentifier") &&
        registered.stdout.includes(BUNDLE_ID),
      registrationError: registered.stderr,
    });
    await append("install-system-log.jsonl", {
      result: await observe(
        "xcrun",
        [
          "simctl",
          "spawn",
          udid,
          "log",
          "show",
          "--last",
          "20m",
          "--style",
          "compact",
          "--predicate",
          'process IN {"installd", "installcoordinationd", "lsd", "pkd", "containermanagerd", "chronod", "SpringBoard"}',
        ],
        { timeoutMs: 90_000, logPath: NodePath.join(directory, "install-system.log") },
      ),
    });
    await append("install-system-log.jsonl", {
      host: await observe(
        "log",
        [
          "show",
          "--last",
          "20m",
          "--style",
          "compact",
          "--predicate",
          'process CONTAINS "CoreSimulator" OR subsystem BEGINSWITH "com.apple.CoreSimulator"',
        ],
        { timeoutMs: 90_000, logPath: NodePath.join(directory, "install-host.log") },
      ),
      serviceLog: await observe(
        "tail",
        [
          "-n",
          "2000",
          NodePath.join(NodeOS.homedir(), "Library/Logs/CoreSimulator/CoreSimulator.log"),
        ],
        { logPath: NodePath.join(directory, "coresimulator-service.log") },
      ),
      copy: await observe(
        "ditto",
        [
          NodePath.join(NodeOS.homedir(), "Library", "Logs", "CoreSimulator", udid),
          NodePath.join(directory, "coresimulator-logs"),
        ],
        { timeoutMs: 30_000 },
      ),
      finishedAt: new Date().toISOString(),
    });
  }
}
