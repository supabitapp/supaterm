import type { ModelSelection, ThreadId } from "@supaterm/contracts";
import * as SecureRandom from "effect/crypto/SecureRandom";
import * as Effect from "effect/Effect";
import * as Option from "effect/Option";
import { Atom } from "effect/reactivity";
import {
  WS_METHODS,
  ORCHESTRATION_V2_WS_METHODS,
  type OrchestrationV2Command,
  type EnvironmentId,
  type OrchestrationV2ShellSnapshot,
  isOrchestrationV2RunUnsettled,
  isOrchestrationV2RunNotYetRunning,
} from "@supaterm/contracts";

import { createOptimisticThreadLifecycle } from "./threadLifecycle.ts";
import { createOptimisticThreadCreation } from "./threadCreation.ts";
import * as DateTime from "effect/DateTime";

import {
  createAtomCommandScheduler,
  createEnvironmentCommand,
  createEnvironmentRpcCommand,
} from "./runtime.ts";
import {
  type InterruptThreadTurnInput,
  type UpdateThreadMetadataInput,
  archiveThread,
  cancelQueuedRun,
  createThread,
  deleteThread,
  editQueuedRun,
  interruptThreadTurn,
  forkSideChat,
  forkThreadFromRun,
  promoteSideChat,
  markThreadUnread,
  mergeThreadBack,
  promoteQueuedRun,
  resumeThreadQueue,
  retryWorkspacePreparation,
  linkThreadPullRequest,
  respondToThreadApproval,
  respondToThreadUserInput,
  dismissThreadUserInput,
  revertThreadCheckpoint,
  setThreadInteractionMode,
  setThreadRuntimeMode,
  pinThread,
  pinThreadMessage,
  reorderPinnedThread,
  reorderActiveThread,
  setThreadAutoMarkDone,
  markThreadDone,
  snoozeThread,
  startThreadTurn,
  stopThreadSession,
  unarchiveThread,
  unlinkThreadPullRequest,
  unpinThread,
  unpinThreadMessage,
  reopenThread,
  unsnoozeThread,
  updateThreadMetadata,
  visitThread,
  watchThreadPullRequest,
} from "../operations/commands.ts";
import type { EnvironmentRegistry } from "../connection/registry.ts";
import * as EnvironmentSupervisor from "../connection/supervisor.ts";
import * as ThreadHistoryController from "./threadHistoryController.ts";

export type LoadEarlierThreadHistoryInput = {
  readonly threadId: ThreadId;
  readonly throughEntryId?: string;
  readonly workAnchorId?: string;
};

