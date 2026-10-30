// @effect-diagnostics nodeBuiltinImport:off - the worktree case lays out real directories.
import * as NodeFS from "node:fs";
import * as NodeOS from "node:os";
import * as NodePath from "node:path";

import * as NodeServices from "@effect/platform-node/NodeServices";
import { assert, it } from "@effect/vitest";
import { RunId, ThreadId } from "@supaterm/contracts";
import * as HostProcess from "@supaterm/shared/HostProcess";
import * as NetService from "@supaterm/shared/Net";
import * as ConfigProvider from "effect/ConfigProvider";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";
import { Command } from "effect/cli";
import * as TestConsole from "effect/testing/TestConsole";

import { cli } from "../binCli.ts";
import {
  makePersistedServerRuntimeState,
  persistServerRuntimeState,
} from "../serverRuntimeState.ts";
import { CliServerVersionMismatchError } from "./config.ts";
import { CliServerNotRunningError, type ServerTools } from "./serverTools.ts";
import { readLatestMessages, waitForRun } from "./thread.ts";

const threadId = ThreadId.make("thread-1");
const runId = RunId.make("run-1");

/** Answers each tool call with the next scripted response for that tool. */
const scriptedTools = (script: Record<string, Array<unknown>>) => {
  const calls: Array<{ readonly tool: string; readonly args: unknown }> = [];
  const call = ((tool: string, args: unknown) => {
    calls.push({ tool, args });
    const next = script[tool]?.shift();
    return next === undefined ? Effect.die(`unscripted ${tool} call`) : Effect.succeed(next);
  }) as ServerTools["call"];
  return { tools: { origin: "http://127.0.0.1:1", call } satisfies ServerTools, calls };
};

it.effect("--wait follows the sent run to its continuation's terminal status", () =>
  Effect.gen(function* () {
    const continuation = RunId.make("run-2");
    const { tools, calls } = scriptedTools({
      supaterm_thread_wait: [
        { threadId, runId, status: "running", timedOut: true },
        { threadId, runId: continuation, status: "failed", timedOut: false },
      ],
      supaterm_thread_read: [{ thread: { pendingRequestCount: 0 } }],
    });

    const outcome = yield* waitForRun(tools, threadId, runId);

    assert.deepStrictEqual(outcome, { type: "ended", runId: continuation, status: "failed" });
    assert.deepStrictEqual(
      calls.filter((entry) => entry.tool === "supaterm_thread_wait").map((entry) => entry.args),
      [
        { threadId, runId, timeoutMs: 15_000 },
        { threadId, runId, timeoutMs: 15_000 },
      ],
    );
  }),
);

it.effect("--wait stops when the thread waits for an answer instead of polling forever", () =>
  Effect.gen(function* () {
    const { tools } = scriptedTools({
      supaterm_thread_wait: [
        { threadId, runId, status: "queued", timedOut: true },
        { threadId, runId, status: "queued", timedOut: true },
      ],
      supaterm_thread_read: [{ thread: { pendingRequestCount: 1 } }],
    });

    assert.deepStrictEqual(yield* waitForRun(tools, threadId, runId), { type: "needs_input" });
  }),
);

it.effect("--wait reports its run's result when a later run is the one waiting", () =>
  Effect.gen(function* () {
    const { tools } = scriptedTools({
      supaterm_thread_wait: [
        { threadId, runId, status: "running", timedOut: true },
        { threadId, runId, status: "completed", timedOut: false },
      ],
      supaterm_thread_read: [{ thread: { pendingRequestCount: 1 } }],
    });

    assert.deepStrictEqual(yield* waitForRun(tools, threadId, runId), {
      type: "ended",
      runId,
      status: "completed",
    });
  }),
);

