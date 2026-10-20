import {
  parseScopedThreadKey,
  scopeProjectRef,
  scopeThreadRef,
  scopedThreadKey,
} from "@supaterm/client-runtime/environment";
import { settlePromise, squashAtomCommandFailure } from "@supaterm/client-runtime/state/runtime";
import {
  canSnooze,
  effectiveSnoozed,
  threadWokeAt,
} from "@supaterm/client-runtime/state/thread-snooze";
import { threadRuntimeCanArchive } from "@supaterm/client-runtime/state/models";
import {
  AuthOrchestrationOperateScope,
  AuthSourceControlWriteScope,
  EnvironmentAuthorizationError,
  EnvironmentId,
  type ScopedThreadRef,
  ThreadId,
  sessionGrantsScope,
} from "@supaterm/contracts";
import { resolveWorktreeCleanup } from "@supaterm/shared/projectSettings";
import * as Cause from "effect/Cause";
import * as Schema from "effect/Schema";
import { AsyncResult } from "effect/reactivity";
import { useRouter } from "@tanstack/react-router";

import { getFallbackThreadIdAfterDelete, pinOrderKeyBetween } from "../components/Sidebar.logic";
import { useComposerDraftStore } from "../composerDraftStore";
import { environmentSession, readEnvironmentScope } from "../state/session";

import { appAtomRegistry } from "../rpc/atomRegistry";
import { environmentServerConfigsAtom } from "../state/server";
import { isScratchProject } from "@supaterm/client-runtime/state/projects";
import { threadEnvironment } from "../state/threads";
import { vcsEnvironment } from "../state/vcs";
import { useNewThreadHandler } from "./useHandleNewThread";
import { refreshArchivedThreadsForEnvironment } from "../lib/archivedThreadsState";
import { releaseComposerDraftUploads } from "../lib/composerDraftUploads";
import { readLocalApi } from "../localApi";
import {
  readEnvironmentThreadRefs,
  readProject,
  readThreadShell,
  readThreadShells,
} from "../state/entities";
import { clearThreadPreviewState } from "../previewStateStore";
import { useTerminalUiStateStore } from "../terminalUiStateStore";
import { buildThreadRouteParams, resolveThreadRouteRef } from "../threadRoutes";
import { formatWorktreePathForDisplay, getOrphanedWorktreePathForThread } from "../worktreeCleanup";
import { stackedThreadToast, toastManager } from "../components/ui/toast";
import { useClientSettings } from "./useSettings";
import * as ThreadUndo from "./threadUndo";
import { showThreadUndoNotice } from "./showThreadUndoNotice";
import { useAtomCommand } from "../state/use-atom-command";
import { useOrchestrationCommand } from "../state/use-orchestration-command";
import { useAtomQueryRunner } from "../state/use-atom-query-runner";
import { closePaneShowingThread } from "../chatPanes/store";

export class ThreadArchiveBlockedError extends Schema.TaggedError<ThreadArchiveBlockedError>()(
  "ThreadArchiveBlockedError",
  {
    environmentId: EnvironmentId,
    threadId: ThreadId,
  },
) {
  override get message(): string {
    return "Cannot archive while the provider is active.";
  }
}

export class ThreadSnoozeBlockedError extends Schema.TaggedError<ThreadSnoozeBlockedError>()(
  "ThreadSnoozeBlockedError",
  {
    environmentId: EnvironmentId,
    threadId: ThreadId,
  },
) {
  override get message(): string {
    return "This thread is waiting on you. Respond to the pending request before snoozing it.";
  }
}

function topOfPinnedRunOrderKey(): string | undefined {
  let firstKey: string | null = null;
  for (const shell of readThreadShells()) {
    if (shell.pinnedAt == null || shell.pinOrderKey == null) continue;
    if (firstKey === null || shell.pinOrderKey < firstKey) firstKey = shell.pinOrderKey;
  }
  return pinOrderKeyBetween(null, firstKey) ?? undefined;
}

