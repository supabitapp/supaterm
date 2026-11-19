import {
  ORCHESTRATION_V2_WS_METHODS,
  type EnvironmentId,
  type OrchestrationV2CommandOutputFrame,
  type OrchestrationV2Run,
  type OrchestrationV2RunStatus,
  type RunId,
  type ThreadId,
  type OrchestrationV2ThreadLinkMetadata,
  type OrchestrationGetTurnDiffResult,
  type OrchestrationV2GetTurnItemInput,
} from "@supaterm/contracts";
import { latestExecutedRun } from "@supaterm/shared/orchestrationV2ThreadError";
import * as Effect from "effect/Effect";
import * as Option from "effect/Option";
import * as Stream from "effect/Stream";
import * as SubscriptionRef from "effect/SubscriptionRef";
import type { HttpClient } from "effect/http";
import { Atom } from "effect/reactivity";

import {
  applyCommandOutputFrame,
  EMPTY_COMMAND_OUTPUT,
  type CommandOutputView,
} from "./commandOutput.ts";

import {
  createEnvironmentQueryAtomFamily,
  createEnvironmentRpcCommand,
  createEnvironmentRpcQueryAtomFamily,
  createEnvironmentRpcSubscriptionAtomFamily,
  createEnvironmentCommand,
  type QueryAnswerHandler,
} from "./runtime.ts";
import type { EnvironmentRegistry } from "../connection/registry.ts";
import * as EnvironmentSupervisor from "../connection/supervisor.ts";
import { EnvironmentRpcUnavailableError, request } from "../rpc/client.ts";
import type { EnvironmentShellState } from "./shell.ts";
import { fetchEnvironmentThreadTranscript } from "./threadTranscriptHttp.ts";

const commandOutputViews = <E, R>(frames: Stream.Stream<OrchestrationV2CommandOutputFrame, E, R>) =>
  frames.pipe(
    Stream.scan(() => EMPTY_COMMAND_OUTPUT, applyCommandOutputFrame),
    Stream.filter((view) => view !== EMPTY_COMMAND_OUTPUT),
  );

