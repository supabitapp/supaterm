// @effect-diagnostics nodeBuiltinImport:off globalConsole:off

import * as NodeFS from "node:fs";
import * as NodeOS from "node:os";
import * as NodePath from "node:path";
import * as NodeTimersPromises from "node:timers/promises";
import * as NodeUtil from "node:util";
import { _electron, type ElectronApplication } from "playwright-core";

const FIXTURE_DB = NodePath.join(import.meta.dirname, "fixtures/desktop-launch/statev2.sqlite");
const THREAD_TITLE = "Release launch check";
const THREAD_MESSAGE = "The release opens and shows this thread.";
const STEP_TIMEOUT_MS = 60_000;

const { values } = NodeUtil.parseArgs({
  options: {
    executable: { type: "string" },
    "artifacts-dir": { type: "string" },
  },
});
const executable = values.executable;
if (!executable)
  throw new Error("Usage: smoke-desktop-app.ts --executable <app> [--artifacts-dir <dir>]");
const artifactsDir = NodePath.resolve(values["artifacts-dir"] ?? "desktop-launch-check");

const home = NodeFS.mkdtempSync(NodePath.join(NodeOS.tmpdir(), "supaterm-desktop-launch-"));
const supatermHome = NodePath.join(home, "supaterm");
NodeFS.mkdirSync(NodePath.join(supatermHome, "userdata"), { recursive: true });
NodeFS.copyFileSync(FIXTURE_DB, NodePath.join(supatermHome, "userdata/statev2.sqlite"));

let step = "launching the app";
let app: ElectronApplication | undefined;
try {
  app = await _electron.launch({
    executablePath: executable,

    args: ["--no-sandbox"],

    env: {
      ...process.env,
      XDG_CONFIG_HOME: NodePath.join(home, ".config"),
      XDG_DATA_HOME: NodePath.join(home, ".local/share"),
      SUPATERM_HOME: supatermHome,
      SUPATERM_TELEMETRY_ENABLED: "false",
      SUPATERM_DISABLE_AUTO_UPDATE: "true",
    },
    timeout: STEP_TIMEOUT_MS,
  });

  step = "waiting for the first window";
  const page = await app.firstWindow({ timeout: STEP_TIMEOUT_MS });
  try {
    step = `finding "${THREAD_TITLE}" in the sidebar`;
    const thread = page.locator("li[data-thread-item]", { hasText: THREAD_TITLE });
    await thread.waitFor({ timeout: STEP_TIMEOUT_MS });
    step = "opening the thread";
    await thread.click();
    await page.getByText(THREAD_MESSAGE).waitFor({ timeout: STEP_TIMEOUT_MS });
  } catch (error) {
    NodeFS.mkdirSync(artifactsDir, { recursive: true });
    await page
      .screenshot({ path: NodePath.join(artifactsDir, "window.png"), timeout: 10_000 })
      .catch(() => {});
    throw error;
  }
  console.log("Desktop launch check passed: the app opened and showed the seeded thread.");
} catch (error) {
  console.error(`Desktop launch check failed while ${step}.`);
  NodeFS.mkdirSync(artifactsDir, { recursive: true });
  console.error(error instanceof Error ? error.message : error);
  const logs = NodePath.join(supatermHome, "userdata/logs");
  if (NodeFS.existsSync(logs)) {
    NodeFS.cpSync(logs, NodePath.join(artifactsDir, "logs"), { recursive: true });
    const serverLog = NodePath.join(logs, "server-child.log");
    if (NodeFS.existsSync(serverLog)) {
      console.error("\nLast backend output (server-child.log):");
      console.error(NodeFS.readFileSync(serverLog, "utf8").split("\n").slice(-20).join("\n"));
    }
  }
  process.exitCode = 1;
} finally {
  if (app) {
    const child = app.process();
    const closed = app.close().catch(() => {});
    await Promise.race([closed, NodeTimersPromises.setTimeout(10_000, undefined, { ref: false })]);
    child.kill("SIGKILL");
  }
  NodeFS.rmSync(home, { recursive: true, force: true, maxRetries: 5 });
}
