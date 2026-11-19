import type { ListRunsOptions } from "@cursor/sdk";
import * as NodeServices from "@effect/platform-node/NodeServices";
import { assert, describe, it } from "@effect/vitest";
import { ProviderSessionId, ThreadId } from "@supaterm/contracts";
import * as Effect from "effect/Effect";
import * as Fiber from "effect/Fiber";
import * as FileSystem from "effect/FileSystem";
import * as Layer from "effect/Layer";
import * as Exit from "effect/Exit";
import * as Cause from "effect/Cause";
import { vi } from "vite-plus/test";

import * as ProviderEventLoggers from "@supaterm/provider-core/server/ProviderEventLoggers";
import * as CursorAgentSdk from "./CursorAgentSdk.ts";
import * as CursorSdk from "./CursorSdk.ts";
import { loadCursorSdk, loadCursorSqlite } from "./sdk.ts";

type CursorSdkModule = ReturnType<CursorSdk.CursorSdk["Service"]["load"]>;
type CreateAgentPlatform = CursorSdkModule["createAgentPlatform"];

const finishedRun = {
  id: "run-cursor-agent-sdk-test",
  requestId: "request-cursor-agent-sdk-test",
  status: "finished",
  result: "ok",
  model: { id: "default" },
  durationMs: 1,
};

const cursorSdkFake = (() => {
  const closeExecutionOrder: Array<string> = [];
  const runOperations: Array<string> = [];
  const platforms: Array<() => Promise<Awaited<ReturnType<CreateAgentPlatform>>>> = [];
  const agentCreations: Array<() => Promise<unknown>> = [];
  const waits: Array<() => Promise<typeof finishedRun>> = [];
  const steerFailures: Array<Error> = [];
  const sends: Array<() => Promise<unknown>> = [];
  const steers: Array<Array<string>> = [];
  const listRunsCalls: Array<[string, ListRunsOptions | undefined]> = [];
  const cancelRunCalls: Array<[string, unknown]> = [];
  let storedRuns: Array<{ readonly id: string; readonly status: string }> = [];
  const runWait = () => waits.shift()?.() ?? Promise.resolve(finishedRun);
  const runCancel = async () => {};
  const runSteer = async (message: string) => {
    steers.push([message]);
    const failure = steerFailures.shift();
    if (failure) throw failure;
    return "complete_delivered" as const;
  };
  const agentClose = () => {
    closeExecutionOrder.push("sdk:agent.close");
  };
  const send = async (
    _message: unknown,
    options: { readonly onDelta?: (input: { readonly update: unknown }) => Promise<void> },
  ) => {
    const queued = sends.shift();
    if (queued) return queued();
    runOperations.push("run.start");
    if (storedRuns.some((run) => run.status === "running")) {
      throw new Error("Agent agent-cursor-agent-sdk-test already has active run");
    }
    await options.onDelta?.({
      update: {
        type: "assistant-message-chunk",
        text: "hello",
      },
    });
    return {
      id: "run-cursor-agent-sdk-test",
      agentId: "agent-cursor-agent-sdk-test",
      wait: runWait,
      cancel: runCancel,
      steer: runSteer,
    };
  };
  const agent = () => ({
    agentId: "agent-cursor-agent-sdk-test",
    send,
    close: agentClose,
  });
  const sdk = {
    Agent: {
      create: async () => agentCreations.shift()?.() ?? agent(),
      resume: async () => agent(),
      listRuns: async (agentId: string, options?: ListRunsOptions) => {
        listRunsCalls.push([agentId, options]);
        runOperations.push("agent.listRuns");
        const offset = options?.cursor === undefined ? 0 : Number(options.cursor);
        const end = offset + (options?.limit ?? 50);
        return {
          items: storedRuns.slice(offset, end),
          ...(end < storedRuns.length ? { nextCursor: String(end) } : {}),
        };
      },
      cancelRun: async (runId: string, options: unknown) => {
        cancelRunCalls.push([runId, options]);
        runOperations.push("agent.cancelRun");
        storedRuns = storedRuns.map((run) =>
          run.id === runId ? { ...run, status: "cancelled" } : run,
        );
      },
      messages: {
        list: async () => [],
      },
    },
    createAgentPlatform: async () => {
      const platform = platforms.shift();
      if (!platform) throw new Error("No agent platform");
      return platform();
    },
  };

  return {
    agent,
    agentClose,
    agentCreations,
    cancelRunCalls,
    closeExecutionOrder,
    listRunsCalls,
    platforms,
    runCancel,
    runOperations,
    runWait,
    send,
    sends,
    steerFailures,
    steers,
    waits,
    service: CursorSdk.CursorSdk.of({
      load: () => sdk as unknown as CursorSdkModule,
      loadSqlite: () =>
        ({ SqliteLocalAgentStore: { open: async () => ({}) } }) as unknown as ReturnType<
          CursorSdk.CursorSdk["Service"]["loadSqlite"]
        >,
    }),
    setStoredRuns: (runs: Array<{ readonly id: string; readonly status: string }>) => {
      storedRuns = runs;
    },
  };
})();