export function createOrchestrationEnvironmentAtoms<R, E>(
  runtime: Atom.AtomRuntime<EnvironmentRegistry | HttpClient.HttpClient | R, E>,
  options: {
    /** Re-checks `threadTitles` when one of their threads leaves the shell, and the archive on any removal. */
    readonly shellState?: (
      environmentId: EnvironmentId,
    ) => Atom.Atom<Pick<EnvironmentShellState, "removedAt">>;
    /** Runs on each turn-range and full-thread diff the server answers. */
    readonly onCheckpointDiffAnswer?: QueryAnswerHandler<
      { readonly ignoreWhitespace?: boolean },
      OrchestrationGetTurnDiffResult
    >;
  } = {},
) {
  const onCheckpointDiffAnswer =
    options.onCheckpointDiffAnswer === undefined
      ? {}
      : { onAnswer: options.onCheckpointDiffAnswer };
  const shellState = options.shellState;
  const liveTurnItem = createEnvironmentRpcQueryAtomFamily(runtime, {
    label: "environment-data:orchestration:turn-item",
    tag: ORCHESTRATION_V2_WS_METHODS.getTurnItem,
    staleTimeMs: 60_000,
    idleTtlMs: 60_000,
  });
  const settledTurnItem = createEnvironmentRpcQueryAtomFamily(runtime, {
    label: "environment-data:orchestration:turn-item",
    tag: ORCHESTRATION_V2_WS_METHODS.getTurnItem,
    staleTimeMs: Number.POSITIVE_INFINITY,
    idleTtlMs: 5 * 60_000,
  });
  const refreshThreadLookup = ({
    environmentId,
    input,
  }: {
    readonly environmentId: EnvironmentId;
    readonly input: { readonly threadIds: ReadonlyArray<ThreadId> };
  }) => {
    if (shellState === undefined) return undefined;
    const state = shellState(environmentId);
    return Atom.make((get) => {
      const { removedAt } = get(state);
      return Math.max(-1, ...input.threadIds.map((threadId) => removedAt.get(threadId) ?? -1));
    });
  };
  return {
    threadTitles: createEnvironmentRpcQueryAtomFamily(runtime, {
      label: "environment-data:orchestration:thread-titles",
      tag: ORCHESTRATION_V2_WS_METHODS.getThreadTitles,
      staleTimeMs: 0,
      idleTtlMs: 0,
      refreshTrigger: refreshThreadLookup,
    }),
    threadLinkMetadata: createEnvironmentQueryAtomFamily(runtime, {
      label: "environment-data:orchestration:thread-link-metadata",
      staleTimeMs: 0,
      idleTtlMs: 0,
      refreshTrigger: refreshThreadLookup,
      execute: Effect.fn("orchestration.threadLinkMetadata")(function* (input: {
        readonly threadIds: ReadonlyArray<ThreadId>;
      }) {
        const supervisor = yield* EnvironmentSupervisor.EnvironmentSupervisor;
        const session = yield* SubscriptionRef.get(supervisor.session);
        if (Option.isNone(session)) {
          return yield* new EnvironmentRpcUnavailableError({
            environmentId: supervisor.target.environmentId,
            message: "The environment has no session.",
          });
        }
        const config = yield* session.value.initialConfig;
        if (config.threadLinkMetadata === true) {
          return yield* request(ORCHESTRATION_V2_WS_METHODS.getThreadLinkMetadata, input);
        }
        const titles = yield* request(ORCHESTRATION_V2_WS_METHODS.getThreadTitles, input);
        return Object.fromEntries(
          Object.entries(titles).map(([id, title]) => [
            id,
            { title, projectId: null } satisfies OrchestrationV2ThreadLinkMetadata,
          ]),
        );
      }),
    }),
    threadTranscript: createEnvironmentCommand(runtime, {
      label: "environment-data:orchestration:thread-transcript",
      execute: Effect.fn("orchestration.execute")(function* (input: {
        readonly threadId: ThreadId;
      }) {
        const supervisor = yield* EnvironmentSupervisor.EnvironmentSupervisor;
        const prepared = yield* SubscriptionRef.get(supervisor.prepared);
        if (Option.isNone(prepared)) {
          return yield* new EnvironmentRpcUnavailableError({
            environmentId: supervisor.target.environmentId,
            message: "The source environment is not connected.",
          });
        }
        return yield* fetchEnvironmentThreadTranscript({
          prepared: prepared.value,
          threadId: input.threadId,
        });
      }),
    }),
    v2: {
      dispatchCommand: createEnvironmentRpcCommand(runtime, {
        label: "environment-data:orchestration-v2:dispatch-command",
        tag: ORCHESTRATION_V2_WS_METHODS.dispatchCommand,
      }),
      shell: createEnvironmentRpcSubscriptionAtomFamily(runtime, {
        label: "environment-data:orchestration-v2:shell",
        tag: ORCHESTRATION_V2_WS_METHODS.subscribeShell,
      }),
      thread: createEnvironmentRpcSubscriptionAtomFamily(runtime, {
        label: "environment-data:orchestration-v2:thread",
        tag: ORCHESTRATION_V2_WS_METHODS.subscribeThread,
        idleTtlMs: 0,
      }),
      commandOutput: createEnvironmentRpcSubscriptionAtomFamily(runtime, {
        label: "environment-data:orchestration-v2:command-output",
        tag: ORCHESTRATION_V2_WS_METHODS.subscribeCommandOutput,
        idleTtlMs: 0,
        completeWhen: (view: CommandOutputView) => !view.running,
        completedTtlMs: 5 * 60_000,
        transform: commandOutputViews,
      }),
      backgroundTaskOutput: createEnvironmentRpcSubscriptionAtomFamily(runtime, {
        label: "environment-data:orchestration-v2:background-task-output",
        tag: ORCHESTRATION_V2_WS_METHODS.subscribeBackgroundTaskOutput,
        idleTtlMs: 0,
        transform: commandOutputViews,
      }),
    },
    turnDiff: createEnvironmentRpcQueryAtomFamily(runtime, {
      label: "environment-data:orchestration:turn-diff",
      tag: ORCHESTRATION_V2_WS_METHODS.getTurnDiff,
      ...onCheckpointDiffAnswer,
    }),
    workflowScript: createEnvironmentRpcQueryAtomFamily(runtime, {
      label: "environment-data:orchestration:workflow-script",
      tag: ORCHESTRATION_V2_WS_METHODS.getWorkflowScript,
      staleTimeMs: 300_000,
      idleTtlMs: 300_000,
    }),
    nativeChildWork: createEnvironmentRpcQueryAtomFamily(runtime, {
      label: "environment-data:orchestration:native-child-work",
      tag: ORCHESTRATION_V2_WS_METHODS.getNativeChildWork,
      staleTimeMs: 0,
      idleTtlMs: 0,
    }),
    stopWorkflow: createEnvironmentRpcCommand(runtime, {
      label: "environment-data:orchestration:stop-workflow",
      tag: ORCHESTRATION_V2_WS_METHODS.stopWorkflow,
    }),
    suggestNextPrompt: createEnvironmentRpcCommand(runtime, {
      label: "environment-data:orchestration:suggest-next-prompt",
      tag: ORCHESTRATION_V2_WS_METHODS.suggestNextPrompt,
    }),
    forceStopThread: createEnvironmentRpcCommand(runtime, {
      label: "environment-data:orchestration:force-stop-thread",
      tag: ORCHESTRATION_V2_WS_METHODS.forceStopThread,
    }),
    turnItem: (target: {
      readonly environmentId: EnvironmentId;
      readonly input: OrchestrationV2GetTurnItemInput;
    }) =>
      target.input.revision === undefined || target.input.revision === "live"
        ? liveTurnItem(target)
        : settledTurnItem(target),
    fullThreadDiff: createEnvironmentRpcQueryAtomFamily(runtime, {
      label: "environment-data:orchestration:full-thread-diff",
      tag: ORCHESTRATION_V2_WS_METHODS.getFullThreadDiff,
      ...onCheckpointDiffAnswer,
    }),
    threadFind: createEnvironmentRpcQueryAtomFamily(runtime, {
      label: "environment-data:orchestration:thread-find",
      tag: ORCHESTRATION_V2_WS_METHODS.searchThread,
      staleTimeMs: 0,
      idleTtlMs: 0,
    }),
    threadFindProgressive: createEnvironmentRpcSubscriptionAtomFamily(runtime, {
      label: "environment-data:orchestration:thread-find-progressive",
      tag: ORCHESTRATION_V2_WS_METHODS.searchThreadStream,
      completeWhen: (result) => result.complete !== false,
      idleTtlMs: 0,
    }),
    threadSearch: createEnvironmentRpcQueryAtomFamily(runtime, {
      label: "environment-data:orchestration:thread-search",
      tag: ORCHESTRATION_V2_WS_METHODS.searchThreads,
      staleTimeMs: 0,
      idleTtlMs: 0,
    }),
    archivedShellSnapshot: createEnvironmentRpcQueryAtomFamily(runtime, {
      label: "environment-data:orchestration:archived-shell-snapshot",
      tag: ORCHESTRATION_V2_WS_METHODS.getArchivedShellSnapshot,
      refreshTrigger: ({ environmentId }) => {
        if (shellState === undefined) return undefined;
        const state = shellState(environmentId);
        return Atom.make((get) => get(state).removedAt);
      },
    }),
    threadFamily: createEnvironmentRpcQueryAtomFamily(runtime, {
      label: "environment-data:orchestration:thread-family-for-delete",
      tag: ORCHESTRATION_V2_WS_METHODS.getThreadFamily,
      staleTimeMs: 0,
      idleTtlMs: 0,
    }),
    worktreeThreadIds: createEnvironmentRpcQueryAtomFamily(runtime, {
      label: "environment-data:orchestration:worktree-thread-ids",
      tag: ORCHESTRATION_V2_WS_METHODS.getWorktreeThreadIds,
      staleTimeMs: 0,
      idleTtlMs: 0,
    }),
  };
}

