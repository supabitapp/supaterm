import { expect, it } from "@effect/vitest";
import {
  type OrchestrationV2CommandOutputFrame,
  type OrchestrationV2ThreadProjection,
  ProviderSessionId,
  ProviderThreadId,
  ThreadId,
  TurnItemId,
} from "@supaterm/contracts";
import type * as ProviderAdapter from "@supaterm/provider-core/server/ProviderAdapter";
import {
  appendTerminalOutput,
  EMPTY_TERMINAL_OUTPUT,
  TERMINAL_OUTPUT_TAIL_CHARS,
} from "@supaterm/shared/terminalOutput";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";
import * as Result from "effect/Result";
import * as Stream from "effect/Stream";

import * as BackgroundTaskOutput from "./BackgroundTaskOutput.ts";
import * as CommandOutputHub from "./CommandOutputHub.ts";
import * as Orchestrator from "./Orchestrator.ts";
import * as ProviderSessionManager from "./ProviderSessionManager.ts";

const threadId = ThreadId.make("thread:background-output");
const providerSessionId = ProviderSessionId.make("provider-session:background-output");
const providerThreadId = ProviderThreadId.make("provider-thread:background-output");
const itemId = TurnItemId.make("turn-item:background-output");
const hubFrame: OrchestrationV2CommandOutputFrame = {
  kind: "replace",
  text: "from the hub",
  truncated: false,
  running: true,
};

const subscribe = (input: {
  readonly taskId: string;
  /** What the provider runtime streams, or null when it cannot read task output. */
  readonly runtimeOutput: ReadonlyArray<string> | null;
}) => {
  const hubTargets: Array<unknown> = [];
  const runtimeTasks: Array<string> = [];
  const runtime =
    input.runtimeOutput === null
      ? {}
      : {
          backgroundTaskOutput: (request: { readonly taskId: string }) => {
            runtimeTasks.push(request.taskId);
            return Stream.fromIterable(input.runtimeOutput ?? []);
          },
        };
  const layer = BackgroundTaskOutput.layer.pipe(
    Layer.provide(
      Layer.mergeAll(
        Layer.mock(Orchestrator.OrchestratorV2)({
          getThreadRecords: () =>
            Effect.succeed({
              providerThreads: [
                {
                  id: providerThreadId,
                  providerSessionId,
                  pendingBackgroundTasks: [
                    { taskId: "build", kind: "command" },
                    { taskId: "reviewer", kind: "subagent" },
                  ],
                },
              ],
              turnItems: [
                {
                  id: itemId,
                  threadId,
                  type: "command_execution",
                  status: "running",
                  nativeItemRef: { nativeId: "dev-server" },
                },
              ],
            } as unknown as OrchestrationV2ThreadProjection),
        }),
        Layer.mock(ProviderSessionManager.ProviderSessionManagerV2)({
          get: () =>
            Effect.succeedSome(
              runtime as unknown as ProviderAdapter.ProviderAdapterV2SessionRuntime,
            ),
        }),
        Layer.mock(CommandOutputHub.CommandOutputHub)({
          subscribe: (target) => {
            hubTargets.push(target);
            return Stream.make(hubFrame);
          },
        }),
      ),
    ),
  );
  return Effect.gen(function* () {
    const service = yield* BackgroundTaskOutput.BackgroundTaskOutput;
    const result = yield* service
      .subscribe({ threadId, taskId: input.taskId })
      .pipe(Stream.runCollect, Effect.result);
    return { result, hubTargets, runtimeTasks };
  }).pipe(Effect.provide(layer));
};

it.effect("frames a provider's own task output so a client rebuilds its bounded tail", () =>
  Effect.gen(function* () {
    // Past the tail limit, so the client is sent the bounded tail instead of raw text.
    const chunks = ["one\n", "x".repeat(TERMINAL_OUTPUT_TAIL_CHARS + 1_000), "\ntail\n"];
    const { result, hubTargets, runtimeTasks } = yield* subscribe({
      taskId: "build",
      runtimeOutput: chunks,
    });

    expect(runtimeTasks).toEqual(["build"]);
    expect(hubTargets).toEqual([]);
    const frames = Result.getOrThrow(result);
    // What a client holds after applying each frame, as `applyCommandOutputFrame` does.
    const rebuilt = frames.reduce((output, frame) => {
      const base = frame.kind === "replace" ? EMPTY_TERMINAL_OUTPUT : output;
      return appendTerminalOutput(
        { ...base, truncated: base.truncated || frame.truncated },
        frame.text,
      );
    }, EMPTY_TERMINAL_OUTPUT);
    const expected = chunks.reduce(
      (output, chunk) => appendTerminalOutput(output, chunk),
      EMPTY_TERMINAL_OUTPUT,
    );
    expect(expected.truncated).toBe(true);
    expect({ text: rebuilt.text, truncated: rebuilt.truncated }).toEqual({
      text: expected.text,
      truncated: expected.truncated,
    });
    expect(frames.map((frame) => frame.kind)).toEqual([
      "replace",
      "append",
      "replace",
      "append",
      "append",
    ]);
    expect(frames.map((frame) => frame.running)).toEqual([true, true, true, true, false]);
  }),
);

it.effect("streams a command still running after its turn from the hub", () =>
  Effect.gen(function* () {
    const { result, hubTargets, runtimeTasks } = yield* subscribe({
      taskId: "dev-server",
      runtimeOutput: ["unused"],
    });

    expect(hubTargets).toEqual([{ threadId, itemId }]);
    expect(runtimeTasks).toEqual([]);
    expect(result).toMatchObject({ success: [hubFrame] });
  }),
);

it.effect.each([
  { name: "a task the thread does not list", taskId: "finished", supported: true },
  { name: "a subagent", taskId: "reviewer", supported: true },
  { name: "a runtime that cannot read output", taskId: "build", supported: false },
])("refuses $name", ({ taskId, supported }) =>
  Effect.gen(function* () {
    const { result, runtimeTasks } = yield* subscribe({
      taskId,
      runtimeOutput: supported ? ["unused"] : null,
    });

    expect(result).toMatchObject({
      failure: { _tag: "OrchestrationV2CommandOutputError", threadId },
    });
    expect(runtimeTasks).toEqual([]);
  }),
);
