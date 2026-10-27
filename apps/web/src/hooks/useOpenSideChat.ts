import { scopeThreadRef } from "@supaterm/client-runtime/environment";
import type { EnvironmentThreadShell } from "@supaterm/client-runtime/state/shell";
import {
  isAtomCommandInterrupted,
  settlePromise,
  squashAtomCommandFailure,
} from "@supaterm/client-runtime/state/runtime";
import { AuthOrchestrationOperateScope, type ScopedThreadRef } from "@supaterm/contracts";
import { useState } from "react";

import { focusFocusedPaneComposer, openThreadBeside } from "../chatPanes/actions";
import { usePaneThreadNavigation } from "../chatPanes/paneScope";
import { latestSideChat } from "../components/chat/sideChat.logic";
import { toastManager } from "../components/ui/toast";
import { newMessageId, newThreadId } from "../lib/utils";
import { readEnvironmentThreadRefs, readThreadShell, waitForThreadShell } from "../state/entities";
import { useEnvironment } from "../state/environments";
import { useEnvironmentScope } from "../state/session";
import { enqueueThreadOutboxTurns } from "../state/threadOutbox";
import { threadEnvironment } from "../state/threads";
import { useAtomCommand } from "../state/use-atom-command";

const pendingSideChats = new Set<string>();

/**
 * `/side`, `/btw`, and the palette's "Ask in side chat" share this: a question opens a new side
 * chat beside the thread and sends it there; no question reopens the latest side chat, or
 * starts one.
 */
export function useOpenSideChat(
  thread: Pick<EnvironmentThreadShell, "environmentId" | "id" | "sideChat"> | null | undefined,
) {
  const openThread = usePaneThreadNavigation();
  const environmentId = thread?.environmentId ?? null;
  const threadId = thread?.id ?? null;
  const environment = useEnvironment(environmentId);
  const canOperate = useEnvironmentScope(environmentId, AuthOrchestrationOperateScope);
  const openSideChatCommand = useAtomCommand(threadEnvironment.openSideChat, {
    reportFailure: false,
  });
  const [busy, setBusy] = useState(false);
  // A side chat cannot be opened from another side chat.
  const available =
    thread != null &&
    thread.sideChat !== true &&
    canOperate &&
    environment?.connection.phase === "connected" &&
    environment.serverConfig?.environment.capabilities.sideChats === true;

  const show = async (threadRef: ScopedThreadRef) => {
    const target = { kind: "server" as const, threadRef };
    if (!openThreadBeside(target, "right")) await openThread(target);
    focusFocusedPaneComposer();
  };

  /** Resolves true once the side chat is open and any question is on its way. */
  const open = async (question: string): Promise<boolean> => {
    if (!available || environmentId === null || threadId === null) return false;
    if (question.length === 0) {
      const existing = latestSideChat(
        readEnvironmentThreadRefs(environmentId).flatMap((ref) => {
          const shell = readThreadShell(ref);
          return shell === null ? [] : [shell];
        }),
        threadId,
      );
      if (existing !== null) {
        await show(scopeThreadRef(environmentId, existing.id));
        return true;
      }
    }
    const key = JSON.stringify([environmentId, threadId]);
    if (pendingSideChats.has(key)) return false;
    pendingSideChats.add(key);
    setBusy(true);
    const settled = await settlePromise(async () => {
      const targetThreadRef = scopeThreadRef(environmentId, newThreadId());
      const result = await openSideChatCommand({
        environmentId,
        input: { sourceThreadId: threadId, targetThreadId: targetThreadRef.threadId },
      });
      if (result._tag === "Failure") {
        if (isAtomCommandInterrupted(result)) return false;
        throw squashAtomCommandFailure(result);
      }
      if (!(await waitForThreadShell(targetThreadRef))) {
        throw new Error(
          "The side chat was created, but its thread data did not reach this client. Reconnect and open it from the thread's details.",
        );
      }
      await show(targetThreadRef);
      const sideChat = readThreadShell(targetThreadRef);
      if (question.length === 0 || sideChat === null) return true;
      await enqueueThreadOutboxTurns([
        {
          environmentId,
          input: {
            threadId: sideChat.id,
            message: { messageId: newMessageId(), role: "user", text: question, attachments: [] },
            modelSelection: sideChat.modelSelection,
            runtimeMode: sideChat.runtimeMode,
            interactionMode: sideChat.interactionMode,
            createdAt: new Date().toISOString(),
          },
        },
      ]);
      return true;
    });
    pendingSideChats.delete(key);
    setBusy(false);
    if (settled._tag === "Success") return settled.value;
    const error = squashAtomCommandFailure(settled);
    toastManager.add({
      type: "error",
      title: "Could not open a side chat",
      description: error instanceof Error ? error.message : "An error occurred.",
    });
    return false;
  };

  return { available, busy, open };
}