/**
 * The completed run a client asks for a next prompt suggestion about, or null when it should not ask.
 * A message promoted to Steer leaves its queued run cancelled before it started, still the latest
 * run, so the last run that ran answers instead. Detail can lag the shell, so that skip waits until
 * `runs` include the cancelled run.
 */
export function nextPromptSuggestionRunId(input: {
  readonly enabled: boolean;
  readonly connected: boolean;
  readonly canSuggest: boolean;
  readonly latestRun:
    | {
        readonly runId: RunId;
        readonly status: OrchestrationV2RunStatus;
        readonly startedAt?: string | null;
      }
    | null
    | undefined;
  readonly runs?: ReadonlyArray<OrchestrationV2Run>;
}): RunId | null {
  const { enabled, connected, canSuggest, latestRun, runs = [] } = input;
  if (!enabled || !connected || !canSuggest || !latestRun) return null;
  if (latestRun.status === "completed") return latestRun.runId;
  const steered =
    latestRun.status === "cancelled" &&
    latestRun.startedAt === null &&
    runs.some(
      (run) => run.id === latestRun.runId && run.status === "cancelled" && run.startedAt === null,
    );
  if (!steered) return null;
  const executed = latestExecutedRun(runs);
  return executed?.status === "completed" ? executed.id : null;
}