const layerTest = CursorAgentSdk.layer.pipe(
  Layer.provide(
    Layer.succeed(ProviderEventLoggers.ProviderEventLoggers, {
      native: {
        filePath: "cursor-agent-sdk-test.log",
        write: (event: unknown) =>
          Effect.sync(() => {
            if (
              typeof event === "object" &&
              event !== null &&
              Reflect.get(Reflect.get(event, "event"), "payload")?.type === "agent.close"
            ) {
              cursorSdkFake.closeExecutionOrder.push("protocol:agent.close");
            }
          }),
        close: () => Effect.void,
      },
      canonical: undefined,
    }),
  ),
  Layer.provide(Layer.succeed(CursorSdk.CursorSdk, cursorSdkFake.service)),
  Layer.provide(NodeServices.layer),
);

describe("CursorAgentSdkRunner", () => {
  it.effect("keeps sandbox priming alive when its first waiter is interrupted", () =>
    Effect.gen(function* () {
      const started = Promise.withResolvers<void>();
      const release = Promise.withResolvers<void>();
      let primed = false;
      cursorSdkFake.platforms.push(
        async () =>
          ({
            prewarmLocalWorkspace: async () => {
              started.resolve();
              await release.promise;
              return () => {
                primed = true;
              };
            },
          }) as unknown as Awaited<ReturnType<CreateAgentPlatform>>,
      );
      cursorSdkFake.agentCreations.push(async () => {
        assert.isTrue(primed);
        return cursorSdkFake.agent();
      });
      const runner = yield* CursorAgentSdk.CursorAgentSdkRunner;
      const input: CursorAgentSdk.CursorAgentSdkOpenInput = {
        operation: "create",
        threadId: ThreadId.make("thread-cursor-prime"),
        providerSessionId: ProviderSessionId.make("session-cursor-prime"),
        options: {
          model: { id: "default" },
          mode: "agent",
          local: { cwd: process.cwd(), sandboxOptions: { enabled: false } },
        },
      };
      const first = yield* runner.open(input).pipe(Effect.forkChild);
      yield* Effect.promise(() => started.promise);
      yield* Fiber.interrupt(first);
      const second = yield* runner.open(input).pipe(Effect.forkChild);
      yield* Effect.yieldNow;
      assert.isFalse(primed);
      release.resolve();
      assert.equal((yield* Fiber.join(second)).agentId, "agent-cursor-agent-sdk-test");
      assert.isTrue(primed);
    }).pipe(Effect.provide(layerTest)),
  );

  it.effect("resumes from the original store after the working directory changes", () =>
    Effect.gen(function* () {
      const fileSystem = yield* FileSystem.FileSystem;
      const workspace = yield* fileSystem.makeTempDirectoryScoped({ prefix: "cursor-resume-" });
      const sdk = loadCursorSdk();
      const store = new sdk.JsonlLocalAgentStore(workspace);
      const storeCwd = `${workspace}/checkout`;
      const cwd = `${workspace}/worktree`;
      const platform = yield* Effect.promise(() =>
        sdk.createAgentPlatform({ localStore: store, workspaceRef: storeCwd }),
      );
      const { agent } = yield* Effect.promise(() =>
        platform.store.createAgent({ agentId: "agent-moved", workspaceRef: storeCwd }),
      );
      const runner = yield* CursorAgentSdk.makeCursorAgentSdkRunner(() => undefined).pipe(
        Effect.provideService(CursorSdk.CursorSdk, {
          load: loadCursorSdk,
          loadSqlite: loadCursorSqlite,
        }),
      );
      const session = yield* runner.open({
        operation: "resume",
        agentId: agent.agentId,
        storeCwd,
        options: { apiKey: "synthetic-cursor-key", local: { cwd, store } },
        threadId: ThreadId.make("moved-workspace"),
        providerSessionId: ProviderSessionId.make("moved-workspace"),
      });
      assert.equal(session.agentId, agent.agentId);
      assert.deepStrictEqual(yield* session.listMessages, []);
      assert.strictEqual(yield* session.readContextUsage!, undefined);
      yield* session.close;
    }).pipe(Effect.provide(NodeServices.layer)),
  );

  it.effect("constructs without loading and reports first-use load failures as runner errors", () =>
    Effect.gen(function* () {
      const failure = new Error("missing SDK chunk");
      const load = vi.fn(() => {
        throw failure;
      });
      const runner = yield* CursorAgentSdk.makeCursorAgentSdkRunner(() => undefined).pipe(
        Effect.provideService(CursorSdk.CursorSdk, {
          load,
          loadSqlite: () => {
            throw new Error("unused SQLite");
          },
        }),
      );
      assert.strictEqual(load.mock.calls.length, 0);
      const result = yield* runner
        .open({
          operation: "create",
          options: {},
          threadId: ThreadId.make("lazy-load"),
          providerSessionId: ProviderSessionId.make("lazy-load"),
        })
        .pipe(Effect.exit);
      assert(Exit.isFailure(result));
      assert.deepStrictEqual(
        Cause.squash(result.cause),
        new CursorAgentSdk.CursorAgentSdkRunnerError({
          method: "agent.create",
          cause: failure,
        }),
      );
      assert.strictEqual(load.mock.calls.length, 1);
    }),
  );

  it.effect("retries a resumed send after cancelling its abandoned local run", () =>
    Effect.gen(function* () {
      cursorSdkFake.runOperations.length = 0;
      cursorSdkFake.listRunsCalls.length = 0;
      cursorSdkFake.cancelRunCalls.length = 0;
      cursorSdkFake.setStoredRuns([
        ...Array.from({ length: 50 }, (_, index) => ({
          id: `run-terminal-${index}`,
          status: index === 0 ? "cancelled" : "finished",
        })),
        { id: "run-stale", status: "running" },
      ]);

      const runner = yield* CursorAgentSdk.CursorAgentSdkRunner;
      const session = yield* runner.open({
        operation: "resume",
        agentId: "agent-cursor-agent-sdk-test",
        options: { model: { id: "default" }, mode: "agent", local: { cwd: process.cwd() } },
        threadId: ThreadId.make("thread-cursor-agent-sdk-stale-run-test"),
        providerSessionId: ProviderSessionId.make(
          "provider-session-cursor-agent-sdk-stale-run-test",
        ),
      });
      assert.deepStrictEqual(cursorSdkFake.runOperations, []);
      const run = yield* session.send({ message: "continue" });
      yield* run.wait;

      assert.deepStrictEqual(cursorSdkFake.runOperations, [
        "run.start",
        "agent.listRuns",
        "agent.listRuns",
        "agent.cancelRun",
        "run.start",
      ]);
      assert.deepStrictEqual(cursorSdkFake.listRunsCalls[0], [
        "agent-cursor-agent-sdk-test",
        { runtime: "local", cwd: process.cwd() },
      ]);
      assert.strictEqual(cursorSdkFake.listRunsCalls.length, 2);
      assert.deepStrictEqual(cursorSdkFake.listRunsCalls[1], [
        "agent-cursor-agent-sdk-test",
        { runtime: "local", cwd: process.cwd(), cursor: "50" },
      ]);
      assert.deepStrictEqual(cursorSdkFake.cancelRunCalls[0], [
        "run-stale",
        {
          runtime: "local",
          cwd: process.cwd(),
        },
      ]);
    }).pipe(Effect.provide(layerTest)),
  );

  it.effect("forwards the agent's own shell stream output as shell-output-delta", () =>
    Effect.gen(function* () {
      const publish = (conversationId: string, data: string) =>
        (Reflect.get(globalThis, Symbol.for("@cursor/sdk.shellStreamOutput")) as Function)({
          conversationId,
          toolCallId: "tool-shell",
          event: { case: "stdout", value: { data } },
        });
      cursorSdkFake.waits.push(async () => {
        publish("agent-cursor-agent-sdk-test", "tick 1\n");
        publish("agent-someone-else", "not ours\n");
        return finishedRun;
      });
      const updates: Array<unknown> = [];
      const runner = yield* CursorAgentSdk.CursorAgentSdkRunner;
      const session = yield* runner.open({
        operation: "create",
        options: {},
        threadId: ThreadId.make("thread-cursor-agent-sdk-shell"),
        providerSessionId: ProviderSessionId.make("provider-session-cursor-agent-sdk-shell"),
      });
      const run = yield* session.send({
        message: "run it",
        onDelta: (update) => Effect.sync(() => updates.push(update)),
      });
      yield* run.wait;
      publish("agent-cursor-agent-sdk-test", "after the run\n");

      assert.deepStrictEqual(
        updates.filter(
          (update) => (update as { readonly type: string }).type === "shell-output-delta",
        ),
        [
          {
            type: "shell-output-delta",
            event: { case: "stdout", value: { data: "tick 1\n" }, toolCallId: "tool-shell" },
          },
        ],
      );
    }).pipe(Effect.provide(layerTest)),
  );

  it.effect("forwards Run.steer and reports a missing method as a follow-up", () =>
    Effect.gen(function* () {
      cursorSdkFake.steers.length = 0;
      const runner = yield* CursorAgentSdk.CursorAgentSdkRunner;
      const session = yield* runner.open({
        operation: "create",
        options: {},
        threadId: ThreadId.make("thread-cursor-agent-sdk-steer"),
        providerSessionId: ProviderSessionId.make("provider-session-cursor-agent-sdk-steer"),
      });
      const run = yield* session.send({ message: "continue" });
      assert.equal(yield* run.steer!("keep going"), "complete_delivered");
      assert.deepStrictEqual(cursorSdkFake.steers, [["keep going"]]);

      cursorSdkFake.steerFailures.push(new Error("steer transport failed"));
      const failed = yield* run.steer!("again").pipe(Effect.exit);
      assert(Exit.isFailure(failed));

      cursorSdkFake.sends.push(async () => ({
        id: "run-without-steer",
        agentId: "agent-cursor-agent-sdk-test",
        wait: cursorSdkFake.runWait,
        cancel: cursorSdkFake.runCancel,
        steer: undefined,
      }));
      const plain = yield* session.send({ message: "plain" });
      assert.equal(yield* plain.steer!("later"), "revert_to_followup");
    }).pipe(Effect.provide(layerTest)),
  );
});