// Minting a session opens the target database with this checkout's migrations,
// so a worktree must never reach the live install through the shared home.
it.effect("a linked worktree only looks for a server in its own home", () =>
  Effect.gen(function* () {
    const root = NodeFS.mkdtempSync(NodePath.join(NodeOS.tmpdir(), "supaterm-thread-worktree-"));
    const worktree = NodePath.join(root, "worktree");
    NodeFS.mkdirSync(worktree);
    NodeFS.writeFileSync(
      NodePath.join(worktree, ".git"),
      `gitdir: ${NodePath.join(root, "repo", ".git", "worktrees", "worktree")}\n`,
    );
    const sharedHome = NodePath.join(root, "shared");
    yield* persistServerRuntimeState({
      path: NodePath.join(sharedHome, "userdata", "server-runtime.json"),
      state: yield* makePersistedServerRuntimeState({
        config: { host: "127.0.0.1", devUrl: undefined },
        port: 1,
      }),
    });

    const entry = NodePath.join(worktree, "apps", "server", "src", "bin.ts");
    NodeFS.mkdirSync(NodePath.dirname(entry), { recursive: true });
    NodeFS.writeFileSync(entry, "");
    const launcher = NodePath.join(root, "bin", "supaterm.ts");
    NodeFS.mkdirSync(NodePath.dirname(launcher));
    NodeFS.symlinkSync(entry, launcher);

    const error = yield* Command.runWith(cli, { version: "0.0.0" })(["thread", "list"]).pipe(
      Effect.provideService(HostProcess.WorkingDirectory, worktree),
      Effect.provideService(HostProcess.Arguments, [process.execPath, launcher]),
      Effect.provide(
        ConfigProvider.layer(ConfigProvider.fromEnv({ env: { SUPATERM_HOME: sharedHome } })),
      ),
      Effect.flip,
    );

    assert.instanceOf(error, CliServerNotRunningError);
    assert.deepEqual(
      { baseDir: error.baseDir, inLinkedWorktree: error.inLinkedWorktree },
      { baseDir: NodePath.join(worktree, ".supaterm"), inLinkedWorktree: true },
    );
    assert.deepEqual(NodeFS.readdirSync(NodePath.join(sharedHome, "userdata")), [
      "server-runtime.json",
    ]);
    assert.isFalse(
      NodeFS.existsSync(NodePath.join(worktree, ".supaterm", "userdata", "statev2.sqlite")),
    );
  }).pipe(Effect.provide(Layer.mergeAll(NodeServices.layer, NetService.layer, TestConsole.layer))),
);

it.effect("an installed CLI in a project's linked worktree uses the normal home", () =>
  Effect.gen(function* () {
    const root = NodeFS.mkdtempSync(NodePath.join(NodeOS.tmpdir(), "supaterm-thread-installed-"));
    const worktree = NodePath.join(root, "worktree");
    NodeFS.mkdirSync(worktree);
    NodeFS.writeFileSync(
      NodePath.join(worktree, ".git"),
      `gitdir: ${NodePath.join(root, "repo", ".git", "worktrees", "worktree")}\n`,
    );
    const sharedHome = NodePath.join(root, "shared");

    const error = yield* Command.runWith(cli, { version: "0.0.0" })(["thread", "list"]).pipe(
      Effect.provideService(HostProcess.WorkingDirectory, worktree),
      Effect.provideService(HostProcess.Arguments, [
        process.execPath,
        NodePath.join(root, "install", "server", "bin.mjs"),
      ]),
      Effect.provide(
        ConfigProvider.layer(ConfigProvider.fromEnv({ env: { SUPATERM_HOME: sharedHome } })),
      ),
      Effect.flip,
    );

    assert.instanceOf(error, CliServerNotRunningError);
    assert.deepEqual(
      { baseDir: error.baseDir, inLinkedWorktree: error.inLinkedWorktree },
      { baseDir: sharedHome, inLinkedWorktree: false },
    );
  }).pipe(Effect.provide(Layer.mergeAll(NodeServices.layer, NetService.layer, TestConsole.layer))),
);

