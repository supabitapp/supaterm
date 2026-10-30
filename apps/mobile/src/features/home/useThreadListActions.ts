import type { ThreadMoveDestination } from "../threads/threadOrder";
import type { EnvironmentThreadShell } from "@supaterm/client-runtime/state/shell";
import * as ThreadUndo from "@supaterm/client-runtime/state/thread-undo";
import { showThreadUndoNotice } from "./thread-undo-notice";
import { canSnooze, effectiveSnoozed } from "@supaterm/client-runtime/state/thread-snooze";
import { AuthOrchestrationOperateScope } from "@supaterm/contracts";
import * as Cause from "effect/Cause";
import * as Haptics from "expo-haptics";
import { useRef } from "react";

import { withThreadDismissal } from "./thread-dismissal";
import * as Dialog from "../../components/ui/Dialog";
import { scopedThreadKey } from "../../lib/scopedEntities";
import { refreshArchivedThreadsForEnvironment } from "../archive/useArchivedThreadSnapshots";
import { pinOrderKeyBetween } from "@supaterm/client-runtime/state/thread-sort";
import { appAtomRegistry } from "../../state/atom-registry";
import { environmentServerConfigsAtom } from "../../state/server";
import { readEnvironmentScope } from "../../state/session";
import { environmentThreadShells, threadEnvironment } from "../../state/threads";
import { queuedThreadKeysAtom } from "../../state/use-thread-outbox";
import { useAtomCommand } from "../../state/use-atom-command";
import {
  beginPendingThreadOrder,
  getPendingThreadOrder,
  threadDropBusyAtom,
} from "../../state/thread-order";
import {
  createPendingThreadOrder,
  createThreadMovePlanner,
  threadDropLifecycle,
} from "../threads/threadOrder";
import { getThreadListV2OrderedSection } from "../threads/threadListV2";
import { threadCanArchive } from "./threadArchive";
import { resolveThreadTitleRename } from "../threads/thread-title-rename";

function environmentSupportsMarkDone(environmentId: EnvironmentThreadShell["environmentId"]) {
  return appAtomRegistry.get(environmentServerConfigsAtom).has(environmentId);
}

function environmentSupportsSnooze(environmentId: EnvironmentThreadShell["environmentId"]) {
  return appAtomRegistry.get(environmentServerConfigsAtom).has(environmentId);
}

function environmentSupportsPinning(environmentId: EnvironmentThreadShell["environmentId"]) {
  return appAtomRegistry.get(environmentServerConfigsAtom).has(environmentId);
}

function environmentSupportsPinReorder(environmentId: EnvironmentThreadShell["environmentId"]) {
  return appAtomRegistry.get(environmentServerConfigsAtom).has(environmentId);
}

function environmentSupportsAutoMarkDoneOptOut(
  environmentId: EnvironmentThreadShell["environmentId"],
) {
  return appAtomRegistry.get(environmentServerConfigsAtom).has(environmentId);
}

function environmentSupportsTitleRegeneration(
  environmentId: EnvironmentThreadShell["environmentId"],
) {
  return appAtomRegistry.get(environmentServerConfigsAtom).has(environmentId);
}

type ThreadListAction = "archive" | "unarchive" | "delete" | "mark-done" | "reopen";

const ACTION_VERBS: Record<ThreadListAction, string> = {
  archive: "archived",
  unarchive: "unarchived",
  delete: "deleted",
  "mark-done": "marked as Done",
  reopen: "reopened",
};

function actionFailureMessage(action: ThreadListAction, cause: Cause.Cause<unknown>): string {
  const error = Cause.squash(cause);
  if (error instanceof Error && error.message.trim().length > 0) {
    return error.message;
  }
  return `The thread could not be ${ACTION_VERBS[action]}.`;
}

function selectionHaptic(): void {
  void Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
}

function actionFailureTitle(action: ThreadListAction): string {
  if (action === "archive") return "Could not archive thread";
  if (action === "unarchive") return "Could not unarchive thread";
  if (action === "mark-done") return "Could not mark thread as Done";
  if (action === "reopen") return "Could not reopen thread";
  return "Could not delete thread";
}