export async function requestThreadUnpinConfirmation(input: {
  enabled: boolean;
  title: string;
  confirm: ((message: string) => Promise<boolean>) | null;
}) {
  const { confirm } = input;
  if (!input.enabled || confirm === null) {
    return AsyncResult.success(true);
  }

  return settlePromise(() =>
    confirm(
      [
        `Unpin thread "${input.title}"?`,
        "This will move the thread out of your pinned section.",
      ].join("\n"),
    ),
  );
}

export async function navigateAfterThreadDeletion(navigate: () => Promise<void>) {
  const result = await settlePromise(navigate);
  if (result._tag === "Failure") {
    const error = squashAtomCommandFailure(result);
    toastManager.add(
      stackedThreadToast({
        type: "error",
        title: "Thread deleted, but navigation failed",
        description: error instanceof Error ? error.message : "An error occurred.",
      }),
    );
  }
}

/**
 * Marks a thread unread. thread.mark-unread rewinds the server-side visited
 * watermark, syncing the marker to every device.
 */
function useMarkThreadUnread() {
  const markThreadUnreadMutation = useAtomCommand(threadEnvironment.markUnread, {
    reportFailure: false,
  });
  return (target: ScopedThreadRef) => {
    void markThreadUnreadMutation({
      environmentId: target.environmentId,
      input: { threadId: target.threadId },
    });
  };
}

/**
 * Clears a thread's Woke marker by recording a visit at the wake time.
 * thread.visit keeps the later of the stored and supplied values, so this
 * syncs to every device.
 */
export function useAcknowledgeThreadWoke() {
  const visitThreadMutation = useAtomCommand(threadEnvironment.visit, { reportFailure: false });
  return (target: ScopedThreadRef, wokeAt: string) => {
    void visitThreadMutation({
      environmentId: target.environmentId,
      input: { threadId: target.threadId, visitedAt: wokeAt },
    });
  };
}

function threadOperationFailure(target: ScopedThreadRef) {
  return readEnvironmentScope(target.environmentId, AuthOrchestrationOperateScope)
    ? null
    : AsyncResult.failure(
        Cause.fail(
          new EnvironmentAuthorizationError({
            message: "This connection cannot change threads.",
            requiredScope: AuthOrchestrationOperateScope,
          }),
        ),
      );
}

