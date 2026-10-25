import {
  ContextTransferId,
  isForkableSourceRunStatus,
  OrchestrationV2Actor,
  OrchestrationV2AppThread,
  OrchestrationV2ContextSourcePoint,
  OrchestrationV2ContextTransfer,
  OrchestrationV2CreationSource,
  OrchestrationV2ProviderThread,
  OrchestrationV2ProviderTurnTokenUsage,
  OrchestrationV2Run,
  OrchestrationV2ThreadProjection,
  RuntimeMode,
  ThreadId,
} from "@supaterm/contracts";
import * as Context from "effect/Context";
import * as DateTime from "effect/DateTime";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";
import * as Schema from "effect/Schema";
import { withoutInheritedWatches } from "./threadWatches.ts";

export interface ThreadForkPlanV2 {
  readonly targetThread: OrchestrationV2AppThread;
  readonly transfer: OrchestrationV2ContextTransfer;
}

export class ThreadForkPlanError extends Schema.TaggedError<ThreadForkPlanError>()(
  "ThreadForkPlanError",
  {
    sourceThreadId: ThreadId,
    targetThreadId: ThreadId,
    cause: Schema.optional(Schema.Defect()),
  },
) {}

export function forkableSourceRunStatusError(
  run: Pick<OrchestrationV2Run, "id" | "status">,
): string {
  return `Fork source run ${run.id} is ${run.status}; in-progress and rolled-back runs cannot be forked.`;
}

export interface ThreadForkServiceV2Shape {
  readonly plan: (input: {
    readonly sourceProjection: Pick<OrchestrationV2ThreadProjection, "thread">;
    readonly sourceRun: OrchestrationV2Run;
    readonly sourceProviderThread: OrchestrationV2ProviderThread | undefined;
    readonly sourceTokenUsage?: OrchestrationV2ProviderTurnTokenUsage | undefined;
    readonly canonicalSourcePoint: OrchestrationV2ContextSourcePoint;
    readonly transferId: ContextTransferId;
    readonly targetThreadId: ThreadId;
    readonly title?: string;
    readonly sideChat?: boolean;
    readonly runtimeMode?: RuntimeMode;
    /** The source run is still in progress and the fork captures it as it stands. */
    readonly liveSnapshot?: boolean;
    readonly createdBy: OrchestrationV2Actor;
    readonly creationSource: OrchestrationV2CreationSource;
    readonly createdAt: DateTime.Utc;
  }) => Effect.Effect<ThreadForkPlanV2, ThreadForkPlanError>;
}

export class ThreadForkServiceV2 extends Context.Service<
  ThreadForkServiceV2,
  ThreadForkServiceV2Shape
>()("supaterm/orchestration-v2/ThreadForkService/ThreadForkServiceV2") {}

export const layer: Layer.Layer<ThreadForkServiceV2> = Layer.succeed(
  ThreadForkServiceV2,
  ThreadForkServiceV2.of({
    plan: Effect.fn("ThreadForkService.plan")(function* (input) {
      if (input.liveSnapshot !== true && !isForkableSourceRunStatus(input.sourceRun.status)) {
        return yield* new ThreadForkPlanError({
          sourceThreadId: input.sourceProjection.thread.id,
          targetThreadId: input.targetThreadId,
          cause: forkableSourceRunStatusError(input.sourceRun),
        });
      }
      const {
        sideChat: _sideChat,
        sideChatPromotedAt: _promotedAt,
        ...source
      } = withoutInheritedWatches(input.sourceProjection.thread);
      const targetThread: OrchestrationV2AppThread = {
        ...source,
        ...(input.sideChat === true ? { sideChat: true } : {}),
        ...(input.runtimeMode === undefined ? {} : { runtimeMode: input.runtimeMode }),
        createdBy: input.createdBy,
        creationSource: input.creationSource,
        id: input.targetThreadId,
        title:
          input.title ??
          `${input.sourceProjection.thread.title} ${input.sideChat === true ? "side chat" : "fork"}`,
        activeProviderThreadId: null,
        lineage: {
          parentThreadId: input.sourceProjection.thread.id,
          relationshipToParent: "fork",
          rootThreadId: input.sourceProjection.thread.lineage.rootThreadId,
        },
        forkedFrom: {
          type: "run",
          threadId: input.sourceProjection.thread.id,
          runId: input.sourceRun.id,
        },
        createdAt: input.createdAt,
        updatedAt: input.createdAt,
        archivedAt: null,
        doneOverride: null,
        doneAt: null,
        snoozedUntil: null,
        snoozedAt: null,
        lastVisitedAt: null,
        deletedAt: null,
      };
      const transfer: OrchestrationV2ContextTransfer = {
        id: input.transferId,
        type: "fork",
        sourceThreadId: input.sourceProjection.thread.id,
        targetThreadId: input.targetThreadId,
        sourcePoint: input.canonicalSourcePoint,
        basePoint: null,
        sourceProviderInstanceId: input.sourceRun.providerInstanceId,
        // Only native forks retain this context; portable handoffs rebuild it.
        sourceTokenUsage:
          (input.sourceRun.status === "completed" || input.sourceRun.status === "waiting") &&
          input.sourceProviderThread?.nativeThreadRef?.strength === "strong"
            ? input.sourceTokenUsage
            : undefined,
        targetProviderInstanceId: null,
        targetRunId: null,
        status: "pending",
        resolution: null,
        createdBy: input.createdBy,
        error:
          input.sourceProviderThread?.nativeThreadRef?.strength === "strong"
            ? null
            : "Source provider thread does not expose a strong native thread ref.",
        ...(input.liveSnapshot === true ? { snapshot: "live" as const } : {}),
        createdAt: input.createdAt,
        updatedAt: input.createdAt,
        consumedAt: null,
      };
      return { targetThread, transfer };
    }),
  }),
);