// A CLI from another build would open the server's database with its own
// migrations, and an older server does not apply the project's default mode.
it.effect("refuses a server from another build before opening its database", () =>
  Effect.gen(function* () {
    const home = NodeFS.mkdtempSync(NodePath.join(NodeOS.tmpdir(), "supaterm-thread-version-"));
    const state = yield* makePersistedServerRuntimeState({
      config: { host: "127.0.0.1", devUrl: undefined },
      port: 1,
    });
    yield* persistServerRuntimeState({
      path: NodePath.join(home, "userdata", "server-runtime.json"),
      state: { ...state, serverVersion: "0.0.1-older" },
    });

    const error = yield* Command.runWith(cli, { version: "0.0.0" })([
      "thread",
      "list",
      "--base-dir",
      home,
    ]).pipe(Effect.flip);

    assert.instanceOf(error, CliServerVersionMismatchError);
    assert.strictEqual(error.serverVersion, "0.0.1-older");
    assert.isFalse(NodeFS.existsSync(NodePath.join(home, "userdata", "statev2.sqlite")));
  }).pipe(Effect.provide(Layer.mergeAll(NodeServices.layer, NetService.layer, TestConsole.layer))),
);

/** Serves supaterm_thread_read pages the way the server does: positions count every item. */
const timelineTools = (types: ReadonlyArray<string>) => {
  const items = types.map((type, position) => ({ position, itemId: `item-${position}`, type }));
  const served: Array<number> = [];
  const call = ((_tool: string, input: unknown) => {
    const args = input as { readonly afterPosition?: number; readonly limit: number };
    // Scanning one match past the page keeps reads of huge fixtures linear.
    const matching: typeof items = [];
    for (let position = (args.afterPosition ?? -1) + 1; position < items.length; position++) {
      const item = items[position]!;
      if (["user_message", "assistant_message", "proposed_plan"].includes(item.type)) {
        matching.push(item);
        if (matching.length > args.limit) break;
      }
    }
    const page = matching.slice(0, args.limit);
    served.push(page.length);
    return Effect.succeed({
      thread: { itemCount: items.length },
      items: page,
      nextPosition: page.at(-1)?.position ?? null,
      hasMore: matching.length > page.length,
    });
  }) as ServerTools["call"];
  const latest = (count: number) =>
    items
      .filter((item) => item.type === "user_message" || item.type === "assistant_message")
      .slice(-count)
      .map((item) => item.itemId);
  return { tools: { origin: "http://127.0.0.1:1", call } satisfies ServerTools, served, latest };
};

const tail = (tools: number) => [...Array<string>(tools).fill("tool_call"), "assistant_message"];

it.effect("show reads the end of a long thread, not its whole history", () =>
  Effect.gen(function* () {
    const { tools, served, latest } = timelineTools([
      ...Array.from({ length: 1000 }, (_, index) =>
        index % 2 === 0 ? "user_message" : "assistant_message",
      ),
      ...Array.from({ length: 10 }, () => tail(30)).flat(),
      "proposed_plan",
    ]);

    const { messages } = yield* readLatestMessages(tools, threadId, 10);

    assert.deepStrictEqual(
      messages.map((item) => item.itemId),
      latest(10),
    );
    assert.isBelow(
      served.reduce((sum, count) => sum + count, 0),
      100,
    );
  }),
);

it.effect("show widens back to the first item when the thread has fewer messages", () =>
  Effect.gen(function* () {
    const { tools, latest } = timelineTools([
      "user_message",
      ...Array.from({ length: 4 }, () => tail(150)).flat(),
    ]);

    const { messages } = yield* readLatestMessages(tools, threadId, 10);

    assert.deepStrictEqual(
      messages.map((item) => item.itemId),
      latest(10),
    );
    assert.lengthOf(messages, 5);
  }),
);

it.effect("show returns a --messages count larger than one call can spread", () =>
  Effect.gen(function* () {
    const { tools, latest } = timelineTools(Array<string>(200_000).fill("assistant_message"));

    const { messages } = yield* readLatestMessages(tools, threadId, 200_000);

    assert.deepStrictEqual(
      messages.map((item) => item.itemId),
      latest(200_000),
    );
  }),
);