function checkThreadOperationPermission(thread: EnvironmentThreadShell, title: string): boolean {
  if (readEnvironmentScope(thread.environmentId, AuthOrchestrationOperateScope)) return true;
  Dialog.alert(title, "This connection cannot change threads.");
  return false;
}

function useThreadActionExecutor(
  onCompleted?: (action: ThreadListAction, thread: EnvironmentThreadShell) => void,
) {
  const archiveMutation = useAtomCommand(threadEnvironment.archive, { reportFailure: false });
  const unarchiveMutation = useAtomCommand(threadEnvironment.unarchive, { reportFailure: false });
  const deleteMutation = useAtomCommand(threadEnvironment.delete, { reportFailure: false });
  const markDoneMutation = useAtomCommand(threadEnvironment.markDone, { reportFailure: false });
  const reopenMutation = useAtomCommand(threadEnvironment.reopen, { reportFailure: false });
  const inFlightThreadKeys = useRef(new Set<string>());

  const executeAction = async (
    action: ThreadListAction,
    thread: EnvironmentThreadShell,
    onStarted?: () => void,
  ) => {
    if (!checkThreadOperationPermission(thread, actionFailureTitle(action))) return false;
    const key = scopedThreadKey(thread.environmentId, thread.id);
    if (inFlightThreadKeys.current.has(key)) {
      return false;
    }

    inFlightThreadKeys.current.add(key);
    selectionHaptic();
    const run = async () => {
      if (
        (action === "mark-done" || action === "reopen") &&
        !environmentSupportsMarkDone(thread.environmentId)
      ) {
        Dialog.alert(
          actionFailureTitle(action),
          "This environment is still connecting. Try again once it is connected.",
        );
        return false;
      }
      if (action === "archive" && !threadCanArchive(thread.runtime)) {
        Dialog.alert(
          actionFailureTitle(action),
          "This thread is working. Interrupt it first, then try again.",
        );
        return false;
      }
      if (action === "reopen") ThreadUndo.invalidate("mark-done", key);
      if (action === "archive" || action === "delete") {
        for (const kind of ["mark-done", "snooze", "pin"]) ThreadUndo.invalidate(kind, key);
      }
      onStarted?.();
      const result = await withThreadDismissal(
        key,
        async () =>
          action === "reopen"
            ? await reopenMutation({
                environmentId: thread.environmentId,
                input: { threadId: thread.id, reason: "user" },
              })
            : await (
                action === "mark-done"
                  ? markDoneMutation
                  : action === "archive"
                    ? archiveMutation
                    : action === "unarchive"
                      ? unarchiveMutation
                      : deleteMutation
              )({
                environmentId: thread.environmentId,
                input: { threadId: thread.id },
              }),
        (result) => result._tag === "Success",
      );
      if (result._tag === "Failure") {
        Dialog.alert(actionFailureTitle(action), actionFailureMessage(action, result.cause));
        return false;
      }

      if (action === "archive" || action === "unarchive" || action === "delete") {
        refreshArchivedThreadsForEnvironment(thread.environmentId);
      }
      onCompleted?.(action, thread);
      return true;
    };
    return run().finally(() => {
      inFlightThreadKeys.current.delete(key);
    });
  };

  return executeAction;
}

function createDeleteThreadConfirmation(
  executeAction: (action: ThreadListAction, thread: EnvironmentThreadShell) => Promise<boolean>,
) {
  return (thread: EnvironmentThreadShell) => {
    if (!checkThreadOperationPermission(thread, actionFailureTitle("delete"))) return;
    const title = "Delete thread?";
    const message = `“${thread.title}” will be permanently deleted, including its terminal history.`;
    Dialog.confirm({
      title,
      message,
      confirmText: "Delete",
      destructive: true,
      onConfirm: () => {
        void executeAction("delete", thread);
      },
    });
  };
}

