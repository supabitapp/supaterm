import * as Dialog from "../../components/ui/Dialog";
import * as Haptics from "expo-haptics";
import { useSelectWorkspaceDetail } from "../workspace/useSelectWorkspaceDetail";
import { useCallback } from "react";

import { withThreadDismissal } from "./thread-dismissal";
import { appAtomRegistry } from "../../state/atom-registry";
import { removePendingThreadCreation } from "../../state/thread-outbox-removal";
import { clearComposerDraftContent } from "../../state/use-composer-drafts";
import type { PendingNewTask } from "../../state/use-pending-new-tasks";
import {
  dispatchingQueuedMessageIdAtom,
  holdDeletingQueuedMessage,
  releaseDeletingQueuedMessage,
} from "../../state/use-thread-outbox";

export function usePendingTaskListActions(
  selectRoute?: (params: ReactNavigation.RootParamList["Thread"]) => void,
): {
  readonly openPendingTask: (pendingTask: PendingNewTask) => void;
  readonly confirmDeletePendingTask: (pendingTask: PendingNewTask) => void;
} {
  const selectDetail = useSelectWorkspaceDetail();
  const selectThreadRoute =
    selectRoute ??
    ((params: ReactNavigation.RootParamList["Thread"]) => selectDetail({ name: "Thread", params }));

  const openPendingTask = useCallback(
    (pendingTask: PendingNewTask) => {
      selectThreadRoute(
        pendingTask.kind === "pending"
          ? {
              environmentId: String(pendingTask.environmentId),
              threadId: String(pendingTask.message.threadId),
            }
          : {
              draft: {
                environmentId: String(pendingTask.environmentId),
                projectId: String(pendingTask.projectId),
                draftId: pendingTask.draftKey,
              },
            },
      );
    },
    [selectThreadRoute],
  );

  const confirmDeletePendingTask = useCallback(
    (pendingTask: PendingNewTask) => {
      if (pendingTask.kind === "draft") {
        Dialog.alert("Discard draft?", `“${pendingTask.title}” will be removed.`, [
          { text: "Cancel", style: "cancel" },
          {
            text: "Discard",
            style: "destructive",
            onPress: () => {
              void Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
              void withThreadDismissal(
                pendingTask.key,
                async () => {
                  clearComposerDraftContent(pendingTask.draftKey, {
                    clearModelSelection: true,
                    clearWorkspaceSelection: true,
                  });
                  return true;
                },
                (result) => result,
              );
            },
          },
        ]);
        return;
      }
      Dialog.alert(
        "Delete pending task?",
        `“${pendingTask.title}” has not been sent yet and will be removed from the outbox.`,
        [
          { text: "Cancel", style: "cancel" },
          {
            text: "Delete",
            style: "destructive",
            onPress: () => {
              const messageId = pendingTask.message.messageId;
              if (!holdDeletingQueuedMessage(messageId)) {
                Dialog.alert(
                  "Pending task is open",
                  "Close the pending task editor before deleting it.",
                );
                return;
              }
              void Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
              void withThreadDismissal(
                pendingTask.key,
                async () => {
                  const removed = await removePendingThreadCreation(
                    pendingTask.message,
                    () => appAtomRegistry.get(dispatchingQueuedMessageIdAtom) !== messageId,
                  );
                  releaseDeletingQueuedMessage(messageId, removed);
                  const route = navigation.getState()?.routes.at(-1);
                  if (
                    removed &&
                    route?.name === "Thread" &&
                    route.params &&
                    "environmentId" in route.params &&
                    "threadId" in route.params &&
                    route.params.environmentId === pendingTask.environmentId &&
                    route.params.threadId === pendingTask.message.threadId
                  ) {
                    if (navigation.canGoBack()) navigation.goBack();
                    else navigation.navigate("Home");
                  }
                  return removed;
                },
                (result) => result,
              ).catch((error) => {
                releaseDeletingQueuedMessage(messageId, false);
                Dialog.alert(
                  "Could not delete pending task",
                  error instanceof Error ? error.message : "The pending task could not be removed.",
                );
              });
            },
          },
        ],
      );
    },
    [navigation],
  );

  return { openPendingTask, confirmDeletePendingTask };
}