export function useThreadActions() {
  const archiveThreadMutation = useOrchestrationCommand(threadEnvironment.archive, {
    reportFailure: false,
  });
  const unarchiveThreadMutation = useOrchestrationCommand(threadEnvironment.unarchive, {
    reportFailure: false,
  });
  const deleteThreadMutation = useOrchestrationCommand(threadEnvironment.delete, {
    reportFailure: false,
  });
  const markThreadDoneMutation = useOrchestrationCommand(threadEnvironment.markDone, {
    reportFailure: false,
  });
  const reopenThreadMutation = useOrchestrationCommand(threadEnvironment.reopen, {
    reportFailure: false,
  });
  const pinThreadMutation = useOrchestrationCommand(threadEnvironment.pin, {
    reportFailure: false,
  });
  const unpinThreadMutation = useOrchestrationCommand(threadEnvironment.unpin, {
    reportFailure: false,
  });
  const setThreadAutoMarkDoneMutation = useOrchestrationCommand(threadEnvironment.setAutoMarkDone, {
    reportFailure: false,
  });
  const reorderPinnedThreadMutation = useOrchestrationCommand(threadEnvironment.reorderPin, {
    reportFailure: false,
  });
  const snoozeThreadMutation = useOrchestrationCommand(threadEnvironment.snooze, {
    reportFailure: false,
  });
  const unsnoozeThreadMutation = useOrchestrationCommand(threadEnvironment.unsnooze, {
    reportFailure: false,
  });
  const markThreadUnread = useMarkThreadUnread();
  const stopThreadSession = useOrchestrationCommand(threadEnvironment.stopSession);
  const removeWorktree = useAtomCommand(vcsEnvironment.removeWorktree, {
    reportFailure: false,
  });
  const loadSessionState = useAtomQueryRunner(environmentSession.sessionStateAtom, {
    reportFailure: false,
  });
  const refreshVcsStatus = useAtomCommand(vcsEnvironment.refreshStatus, {
    reportFailure: false,
  });
  const sidebarThreadSortOrder = useClientSettings((settings) => settings.sidebarThreadSortOrder);
  const confirmThreadDelete = useClientSettings((settings) => settings.confirmThreadDelete);
  const confirmThreadUnpin = useClientSettings((settings) => settings.confirmThreadUnpin);
  const clearComposerDraftForThread = useComposerDraftStore((store) => store.clearDraftThread);
  const clearProjectDraftThreadById = useComposerDraftStore(
    (store) => store.clearProjectDraftThreadById,
  );
  const clearTerminalUiState = useTerminalUiStateStore((state) => state.clearTerminalUiState);
  const acknowledgeThreadWoke = useAcknowledgeThreadWoke();
  const router = useRouter();
  const handleNewThread = useNewThreadHandler();

  const resolveThreadTarget = (target: ScopedThreadRef) => {
    const thread = readThreadShell(target);
    if (!thread) {
      return null;
    }
    return {
      thread,
      threadRef: target,
    };
  };
  const getCurrentRouteThreadRef = () => {
    const currentRouteParams = router.state.matches[router.state.matches.length - 1]?.params ?? {};
    return resolveThreadRouteRef(currentRouteParams);
  };

  const unarchiveThread = async (target: ScopedThreadRef, opts: { navigate?: boolean } = {}) => {
    ThreadUndo.invalidate("archive", scopedThreadKey(target));
    const result = await unarchiveThreadMutation({
      environmentId: target.environmentId,
      input: { threadId: target.threadId },
    });
    if (result._tag === "Failure") {
      return result;
    }
    refreshArchivedThreadsForEnvironment(target.environmentId);
    if (opts.navigate) {
      return settlePromise(() =>
        router.navigate({
          to: "/$environmentId/$threadId",
          params: buildThreadRouteParams(target),
        }),
      );
    }
    return result;
  };

  const archiveThread = async (target: ScopedThreadRef, opts: { onArchived?: () => void } = {}) => {
    const resolved = resolveThreadTarget(target);
    if (!resolved) return AsyncResult.success(undefined);
    const { thread, threadRef } = resolved;
    if (!threadRuntimeCanArchive(thread.runtime)) {
      return AsyncResult.failure(
        Cause.fail(
          new ThreadArchiveBlockedError({
            environmentId: threadRef.environmentId,
            threadId: threadRef.threadId,
          }),
        ),
      );
    }

    const currentRouteThreadRef = getCurrentRouteThreadRef();
    const shouldNavigateToDraft =
      currentRouteThreadRef?.threadId === threadRef.threadId &&
      currentRouteThreadRef.environmentId === threadRef.environmentId;
    const action = ThreadUndo.begin("archive", scopedThreadKey(threadRef));
    const archiveResult = await archiveThreadMutation({
      environmentId: threadRef.environmentId,
      input: { threadId: threadRef.threadId },
    });
    if (archiveResult._tag === "Failure") {
      action.finish();
      return archiveResult;
    }
    const wokeAt = threadWokeAt(thread, { now: new Date().toISOString() });
    if (wokeAt !== null) {
      acknowledgeThreadWoke(threadRef, wokeAt);
    }
    refreshArchivedThreadsForEnvironment(threadRef.environmentId);
    opts.onArchived?.();
    showThreadUndoNotice({
      action: "Archived",
      claim: action,
      undo: () => unarchiveThread(threadRef, { navigate: shouldNavigateToDraft }),
      failureTitle: "Failed to undo archive",
    });

    // The focused pane takes a new draft as before; a pane in the background just closes.
    closePaneShowingThread(threadRef, { remember: true, onlyInBackground: true });
    if (shouldNavigateToDraft) {
      const navigationResult = await settlePromise(() =>
        handleNewThread(scopeProjectRef(thread.environmentId, thread.projectId)),
      );
      if (navigationResult._tag === "Failure") {
        return navigationResult;
      }
      return archiveResult;
    }

    return archiveResult;
  };

  const deleteThread = async (
    target: ScopedThreadRef,
    opts: { deletedThreadKeys?: ReadonlySet<string> } = {},
  ) => {
    const permissionFailure = threadOperationFailure(target);
    if (permissionFailure) return permissionFailure;
    const resolved = resolveThreadTarget(target);
    if (!resolved) {
      const result = await deleteThreadMutation({
        environmentId: target.environmentId,
        input: { threadId: target.threadId },
      });
      if (result._tag === "Success") {
        refreshArchivedThreadsForEnvironment(target.environmentId);
        clearThreadPreviewState(target);
      }
      return result;
    }
    const { thread, threadRef } = resolved;
    const threads = readEnvironmentThreadRefs(threadRef.environmentId).flatMap((ref) => {
      const shell = readThreadShell(ref);
      return shell === null ? [] : [shell];
    });
    const threadProject = readProject({
      environmentId: threadRef.environmentId,
      projectId: thread.projectId,
    });
    const deletedIds =
      opts.deletedThreadKeys && opts.deletedThreadKeys.size > 0
        ? new Set<ThreadId>(
            [...opts.deletedThreadKeys].flatMap((threadKey) => {
              const ref = parseScopedThreadKey(threadKey);
              return ref && ref.environmentId === threadRef.environmentId ? [ref.threadId] : [];
            }),
          )
        : undefined;
    const survivingThreads =
      deletedIds && deletedIds.size > 0
        ? threads.filter((entry) => entry.id === threadRef.threadId || !deletedIds.has(entry.id))
        : threads;
    const orphanedWorktreePath = getOrphanedWorktreePathForThread(
      survivingThreads,
      threadRef.threadId,
    );
    const displayWorktreePath = orphanedWorktreePath
      ? formatWorktreePathForDisplay(orphanedWorktreePath)
      : null;
    const environmentConfig = appAtomRegistry
      .get(environmentServerConfigsAtom)
      .get(threadRef.environmentId);
    const localApi = readLocalApi();
    let canDeleteWorktree = false;
    if (
      orphanedWorktreePath !== null &&
      threadProject !== null &&
      !isScratchProject(threadProject, environmentConfig?.scratchWorkspaceRoot) &&
      localApi
    ) {
      const sessionResult = await loadSessionState(threadRef.environmentId);
      const permissionFailure = threadOperationFailure(threadRef);
      if (permissionFailure) return permissionFailure;
      canDeleteWorktree =
        sessionResult._tag === "Success" &&
        sessionGrantsScope(sessionResult.value, AuthSourceControlWriteScope);
    }
    let shouldDeleteWorktree = false;
    const environmentSettings = environmentConfig?.settings;
    const automaticWorktreeCleanup = environmentSettings
      ? resolveWorktreeCleanup(environmentSettings, thread.projectId).worktreeOnDelete
      : false;
    if (canDeleteWorktree && localApi && !automaticWorktreeCleanup) {
      const confirmationResult = await settlePromise(() =>
        localApi.dialogs.confirm(
          [
            "This thread is the only one linked to this worktree:",
            displayWorktreePath ?? orphanedWorktreePath,
            "",
            "Delete the worktree too?",
          ].join("\n"),
          { variant: "destructive" },
        ),
      );
      if (confirmationResult._tag === "Failure") {
        return confirmationResult;
      }
      shouldDeleteWorktree = confirmationResult.value;
    }

    if (thread.runtime !== null) {
      await stopThreadSession({
        environmentId: threadRef.environmentId,
        input: { threadId: threadRef.threadId },
      });
    }

    const deletedThreadIds = deletedIds ?? new Set<ThreadId>();
    const currentRouteThreadRef = getCurrentRouteThreadRef();
    const shouldNavigateToFallback =
      currentRouteThreadRef?.threadId === threadRef.threadId &&
      currentRouteThreadRef.environmentId === threadRef.environmentId;
    const fallbackThreadId = getFallbackThreadIdAfterDelete({
      threads,
      deletedThreadId: threadRef.threadId,
      deletedThreadIds,
      sortOrder: sidebarThreadSortOrder,
    });
    const deleteResult = await deleteThreadMutation({
      environmentId: threadRef.environmentId,
      input: { threadId: threadRef.threadId },
    });
    if (deleteResult._tag === "Failure") {
      return deleteResult;
    }
    refreshArchivedThreadsForEnvironment(threadRef.environmentId);
    releaseComposerDraftUploads(threadRef);
    clearComposerDraftForThread(threadRef);
    clearProjectDraftThreadById(
      scopeProjectRef(threadRef.environmentId, thread.projectId),
      threadRef,
    );
    clearTerminalUiState(threadRef);
    clearThreadPreviewState(threadRef);

    const closedPane = closePaneShowingThread(threadRef, { remember: false });
    if (shouldNavigateToFallback && !closedPane) {
      const fallbackThread = fallbackThreadId
        ? readThreadShell(scopeThreadRef(threadRef.environmentId, fallbackThreadId))
        : null;
      await navigateAfterThreadDeletion(() =>
        fallbackThread
          ? router.navigate({
              to: "/$environmentId/$threadId",
              params: buildThreadRouteParams(
                scopeThreadRef(fallbackThread.environmentId, fallbackThread.id),
              ),
              replace: true,
            })
          : router.navigate({ to: "/", replace: true }),
      );
    }

    if (!shouldDeleteWorktree || !orphanedWorktreePath || !threadProject) {
      return deleteResult;
    }

    const removeResult = readEnvironmentScope(threadRef.environmentId, AuthSourceControlWriteScope)
      ? await removeWorktree({
          environmentId: threadRef.environmentId,
          input: {
            cwd: threadProject.workspaceRoot,
            path: orphanedWorktreePath,
            force: true,
          },
        })
      : AsyncResult.failure(
          Cause.fail(
            new EnvironmentAuthorizationError({
              message: "This connection can no longer remove worktrees.",
              requiredScope: AuthSourceControlWriteScope,
            }),
          ),
        );
    const refreshResult =
      removeResult._tag === "Success"
        ? await refreshVcsStatus({
            environmentId: threadRef.environmentId,
            input: { cwd: threadProject.workspaceRoot },
          })
        : null;
    const cleanupFailure =
      removeResult._tag === "Failure"
        ? removeResult
        : refreshResult?._tag === "Failure"
          ? refreshResult
          : null;
    if (cleanupFailure) {
      const removalFailed = removeResult._tag === "Failure";
      const error = squashAtomCommandFailure(cleanupFailure);
      const message = error instanceof Error ? error.message : "An error occurred.";
      console.error("Worktree cleanup failed after thread deletion", {
        threadId: threadRef.threadId,
        projectCwd: threadProject.workspaceRoot,
        worktreePath: orphanedWorktreePath,
        error,
      });
      toastManager.add(
        stackedThreadToast({
          type: "error",
          title: removalFailed
            ? "Failed to delete worktree"
            : "Worktree deleted, but Git status refresh failed",
          description: removalFailed
            ? `Could not remove ${displayWorktreePath ?? orphanedWorktreePath}. ${message}`
            : message,
        }),
      );
      // The thread was deleted. Cleanup has its own toast; returning its
      // failure would make callers incorrectly report a thread deletion error.
    }
    return deleteResult;
  };

  const reopenThread = async (target: ScopedThreadRef) => {
    ThreadUndo.invalidate("mark-done", scopedThreadKey(target));
    // reason "user" pins the thread active: auto-mark-done (PR merged /
    // inactivity) stays suppressed until real activity clears the pin.
    return reopenThreadMutation({
      environmentId: target.environmentId,
      input: { threadId: target.threadId, reason: "user" },
    });
  };

  /** Turns automatic completion (inactivity, merged PR) on or off for one thread. */
  const setThreadAutoMarkDone = async (target: ScopedThreadRef, enabled: boolean) => {
    return setThreadAutoMarkDoneMutation({
      environmentId: target.environmentId,
      input: { threadId: target.threadId, enabled },
    });
  };

  const pinThread = async (target: ScopedThreadRef, opts: { orderKey?: string } = {}) => {
    // Every pin path places the thread at the top of the arranged run:
    // callers with a better anchor (the sidebar, which knows the displayed
    // order) pass their own key; everyone else (chat header, context menus)
    // gets the default so the same action never places differently.
    const orderKey = opts.orderKey ?? topOfPinnedRunOrderKey();
    ThreadUndo.invalidate("pin", scopedThreadKey(target));
    return pinThreadMutation({
      environmentId: target.environmentId,
      input: { threadId: target.threadId, ...(orderKey !== undefined ? { orderKey } : {}) },
    });
  };

  const unpinThread = async (target: ScopedThreadRef) => {
    const thread = readThreadShell(target);
    const orderKey = thread?.pinOrderKey ?? undefined;
    const action = ThreadUndo.begin("pin", scopedThreadKey(target));
    const result = await unpinThreadMutation({
      environmentId: target.environmentId,
      input: { threadId: target.threadId },
    });
    if (result._tag === "Success" && action.isCurrent()) {
      showThreadUndoNotice({
        action: "Unpinned",
        claim: action,
        undo: () => pinThread(target, orderKey === undefined ? {} : { orderKey }),
        failureTitle: "Failed to undo unpin",
      });
    } else {
      action.finish();
    }
    return result;
  };

  const markThreadDone = async (target: ScopedThreadRef) => {
    const resolved = resolveThreadTarget(target);
    const now = new Date().toISOString();
    const wokeAt = resolved ? threadWokeAt(resolved.thread, { now }) : null;
    // Marking done also drops the pin and the snooze server-side, so Undo
    // has to put those back as well.
    const pinOrderKey = resolved?.thread.pinnedAt != null ? resolved.thread.pinOrderKey : null;
    const wasPinned = resolved?.thread.pinnedAt != null;
    const wasDone = resolved?.thread.doneOverride === "done";
    const snoozedUntil =
      resolved && effectiveSnoozed(resolved.thread, { now })
        ? (resolved.thread.snoozedUntil ?? null)
        : null;
    // An older unpin/snooze Undo would re-pin or re-snooze, and the server
    // treats either as a promotion that reopens; marking done supersedes them.
    ThreadUndo.invalidate("pin", scopedThreadKey(target));
    ThreadUndo.invalidate("snooze", scopedThreadKey(target));
    const action = ThreadUndo.begin("mark-done", scopedThreadKey(target));
    const result = await markThreadDoneMutation({
      environmentId: target.environmentId,
      input: { threadId: target.threadId },
    });
    if (result._tag !== "Success") {
      action.finish();
      return result;
    }
    if (wokeAt !== null) {
      acknowledgeThreadWoke(target, wokeAt);
    }
    showThreadUndoNotice({
      action: "Done",
      claim: action,
      undo: async () => {
        if (wasDone && snoozedUntil !== null) {
          return snoozeThreadMutation({
            environmentId: target.environmentId,
            input: { threadId: target.threadId, snoozedUntil },
          });
        }
        const reopened = await reopenThread(target);
        if (reopened._tag !== "Success") return reopened;
        if (wasPinned) {
          const pinned = await pinThread(
            target,
            pinOrderKey == null ? {} : { orderKey: pinOrderKey },
          );
          if (pinned._tag !== "Success") return pinned;
        }
        if (snoozedUntil !== null) {
          return snoozeThreadMutation({
            environmentId: target.environmentId,
            input: { threadId: target.threadId, snoozedUntil },
          });
        }
        return reopened;
      },
      failureTitle: "Failed to undo marking as Done",
    });
    return result;
  };

  const confirmAndUnpinThread = async (target: ScopedThreadRef) => {
    const permissionFailure = threadOperationFailure(target);
    if (permissionFailure) return permissionFailure;
    const localApi = readLocalApi();
    const resolved = resolveThreadTarget(target);
    const confirmationResult = await requestThreadUnpinConfirmation({
      enabled: confirmThreadUnpin,
      title: resolved?.thread.title ?? "this thread",
      confirm: localApi ? (message) => localApi.dialogs.confirm(message) : null,
    });
    if (confirmationResult._tag === "Failure") {
      return confirmationResult;
    }
    if (!confirmationResult.value) {
      return AsyncResult.success(undefined);
    }
    return unpinThread(target);
  };

  const reorderPinnedThread = async (target: ScopedThreadRef, orderKey: string) => {
    ThreadUndo.invalidate("pin", scopedThreadKey(target));
    return reorderPinnedThreadMutation({
      environmentId: target.environmentId,
      input: { threadId: target.threadId, orderKey },
    });
  };

  const unsnoozeThread = async (target: ScopedThreadRef) => {
    ThreadUndo.invalidate("snooze", scopedThreadKey(target));
    return unsnoozeThreadMutation({
      environmentId: target.environmentId,
      input: { threadId: target.threadId, reason: "user" },
    });
  };

  const snoozeThread = async (target: ScopedThreadRef, snoozedUntil: string) => {
    const resolved = resolveThreadTarget(target);
    if (resolved && !canSnooze(resolved.thread, { now: new Date().toISOString() })) {
      return AsyncResult.failure(
        Cause.fail(
          new ThreadSnoozeBlockedError({
            environmentId: resolved.threadRef.environmentId,
            threadId: resolved.threadRef.threadId,
          }),
        ),
      );
    }
    const action = ThreadUndo.begin("snooze", scopedThreadKey(target));
    const result = await snoozeThreadMutation({
      environmentId: target.environmentId,
      input: { threadId: target.threadId, snoozedUntil },
    });
    if (result._tag !== "Success") {
      action.finish();
      return result;
    }
    showThreadUndoNotice({
      action: "Snoozed",
      claim: action,
      undo: () => unsnoozeThread(target),
      failureTitle: "Failed to wake thread",
    });
    return result;
  };

  const confirmAndDeleteThread = async (target: ScopedThreadRef) => {
    const permissionFailure = threadOperationFailure(target);
    if (permissionFailure) return permissionFailure;
    const localApi = readLocalApi();
    const resolved = resolveThreadTarget(target);

    if (confirmThreadDelete && localApi) {
      const title = resolved?.thread.title ?? "this thread";
      const confirmationResult = await settlePromise(() =>
        localApi.dialogs.confirm(
          [
            `Delete thread "${title}"?`,
            "This permanently clears conversation history for this thread.",
          ].join("\n"),
          { variant: "destructive" },
        ),
      );
      if (confirmationResult._tag === "Failure") {
        return confirmationResult;
      }
      if (!confirmationResult.value) {
        return AsyncResult.success(undefined);
      }
    }

    return deleteThread(target);
  };

  return {
    archiveThread,
    unarchiveThread,
    deleteThread,
    confirmAndDeleteThread,
    markThreadDone,
    reopenThread,
    snoozeThread,
    unsnoozeThread,
    pinThread,
    unpinThread,
    confirmAndUnpinThread,
    reorderPinnedThread,
    markThreadUnread,
    setThreadAutoMarkDone,
  };
}
