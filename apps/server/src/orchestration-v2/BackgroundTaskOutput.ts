import {
  OrchestrationV2CommandOutputError,
  type OrchestrationV2CommandOutputFrame,
  type OrchestrationV2SubscribeBackgroundTaskOutputInput,
} from "@supaterm/contracts";
import { nativeTaskIdFromTurnItem } from "@supaterm/shared/orchestrationV2PendingBackgroundWork";
import {
  appendTerminalOutput,
  EMPTY_TERMINAL_OUTPUT,
  terminalOutputResumeText,
} from "@supaterm/shared/terminalOutput";
import * as Context from "effect/Context";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";
import * as Option from "effect/Option";
import * as Schema from "effect/Schema";
import * as Stream from "effect/Stream";

import * as CommandOutputHub from "./CommandOutputHub.ts";
import * as Orchestrator from "./Orchestrator.ts";
import * as ProviderSessionManager from "./ProviderSessionManager.ts";

/** Larger chunks reach the client as the bounded tail rather than raw text. */
const MAX_APPEND_CHARS = 16 * 1024;

export interface BackgroundTaskOutputShape {
  /**
   * Live output of one pending background command or monitor. A provider's own task streams
   * from its runtime; a command item still running after its turn streams from the hub.
   */
  readonly subscribe: (
    input: OrchestrationV2SubscribeBackgroundTaskOutputInput,
  ) => Stream.Stream<OrchestrationV2CommandOutputFrame, OrchestrationV2CommandOutputError>;
}

export class BackgroundTaskOutput extends Context.Service<
  BackgroundTaskOutput,
  BackgroundTaskOutputShape
>()("supaterm/orchestration-v2/BackgroundTaskOutput") {}

const isCommandOutputError = Schema.is(OrchestrationV2CommandOutputError);

function framesFromChunks<E>(
  chunks: Stream.Stream<string, E>,
): Stream.Stream<OrchestrationV2CommandOutputFrame, E> {
  const opened: OrchestrationV2CommandOutputFrame = {
    kind: "replace",
    text: "",
    truncated: false,
    running: true,
  };
  return Stream.succeed(opened).pipe(
    Stream.concat(
      chunks.pipe(
        Stream.mapAccum(
          () => EMPTY_TERMINAL_OUTPUT,
          (state, chunk) => {
            const next = appendTerminalOutput(state, chunk);
            const frame: OrchestrationV2CommandOutputFrame =
              chunk.length > MAX_APPEND_CHARS
                ? {
                    kind: "replace",
                    text: terminalOutputResumeText(next),
                    truncated: next.truncated,
                    running: true,
                  }
                : { kind: "append", text: chunk, truncated: next.truncated, running: true };
            return [next, [frame]] as const;
          },
          {
            onHalt: (state): ReadonlyArray<OrchestrationV2CommandOutputFrame> => [
              { kind: "append", text: "", truncated: state.truncated, running: false },
            ],
          },
        ),
      ),
    ),
  );
}

const make = Effect.gen(function* () {
  const orchestrator = yield* Orchestrator.OrchestratorV2;
  const sessions = yield* ProviderSessionManager.ProviderSessionManagerV2;
  const commandOutputHub = yield* CommandOutputHub.CommandOutputHub;

  const subscribe: BackgroundTaskOutputShape["subscribe"] = (input) => {
    const unavailable = (message: string, cause?: unknown) =>
      new OrchestrationV2CommandOutputError({
        threadId: input.threadId,
        message,
        ...(cause === undefined ? {} : { cause }),
      });
    return Stream.unwrap(
      Effect.gen(function* () {
        const records = yield* orchestrator.getThreadRecords(
          input.threadId,
          ["providerThreads", "turnItems"],
          {
            turnItemTypes: ["command_execution"],
            turnItemStatuses: ["pending", "running", "waiting"],
          },
        );
        const providerThread = records.providerThreads.find((candidate) =>
          candidate.pendingBackgroundTasks?.some(
            (task) => task.taskId === input.taskId && task.kind !== "subagent",
          ),
        );
        if (providerThread === undefined) {
          const item = records.turnItems.find(
            (candidate) => nativeTaskIdFromTurnItem(candidate) === input.taskId,
          );
          if (item === undefined) return yield* unavailable("This task is not running.");
          return commandOutputHub.subscribe({ threadId: item.threadId, itemId: item.id });
        }
        const runtime =
          providerThread.providerSessionId == null
            ? Option.none()
            : yield* sessions.get(providerThread.providerSessionId);
        if (Option.isNone(runtime) || runtime.value.backgroundTaskOutput === undefined) {
          return yield* unavailable("Output isn't available for this task.");
        }
        return framesFromChunks(
          runtime.value
            .backgroundTaskOutput({ providerThread, taskId: input.taskId })
            .pipe(Stream.mapError((cause) => unavailable("Failed to read task output.", cause))),
        );
      }).pipe(
        Effect.mapError((cause) =>
          isCommandOutputError(cause) ? cause : unavailable("Failed to read task output.", cause),
        ),
      ),
    );
  };

  return BackgroundTaskOutput.of({ subscribe });
});

export const layer: Layer.Layer<
  BackgroundTaskOutput,
  never,
  | Orchestrator.OrchestratorV2
  | ProviderSessionManager.ProviderSessionManagerV2
  | CommandOutputHub.CommandOutputHub
> = Layer.effect(BackgroundTaskOutput, make);