export function useThreadListActions(): {
  readonly archiveThread: (thread: EnvironmentThreadShell) => Promise<boolean>;
  readonly confirmDeleteThread: (thread: EnvironmentThreadShell) => void;
  readonly markThreadDone: (thread: EnvironmentThreadShell) => Promise<boolean>;
  readonly snoozeThread: (thread: EnvironmentThreadShell, snoozedUntil: string) => Promise<boolean>;
  readonly unsnoozeThread: (thread: EnvironmentThreadShell) => Promise<boolean>;
  readonly reopenThread: (thread: EnvironmentThreadShell) => Promise<boolean>;
  readonly pinThread: (thread: EnvironmentThreadShell) => Promise<boolean>;
  readonly unpinThread: (thread: EnvironmentThreadShell) => Promise<boolean>;

  readonly setThreadAutoMarkDone: (
    thread: EnvironmentThreadShell,
    enabled: boolean,
  ) => Promise<boolean>;
  readonly moveThread: (
    thread: EnvironmentThreadShell,
    direction: ThreadMoveDestination,
  ) => Promise<boolean>;
  readonly renameThread: (thread: EnvironmentThreadShell) => void;
  readonly regenerateThreadTitle: (thread: EnvironmentThreadShell) => Promise<boolean>;
} {
  const executeAction = useThreadActionExecutor();
  const snoozeMutation = useAtomCommand(threadEnvironment.snooze, { reportFailure: false });
  const unsnoozeMutation = useAtomCommand(threadEnvironment.unsnooze, { reportFailure: false });
  const pinMutation = useAtomCommand(threadEnvironment.pin, { reportFailure: false });
  const unpinMutation = useAtomCommand(threadEnvironment.unpin, { reportFailure: false });
  const setAutoMarkDoneMutation = useAtomCommand(threadEnvironment.setAutoMarkDone, {
    reportFailure: false,
  });
  const updateThreadMetadata = useAtomCommand(threadEnvironment.updateMetadata, {
    reportFailure: false,
  });
  const snoozeInFlightThreadKeys = useRef(new Set<string>());
  const titleRegenerationInFlightThreadKeys = useRef(new Set<string>());

  const archiveThread = (thread: EnvironmentThreadShell) => executeAction("archive", thread);
  const offerUndo = (
    thread: EnvironmentThreadShell,
    action: "Done" | "Snoozed" | "Unpinned",
    claim: ReturnType<typeof ThreadUndo.begin>,
    plan: ThreadUndo.ThreadUndoPlan,
  ) =>
    showThreadUndoNotice({
      action,
      claim,
      undo: async () => {
        try {
          await ThreadUndo.executeThreadUndo(
            plan,
            async (step) => {
              switch (step.action) {
                case "reopen":
                  return reopenThread(thread);
                case "unsnooze":
                  return unsnoozeThread(thread);
                case "pin":
                  return pinThread(thread, step.orderKey);
                case "snooze": {
                  const failureTitle =
                    action === "Unpinned"
                      ? "Could not undo unpin"
                      : "Could not undo marking as Done";
                  if (!checkThreadOperationPermission(thread, failureTitle)) return false;
                  const result = await snoozeMutation({
                    environmentId: thread.environmentId,
                    input: { threadId: thread.id, snoozedUntil: step.snoozedUntil },
                  });
                  if (result._tag === "Failure") {
                    const error = Cause.squash(result.cause);
                    Dialog.alert(
                      "Could not restore snooze",
                      error instanceof Error ? error.message : "The thread could not be snoozed.",
                    );
                    return false;
                  }
                  return true;
                }
              }
            },
            (result) => result,
          );
        } catch (error) {
          Dialog.alert(
            "Could not undo thread action",
            error instanceof Error ? error.message : "Try again.",
          );
        }
      },
    });

  const undoSnapshot = (thread: EnvironmentThreadShell) => ({
    ...thread,
    snoozedUntil: effectiveSnoozed(thread, { now: new Date().toISOString() })
      ? thread.snoozedUntil
      : null,
  });
  const markThreadDone = async (thread: EnvironmentThreadShell) => {
    const key = scopedThreadKey(thread.environmentId, thread.id);
    const plan = ThreadUndo.planThreadUndo("mark-done", undoSnapshot(thread));
    let claim: ReturnType<typeof ThreadUndo.begin> | undefined;
    const succeeded = await executeAction("mark-done", thread, () => {
      ThreadUndo.invalidate("pin", key);
      ThreadUndo.invalidate("snooze", key);
      claim = ThreadUndo.begin("mark-done", key);
    });
    if (claim) {
      if (succeeded) offerUndo(thread, "Done", claim, plan);
      else claim.finish();
    }
    return succeeded;
  };
  const snoozeThread = async (thread: EnvironmentThreadShell, snoozedUntil: string) => {
    if (!checkThreadOperationPermission(thread, "Could not snooze thread")) return false;
    const key = scopedThreadKey(thread.environmentId, thread.id);
    if (snoozeInFlightThreadKeys.current.has(key)) {
      return false;
    }
    snoozeInFlightThreadKeys.current.add(key);
    const run = async () => {
      if (!environmentSupportsSnooze(thread.environmentId)) {
        Dialog.alert(
          "Could not snooze thread",
          "This environment's server does not support snoozing yet. Update the server to use Snooze.",
        );
        return false;
      }
      if (!canSnooze(thread, { now: new Date().toISOString() })) {
        Dialog.alert(
          "Could not snooze thread",
          thread.hasPendingApprovals ||
            thread.hasPendingUserInput ||
            thread.pendingSubagentRequest != null
            ? "This thread is waiting on you. Respond to the pending request before snoozing it."
            : "This thread is still starting a turn. Try again once it's running.",
        );
        return false;
      }

      selectionHaptic();
      const claim = ThreadUndo.begin("snooze", key);
      const result = await withThreadDismissal(
        key,
        () =>
          snoozeMutation({
            environmentId: thread.environmentId,
            input: {
              threadId: thread.id,
              snoozedUntil,
            },
          }),
        (result) => result._tag === "Success",
      );
      if (result._tag === "Failure") {
        claim.finish();
        const error = Cause.squash(result.cause);
        Dialog.alert(
          "Could not snooze thread",
          error instanceof Error && error.message.trim().length > 0
            ? error.message
            : "The thread could not be snoozed.",
        );
        return false;
      }
      offerUndo(thread, "Snoozed", claim, ThreadUndo.planThreadUndo("snooze"));
      return true;
    };
    return run().finally(() => {
      snoozeInFlightThreadKeys.current.delete(key);
    });
  };
  const unsnoozeThread = async (thread: EnvironmentThreadShell) => {
    if (!checkThreadOperationPermission(thread, "Could not wake thread")) return false;
    const key = scopedThreadKey(thread.environmentId, thread.id);
    if (snoozeInFlightThreadKeys.current.has(key)) {
      return false;
    }
    snoozeInFlightThreadKeys.current.add(key);
    const run = async () => {
      if (!environmentSupportsSnooze(thread.environmentId)) {
        Dialog.alert(
          "Could not wake thread",
          "This environment's server does not support snoozing yet. Update the server to wake this thread.",
        );
        return false;
      }

      selectionHaptic();
      ThreadUndo.invalidate("snooze", key);
      const result = await withThreadDismissal(
        key,
        () =>
          unsnoozeMutation({
            environmentId: thread.environmentId,
            input: { threadId: thread.id, reason: "user" },
          }),
        (result) => result._tag === "Success",
      );
      if (result._tag === "Failure") {
        const error = Cause.squash(result.cause);
        Dialog.alert(
          "Could not wake thread",
          error instanceof Error && error.message.trim().length > 0
            ? error.message
            : "The thread could not be woken.",
        );
        return false;
      }
      return true;
    };
    return run().finally(() => {
      snoozeInFlightThreadKeys.current.delete(key);
    });
  };
  const reopenThread = async (thread: EnvironmentThreadShell) =>
    (await executeAction("reopen", thread)) === true;
  const pinThread = async (thread: EnvironmentThreadShell, restoreOrderKey?: string) => {
    if (!checkThreadOperationPermission(thread, "Could not pin thread")) return false;
    if (!environmentSupportsPinning(thread.environmentId)) {
      Dialog.alert(
        "Could not pin thread",
        "This environment's server does not support pinning yet. Update the server to use Pin.",
      );
      return false;
    }
    selectionHaptic();

    let orderKey: string | undefined;
    if (environmentSupportsPinReorder(thread.environmentId)) {
      const shells = appAtomRegistry.get(environmentThreadShells.threadShellsAtom);
      let firstKey: string | null = null;
      for (const shell of shells) {
        if (shell.pinnedAt == null || shell.pinOrderKey == null) continue;
        if (firstKey === null || shell.pinOrderKey < firstKey) firstKey = shell.pinOrderKey;
      }
      orderKey = pinOrderKeyBetween(null, firstKey) ?? undefined;
    }
    orderKey = environmentSupportsPinReorder(thread.environmentId)
      ? (restoreOrderKey ?? orderKey)
      : undefined;
    ThreadUndo.invalidate("pin", scopedThreadKey(thread.environmentId, thread.id));

    ThreadUndo.invalidate("mark-done", scopedThreadKey(thread.environmentId, thread.id));
    ThreadUndo.invalidate("snooze", scopedThreadKey(thread.environmentId, thread.id));
    const result = await withThreadDismissal(
      scopedThreadKey(thread.environmentId, thread.id),
      () =>
        pinMutation({
          environmentId: thread.environmentId,
          input: { threadId: thread.id, ...(orderKey !== undefined ? { orderKey } : {}) },
        }),
      (result) => result._tag === "Success",
    );
    if (result._tag === "Failure") {
      const error = Cause.squash(result.cause);
      Dialog.alert(
        "Could not pin thread",
        error instanceof Error && error.message.trim().length > 0
          ? error.message
          : "The thread could not be pinned.",
      );
      return false;
    }
    return true;
  };
  const unpinThread = async (thread: EnvironmentThreadShell) => {
    if (!checkThreadOperationPermission(thread, "Could not unpin thread")) return false;
    if (!environmentSupportsPinning(thread.environmentId)) {
      Dialog.alert(
        "Could not unpin thread",
        "This environment's server does not support pinning yet. Update the server to use Pin.",
      );
      return false;
    }
    selectionHaptic();
    const plan = ThreadUndo.planThreadUndo("unpin", undoSnapshot(thread));
    const claim = ThreadUndo.begin("pin", scopedThreadKey(thread.environmentId, thread.id));
    const result = await withThreadDismissal(
      scopedThreadKey(thread.environmentId, thread.id),
      () =>
        unpinMutation({
          environmentId: thread.environmentId,
          input: { threadId: thread.id },
        }),
      (result) => result._tag === "Success",
    );
    if (result._tag === "Failure") {
      claim.finish();
      const error = Cause.squash(result.cause);
      Dialog.alert(
        "Could not unpin thread",
        error instanceof Error && error.message.trim().length > 0
          ? error.message
          : "The thread could not be unpinned.",
      );
      return false;
    }
    offerUndo(thread, "Unpinned", claim, plan);
    return true;
  };
  const setThreadAutoMarkDone = async (thread: EnvironmentThreadShell, enabled: boolean) => {
    if (!environmentSupportsAutoMarkDoneOptOut(thread.environmentId)) {
      Dialog.alert(
        "Could not update automatic completion",
        "This environment's server does not support turning automatic completion off per thread yet. Update the server to use it.",
      );
      return false;
    }
    selectionHaptic();
    const result = await setAutoMarkDoneMutation({
      environmentId: thread.environmentId,
      input: { threadId: thread.id, enabled },
    });
    if (result._tag === "Failure") {
      const error = Cause.squash(result.cause);
      Dialog.alert(
        "Could not update automatic completion",
        error instanceof Error && error.message.trim().length > 0
          ? error.message
          : "The automatic completion setting could not be changed.",
      );
      return false;
    }
    return true;
  };
  const regenerateThreadTitle = async (thread: EnvironmentThreadShell) => {
    if (!checkThreadOperationPermission(thread, "Could not regenerate title")) return false;
    const key = scopedThreadKey(thread.environmentId, thread.id);
    if (thread.titleRegeneration != null || titleRegenerationInFlightThreadKeys.current.has(key)) {
      return false;
    }
    if (!environmentSupportsTitleRegeneration(thread.environmentId)) {
      Dialog.alert(
        "Could not regenerate title",
        "This environment's server does not support title regeneration yet. Update the server to regenerate thread titles.",
      );
      return false;
    }

    titleRegenerationInFlightThreadKeys.current.add(key);
    selectionHaptic();
    const run = async () => {
      const result = await updateThreadMetadata({
        environmentId: thread.environmentId,
        input: { threadId: thread.id, regenerateTitle: true },
      });
      if (result._tag === "Failure") {
        const error = Cause.squash(result.cause);
        Dialog.alert(
          "Could not regenerate title",
          error instanceof Error && error.message.trim().length > 0
            ? error.message
            : "The thread title could not be regenerated.",
        );
        return false;
      }
      return true;
    };
    return run().finally(() => {
      titleRegenerationInFlightThreadKeys.current.delete(key);
    });
  };
  const renameThread = (thread: EnvironmentThreadShell) => {
    const commit = (title: string) => {
      const resolution = resolveThreadTitleRename({ title, originalTitle: thread.title });
      if (resolution.action === "reject-empty") {
        Dialog.alert("Could not rename thread", "Thread title cannot be empty.");
        return;
      }
      if (resolution.action === "noop") return;
      selectionHaptic();
      void updateThreadMetadata({
        environmentId: thread.environmentId,
        input: { threadId: thread.id, title: resolution.title },
      }).then((result) => {
        if (result._tag === "Success") return;
        const error = Cause.squash(result.cause);
        Dialog.alert(
          "Could not rename thread",
          error instanceof Error && error.message.trim().length > 0
            ? error.message
            : "The thread could not be renamed.",
        );
      });
    };

    Dialog.prompt({
      title: "Rename thread",
      initialValue: thread.title,
      confirmText: "Rename",
      onConfirm: commit,
    });
  };

  const reorderPinnedMutation = useAtomCommand(threadEnvironment.reorderPin, {
    reportFailure: false,
  });
  const moveThread = async (thread: EnvironmentThreadShell, direction: ThreadMoveDestination) => {
    if (!checkThreadOperationPermission(thread, "Could not move thread")) return false;
    if (getPendingThreadOrder() !== null || appAtomRegistry.get(threadDropBusyAtom)) return false;
    const shells = appAtomRegistry.get(environmentThreadShells.navigationThreadShellsAtom);
    const current = shells.find(
      (row) => row.id === thread.id && row.environmentId === thread.environmentId,
    );
    if (!current || current.archivedAt !== null) return false;
    thread = current;
    const section =
      typeof direction === "object" && direction.section !== undefined
        ? direction.section
        : thread.pinnedAt != null
          ? "pinned"
          : "active";
    if (section === "done") {
      if (!environmentSupportsMarkDone(thread.environmentId)) return false;
      appAtomRegistry.set(threadDropBusyAtom, true);
      return markThreadDone(thread).finally(() => {
        appAtomRegistry.set(threadDropBusyAtom, false);
      });
    }

    if (section === "active") {
      const lifecycle = threadDropLifecycle(thread, section, new Date().toISOString());
      if (!lifecycle.unpin && !lifecycle.reopen && !lifecycle.unsnooze) return false;
      if (
        (lifecycle.unpin && !environmentSupportsPinning(thread.environmentId)) ||
        (lifecycle.reopen && !environmentSupportsMarkDone(thread.environmentId)) ||
        (lifecycle.unsnooze && !environmentSupportsSnooze(thread.environmentId))
      )
        return false;
      selectionHaptic();
      appAtomRegistry.set(threadDropBusyAtom, true);
      const enterActive = async () => {
        if (lifecycle.unpin && !(await unpinThread(thread))) return false;
        if (lifecycle.reopen && !(await reopenThread(thread))) return false;
        if (lifecycle.unsnooze && !(await unsnoozeThread(thread))) return false;
        return true;
      };
      return enterActive().finally(() => {
        appAtomRegistry.set(threadDropBusyAtom, false);
      });
    }
    const configs = appAtomRegistry.get(environmentServerConfigsAtom);
    const supportsReorder = (environmentId: EnvironmentThreadShell["environmentId"]) =>
      configs.has(environmentId);
    if (!supportsReorder(thread.environmentId)) {
      Dialog.alert("Could not move thread", "Connect to this environment to arrange its threads.");
      return false;
    }
    const ordered = getThreadListV2OrderedSection({
      threads: shells,
      section,
      now: new Date().toISOString(),
      queuedThreadKeys: appAtomRegistry.get(queuedThreadKeysAtom),
    });
    const assignments = createThreadMovePlanner({
      allThreads: shells,
      ordered,
      section,
      reorderableEnvironmentIds: new Set(configs.keys()),
    })(scopedThreadKey(thread.environmentId, thread.id), direction);
    if (assignments === null) return false;
    const crossSection = !ordered.some(
      (row) => row.id === thread.id && row.environmentId === thread.environmentId,
    );
    if (
      crossSection &&
      (!environmentSupportsPinning(thread.environmentId) ||
        (thread.doneOverride === "done" && !environmentSupportsMarkDone(thread.environmentId)) ||
        (effectiveSnoozed(thread, { now: new Date().toISOString() }) &&
          !environmentSupportsSnooze(thread.environmentId)))
    )
      return false;
    const shellByKey = new Map(
      shells.map((shell) => [scopedThreadKey(shell.environmentId, shell.id), shell]),
    );
    for (const assignment of assignments) {
      const target = shellByKey.get(assignment.id);
      if (target && !checkThreadOperationPermission(target, "Could not move thread")) return false;
    }
    selectionHaptic();
    appAtomRegistry.set(threadDropBusyAtom, true);
    const pending = crossSection
      ? null
      : beginPendingThreadOrder(
          createPendingThreadOrder({
            section,
            ordered,
            movedId: scopedThreadKey(thread.environmentId, thread.id),
            direction,
            assignments,
          }),
        );
    let succeeded = false;
    const run = async () => {
      if (crossSection) {
        const orderKey = assignments.find(
          ({ id }) => id === scopedThreadKey(thread.environmentId, thread.id),
        )?.orderKey;

        ThreadUndo.invalidate("pin", scopedThreadKey(thread.environmentId, thread.id));
        ThreadUndo.invalidate("mark-done", scopedThreadKey(thread.environmentId, thread.id));
        ThreadUndo.invalidate("snooze", scopedThreadKey(thread.environmentId, thread.id));
        const result = await pinMutation({
          environmentId: thread.environmentId,
          input: { threadId: thread.id, ...(orderKey === undefined ? {} : { orderKey }) },
        });
        if (result._tag === "Failure") {
          Dialog.alert("Could not pin thread", String(Cause.squash(result.cause)));
          return false;
        }
      }
      for (const assignment of assignments) {
        if (
          crossSection &&
          thread.pinnedAt == null &&
          assignment.id === scopedThreadKey(thread.environmentId, thread.id)
        )
          continue;
        if (pending !== null && !pending.isPending()) return false;
        const target = shellByKey.get(assignment.id);
        if (target === undefined) continue;
        if (!checkThreadOperationPermission(target, "Could not move thread")) return false;
        ThreadUndo.invalidate("pin", scopedThreadKey(target.environmentId, target.id));
        const result = await reorderPinnedMutation({
          environmentId: target.environmentId,
          input: { threadId: target.id, orderKey: assignment.orderKey },
        });
        if (result._tag === "Failure") {
          const error = Cause.squash(result.cause);
          Dialog.alert(
            "Could not move thread",
            error instanceof Error && error.message.trim().length > 0
              ? error.message
              : "The thread could not be moved.",
          );
          return false;
        }
      }
      succeeded = true;
      pending?.complete();
      return true;
    };
    return run().finally(() => {
      if (!succeeded) pending?.cancel();
      appAtomRegistry.set(threadDropBusyAtom, false);
    });
  };

  const confirmDeleteThread = createDeleteThreadConfirmation(executeAction);

  return {
    archiveThread,
    confirmDeleteThread,
    markThreadDone,
    snoozeThread,
    unsnoozeThread,
    reopenThread,
    pinThread,
    unpinThread,
    setThreadAutoMarkDone,
    moveThread,
    renameThread,
    regenerateThreadTitle,
  };
}

export function useArchivedThreadListActions(
  onCompleted: (thread: EnvironmentThreadShell) => void,
): {
  readonly unarchiveThread: (thread: EnvironmentThreadShell) => void;
  readonly confirmDeleteThread: (thread: EnvironmentThreadShell) => void;
} {
  const handleCompleted = (_action: ThreadListAction, thread: EnvironmentThreadShell) => {
    onCompleted(thread);
  };
  const executeAction = useThreadActionExecutor(handleCompleted);
  const unarchiveThread = (thread: EnvironmentThreadShell) => {
    void executeAction("unarchive", thread);
  };
  const confirmDeleteThread = createDeleteThreadConfirmation(executeAction);

  return { unarchiveThread, confirmDeleteThread };
}