export function createThreadEnvironmentAtoms<R, E>(
  runtime: Atom.AtomRuntime<EnvironmentRegistry | SecureRandom.SecureRandom | R, E>,
  snapshotAtom: (environmentId: EnvironmentId) => Atom.Atom<OrchestrationV2ShellSnapshot | null>,
) {
  const scheduler = createAtomCommandScheduler();
  const concurrency = {
    mode: "serial" as const,
    key: ({ environmentId, input }: { environmentId: string; input: { threadId: string } }) =>
      JSON.stringify([environmentId, input.threadId]),
  };
  const loadEarlierHistory = Effect.fn("ThreadCommands.loadEarlierHistory")(function* (
    input: LoadEarlierThreadHistoryInput,
  ) {
    const supervisor = yield* EnvironmentSupervisor.EnvironmentSupervisor;
    const controller = yield* Effect.serviceOption(ThreadHistoryController.ThreadHistoryController);
    if (Option.isNone(controller)) {
      return {
        _tag: "noop",
      } satisfies ThreadHistoryController.ThreadHistoryLoadEarlierResult;
    }
    return yield* controller.value.loadEarlier(
      supervisor.target.environmentId,
      input.threadId,
      input.throughEntryId,
      input.workAnchorId,
    );
  });

  // Runs whether or not the server accepted the interrupt, so a stale cached item still
  // settles when Stop had nothing to interrupt; the interrupt's own failure still surfaces.
  // The repair is detached: its lookups must not hold the thread's serial command key, and
  // closing the thread cancels the repair, not the Stop that triggered it.
  const interruptTurn = Effect.fn("ThreadCommands.interruptTurn")(function* (
    input: InterruptThreadTurnInput,
  ) {
    const supervisor = yield* EnvironmentSupervisor.EnvironmentSupervisor;
    const controller = yield* Effect.serviceOption(ThreadHistoryController.ThreadHistoryController);
    return yield* interruptThreadTurn(input).pipe(
      Effect.ensuring(
        Option.match(controller, {
          onNone: () => Effect.void,
          onSome: (value) =>
            value
              .reconcilePendingWork(supervisor.target.environmentId, input.threadId)
              .pipe(Effect.forkDetach, Effect.asVoid),
        }),
      ),
    );
  });

  const commands = {
    create: createEnvironmentCommand(runtime, {
      label: "environment-data:commands:thread:create",
      execute: createThread,
      scheduler,
      concurrency,
    }),
    delete: createEnvironmentCommand(runtime, {
      label: "environment-data:commands:thread:delete",
      execute: deleteThread,
      scheduler,
      concurrency,
    }),
    promoteSideChat: createEnvironmentCommand(runtime, {
      label: "environment-data:commands:thread:promote-side-chat",
      execute: promoteSideChat,
      scheduler,
      concurrency,
    }),
    archive: createEnvironmentCommand(runtime, {
      label: "environment-data:commands:thread:archive",
      execute: archiveThread,
      scheduler,
      concurrency,
    }),
    unarchive: createEnvironmentCommand(runtime, {
      label: "environment-data:commands:thread:unarchive",
      execute: unarchiveThread,
      scheduler,
      concurrency,
    }),
    markDone: createEnvironmentCommand(runtime, {
      label: "environment-data:commands:thread:mark-done",
      execute: markThreadDone,
      scheduler,
      concurrency,
    }),
    reopen: createEnvironmentCommand(runtime, {
      label: "environment-data:commands:thread:reopen",
      execute: reopenThread,
      scheduler,
      concurrency,
    }),
    snooze: createEnvironmentCommand(runtime, {
      label: "environment-data:commands:thread:snooze",
      execute: snoozeThread,
      scheduler,
      concurrency,
    }),
    unsnooze: createEnvironmentCommand(runtime, {
      label: "environment-data:commands:thread:unsnooze",
      execute: unsnoozeThread,
      scheduler,
      concurrency,
    }),
    pin: createEnvironmentCommand(runtime, {
      label: "environment-data:commands:thread:pin",
      execute: pinThread,
      scheduler,
      concurrency,
    }),
    unpin: createEnvironmentCommand(runtime, {
      label: "environment-data:commands:thread:unpin",
      execute: unpinThread,
      scheduler,
      concurrency,
    }),
    pinMessage: createEnvironmentCommand(runtime, {
      label: "environment-data:commands:thread:pin-message",
      execute: pinThreadMessage,
      scheduler,
      concurrency,
    }),
    unpinMessage: createEnvironmentCommand(runtime, {
      label: "environment-data:commands:thread:unpin-message",
      execute: unpinThreadMessage,
      scheduler,
      concurrency,
    }),
    reorderPin: createEnvironmentCommand(runtime, {
      label: "environment-data:commands:thread:reorder-pin",
      execute: reorderPinnedThread,
      scheduler,
      concurrency,
    }),
    setAutoMarkDone: createEnvironmentCommand(runtime, {
      label: "environment-data:commands:thread:set-auto-mark-done",
      execute: setThreadAutoMarkDone,
      scheduler,
      concurrency,
    }),
    reorderActive: createEnvironmentCommand(runtime, {
      label: "environment-data:commands:thread:reorder-active",
      execute: reorderActiveThread,
      scheduler,
      concurrency,
    }),
    visit: createEnvironmentCommand(runtime, {
      label: "environment-data:commands:thread:visit",
      execute: visitThread,
      scheduler,
      concurrency,
    }),
    markUnread: createEnvironmentCommand(runtime, {
      label: "environment-data:commands:thread:mark-unread",
      execute: markThreadUnread,
      scheduler,
      concurrency,
    }),
    updateMetadata: createEnvironmentCommand(runtime, {
      label: "environment-data:commands:thread:update-metadata",
      execute: updateThreadMetadata,
      scheduler,
      concurrency,
    }),
    linkPullRequest: createEnvironmentCommand(runtime, {
      label: "environment-data:commands:thread:link-pull-request",
      execute: linkThreadPullRequest,
      scheduler,
      concurrency,
    }),
    unlinkPullRequest: createEnvironmentCommand(runtime, {
      label: "environment-data:commands:thread:unlink-pull-request",
      execute: unlinkThreadPullRequest,
      scheduler,
      concurrency,
    }),
    watchPullRequest: createEnvironmentCommand(runtime, {
      label: "environment-data:commands:thread:watch-pull-request",
      execute: watchThreadPullRequest,
      scheduler,
      concurrency,
    }),
    setModelSelection: createEnvironmentCommand(runtime, {
      label: "environment-data:commands:thread:set-model-selection",
      execute: (input: UpdateThreadMetadataInput & { readonly modelSelection: ModelSelection }) =>
        updateThreadMetadata(input),
      scheduler,
      concurrency,
    }),
    setRuntimeMode: createEnvironmentCommand(runtime, {
      label: "environment-data:commands:thread:set-runtime-mode",
      execute: setThreadRuntimeMode,
      scheduler,
      concurrency,
    }),
    setInteractionMode: createEnvironmentCommand(runtime, {
      label: "environment-data:commands:thread:set-interaction-mode",
      execute: setThreadInteractionMode,
      scheduler,
      concurrency,
    }),
    startTurn: createEnvironmentCommand(runtime, {
      label: "environment-data:commands:thread:start-turn",
      execute: startThreadTurn,
      scheduler,
      concurrency,
    }),
    interruptTurn: createEnvironmentCommand(runtime, {
      label: "environment-data:commands:thread:interrupt-turn",
      execute: interruptTurn,
      scheduler,
      concurrency,
    }),
    respondToApproval: createEnvironmentCommand(runtime, {
      label: "environment-data:commands:thread:respond-to-approval",
      execute: respondToThreadApproval,
      scheduler,
      concurrency,
    }),
    respondToUserInput: createEnvironmentCommand(runtime, {
      label: "environment-data:commands:thread:respond-to-user-input",
      execute: respondToThreadUserInput,
      scheduler,
      concurrency,
    }),
    dismissUserInput: createEnvironmentCommand(runtime, {
      label: "environment-data:commands:thread:dismiss-user-input",
      execute: dismissThreadUserInput,
      scheduler,
      concurrency,
    }),
    pauseUserInputAutoDismiss: createEnvironmentRpcCommand<
      R | SecureRandom.SecureRandom,
      E,
      typeof ORCHESTRATION_V2_WS_METHODS.dispatchCommand,
      Extract<OrchestrationV2Command, { type: "thread.user-input.auto-dismiss.pause" }>
    >(runtime, {
      label: "environment-data:commands:thread:set-user-input-auto-dismiss",
      tag: ORCHESTRATION_V2_WS_METHODS.dispatchCommand,
      scheduler,
      concurrency,
    }),
    revertCheckpoint: createEnvironmentCommand(runtime, {
      label: "environment-data:commands:thread:revert-checkpoint",
      execute: revertThreadCheckpoint,
      scheduler,
      concurrency,
    }),
    stopSession: createEnvironmentCommand(runtime, {
      label: "environment-data:commands:thread:stop-session",
      execute: stopThreadSession,
      scheduler,
      concurrency,
    }),
    forkFromRun: createEnvironmentCommand(runtime, {
      label: "environment-data:commands:thread:fork-from-run",
      execute: forkThreadFromRun,
      scheduler,
      concurrency: {
        mode: "serial",
        key: ({ environmentId, input }) => JSON.stringify([environmentId, input.sourceThreadId]),
      },
    }),
    forkSideChat: createEnvironmentCommand(runtime, {
      label: "environment-data:commands:thread:fork-side-chat",
      execute: forkSideChat,
      scheduler,
      concurrency: {
        mode: "serial",
        key: ({ environmentId, input }) => JSON.stringify([environmentId, input.sourceThreadId]),
      },
    }),
    mergeBack: createEnvironmentCommand(runtime, {
      label: "environment-data:commands:thread:merge-back",
      execute: mergeThreadBack,
      scheduler,
      concurrency: {
        mode: "serial",
        key: ({ environmentId, input }) =>
          JSON.stringify([environmentId, input.sourceThreadId, input.targetThreadId]),
      },
    }),
    resumeThreadQueue: createEnvironmentCommand(runtime, {
      label: "environment-data:commands:thread:resume-queue",
      execute: resumeThreadQueue,
      scheduler,
      concurrency,
    }),
    promoteQueuedRun: createEnvironmentCommand(runtime, {
      label: "environment-data:commands:thread:promote-queued-run",
      execute: promoteQueuedRun,
      scheduler,
      concurrency,
    }),
    cancelQueuedRun: createEnvironmentCommand(runtime, {
      label: "environment-data:commands:thread:cancel-queued-run",
      execute: cancelQueuedRun,
      scheduler,
      concurrency,
    }),
    retryWorkspacePreparation: createEnvironmentCommand(runtime, {
      label: "environment-data:commands:thread:retry-workspace-preparation",
      execute: retryWorkspacePreparation,
      scheduler,
      concurrency,
    }),
    editQueuedRun: createEnvironmentCommand(runtime, {
      label: "environment-data:commands:thread:edit-queued-run",
      execute: editQueuedRun,
      scheduler,
      concurrency,
    }),
    loadEarlierHistory: createEnvironmentCommand(runtime, {
      label: "environment-data:commands:thread:load-earlier-history",
      execute: loadEarlierHistory,
      scheduler,
      concurrency: {
        mode: "serial",
        key: ({ environmentId, input }) =>
          `history:${JSON.stringify([environmentId, input.threadId])}`,
      },
    }),
    uploadFeedback: createEnvironmentRpcCommand(runtime, {
      label: "environment-data:commands:thread:upload-feedback",
      tag: WS_METHODS.providerUploadFeedback,
      scheduler,
      concurrency,
    }),
  };
  const optimistic = createOptimisticThreadLifecycle(snapshotAtom);
  const creation = createOptimisticThreadCreation(optimistic.snapshotAtom);
  return {
    ...commands,
    snapshotAtom: optimistic.snapshotAtom,
    pendingThreadIdsAtom: optimistic.pendingThreadIdsAtom,
    sidebarSnapshotAtom: creation.snapshotAtom,
    startTurn: creation.wrap(commands.startTurn),
    markDone: optimistic.wrap(commands.markDone, (thread, _input, now, accepted) =>
      !accepted &&
      (thread.pendingRuntimeRequest !== null ||
        isOrchestrationV2RunUnsettled(thread.activityRunStatus ?? thread.status))
        ? thread
        : {
            ...thread,
            pendingRuntimeRequest: null,
            doneOverride: "done",
            doneAt: thread.doneOverride === "done" ? (thread.doneAt ?? now) : now,
            reopenedAt: null,
            activeOrderKey: null,
            pinnedAt: null,
            pinOrderKey: null,
            snoozedAt: null,
            snoozedUntil: null,
          },
    ),
    reopen: optimistic.wrap(commands.reopen, (thread, input, now) => ({
      ...thread,
      doneOverride: input.reason === "user" ? "active" : null,
      doneAt: null,
      reopenedAt: thread.doneOverride === "active" ? (thread.reopenedAt ?? null) : now,
    })),
    snooze: optimistic.wrap(commands.snooze, (thread, input, now, accepted) =>
      (!accepted &&
        ((thread.pendingRuntimeRequest !== null &&
          thread.pendingRuntimeRequest.kind !== "user_input") ||
          isOrchestrationV2RunNotYetRunning(thread.status))) ||
      !(Date.parse(input.snoozedUntil) > DateTime.toEpochMillis(now))
        ? thread
        : {
            ...thread,
            snoozedUntil: DateTime.makeUnsafe(input.snoozedUntil),
            snoozedAt: now,
          },
    ),
    unsnooze: optimistic.wrap(commands.unsnooze, (thread) => ({
      ...thread,
      snoozedUntil: null,
      snoozedAt: null,
    })),
    setAutoMarkDone: optimistic.wrap(commands.setAutoMarkDone, (thread, input, now) => ({
      ...thread,
      autoMarkDoneDisabledAt: input.enabled ? null : (thread.autoMarkDoneDisabledAt ?? now),
    })),
    pin: optimistic.wrap(commands.pin, (thread, input, now) => ({
      ...thread,
      pinnedAt: thread.pinnedAt ?? now,
      pinOrderKey: thread.pinnedAt == null ? (input.orderKey ?? null) : thread.pinOrderKey,
      ...(thread.doneOverride === "done"
        ? {
            doneOverride: "active" as const,
            doneAt: null,
            reopenedAt: now,
          }
        : {}),
      snoozedUntil: null,
      snoozedAt: null,
    })),
    unpin: optimistic.wrap(commands.unpin, (thread) => ({
      ...thread,
      pinnedAt: null,
      pinOrderKey: null,
    })),
    reorderPin: optimistic.wrap(commands.reorderPin, (thread, input) => ({
      ...thread,
      pinOrderKey: input.orderKey,
    })),
    reorderActive: optimistic.wrap(commands.reorderActive, (thread, input) => ({
      ...thread,
      activeOrderKey: input.orderKey,
    })),
    // Shown at once, so a composer that releases its accepted pick keeps showing it.
    setModelSelection: optimistic.wrap(commands.setModelSelection, (thread, input) => ({
      ...thread,
      modelSelection: input.modelSelection,
    })),
  };
}
