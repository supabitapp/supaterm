// @effect-diagnostics nodeBuiltinImport:off
import * as NodeChildProcess from "node:child_process";
import * as NodeFS from "node:fs";
import * as NodeOS from "node:os";
import * as NodePath from "node:path";
import * as NodeURL from "node:url";

import { assert, it } from "@effect/vitest";

const scriptPath = NodeURL.fileURLToPath(new URL("./acp-replay-agent.ts", import.meta.url));

const killOnFirstWrite = `process.stdout.write = () => process.kill(process.pid, "SIGKILL");`;

const scenario = "status-before-answer";

const setModeParams = { sessionId: "session-1", modeId: "plan" };

const setModeExchange = [
  {
    type: "expect_outbound",
    frame: { kind: "request", method: "session/set_mode", params: setModeParams },
  },
  {
    type: "emit_inbound",
    frame: { kind: "response", method: "session/set_mode", result: {} },
  },
];

async function replayUntilFirstWrite(
  entries: ReadonlyArray<unknown>,
  request: { readonly method: string; readonly params: unknown },
): Promise<{ readonly signal: NodeJS.Signals | null; readonly status: unknown }> {
  const directory = NodeFS.mkdtempSync(NodePath.join(NodeOS.tmpdir(), "acp-replay-status-"));
  const statusPath = NodePath.join(directory, "status.json");
  try {
    const agent = NodeChildProcess.spawn(
      process.execPath,
      [
        "--experimental-strip-types",
        "--import",
        `data:text/javascript,${encodeURIComponent(killOnFirstWrite)}`,
        scriptPath,
      ],
      {
        env: {
          ...process.env,
          SUPATERM_ACP_REPLAY_TRANSCRIPT: Buffer.from(
            JSON.stringify({ scenario, entries }),
          ).toString("base64"),
          SUPATERM_ACP_REPLAY_STATUS_PATH: statusPath,
        },
        stdio: ["pipe", "ignore", "ignore"],
      },
    );
    const exitSignal = new Promise<NodeJS.Signals | null>((resolve) =>
      agent.once("exit", (_code, signal) => resolve(signal)),
    );
    agent.stdin.end(`${JSON.stringify({ jsonrpc: "2.0", id: 1, ...request })}\n`);
    const signal = await exitSignal;
    return { signal, status: JSON.parse(NodeFS.readFileSync(statusPath, "utf8")) };
  } finally {
    NodeFS.rmSync(directory, { recursive: true, force: true });
  }
}

it.each([
  { name: "a final answer", entries: setModeExchange },
  {
    name: "a final answer followed by a clean runtime exit",
    entries: [...setModeExchange, { type: "runtime_exit", status: "success" }],
  },
])("records the replay status before $name leaves the agent", async ({ entries }) => {
  assert.deepStrictEqual(
    await replayUntilFirstWrite(entries, { method: "session/set_mode", params: setModeParams }),
    {
      signal: "SIGKILL",
      status: { scenario, cursor: entries.length, total: entries.length },
    },
  );
});

it("records a mismatch before answering the unexpected frame", async () => {
  const { signal, status } = await replayUntilFirstWrite(setModeExchange, {
    method: "session/close",
    params: { sessionId: "session-1" },
  });

  assert.strictEqual(signal, "SIGKILL");
  assert.nestedPropertyVal(status, "failure.detail", "Unexpected outbound ACP frame");
});
