import { scopeThreadRef } from "@supaterm/client-runtime/environment";
import { deriveThreadTitleSeed } from "@supaterm/client-runtime/operations";
import type { EnvironmentThreadShell } from "@supaterm/client-runtime/state/shell";
import {
  isAtomCommandInterrupted,
  squashAtomCommandFailure,
} from "@supaterm/client-runtime/state/runtime";
import type { ScopedThreadRef, ThreadId } from "@supaterm/contracts";
import { useRef } from "react";

import { newDraftId, newMessageId, newThreadId } from "~/lib/utils";
import { openThreadBeside } from "../../chatPanes/actions";
import { usePaneThreadNavigation } from "../../chatPanes/paneScope";
import { useComposerDraftStore } from "../../composerDraftStore";
import { useStableCallback } from "../../hooks/useStableCallback";
import { readThreadShell, waitForThreadShell } from "../../state/entities";
import { enqueueThreadOutboxTurn } from "../../state/threadOutbox";
import { threadEnvironment } from "../../state/threads";
import { useAtomCommand } from "../../state/use-atom-command";
import type { ThreadRouteTarget } from "../../threadRoutes";

/**
 * Forks `parentRef` into the side chat `targetThreadId` unless that side chat already exists,
 * as it does after a first send whose message failed. Resolves an error message on failure.
 */
export function useEnsureSideChat() {
  const forkSideChat = useAtomCommand(threadEnvironment.forkSideChat, { reportFailure: false });
  return useStableCallback(
    async (parentRef: ScopedThreadRef, targetThreadId: ThreadId): Promise<string | null> => {
      const targetRef = scopeThreadRef(parentRef.environmentId, targetThreadId);
      if (readThreadShell(targetRef)?.lineage.parentThreadId === parentRef.threadId) return null;
      const fork = await forkSideChat({
        environmentId: parentRef.environmentId,
        input: { sourceThreadId: parentRef.threadId, targetThreadId, title: "Side chat" },
      });
      if (fork._tag === "Failure") {
        if (isAtomCommandInterrupted(fork)) return "Starting the side chat was cancelled.";
        const error = squashAtomCommandFailure(fork);
        return error instanceof Error ? error.message : "Could not start a side chat.";
      }
      return (await waitForThreadShell(targetRef))
        ? null
        : "The side chat was created, but it did not reach this client.";
    },
  );
}

/**
 * Side chats of `parent`, or none when it is null. `openDraft` opens an empty side chat whose
 * first send forks the parent. `send` forks and sends `prompt` at once; it resolves false when
 * the side chat did not start, or another one is still starting.
 */
export function useSideChat(input: {
  readonly parent: Pick<
    EnvironmentThreadShell,
    "environmentId" | "id" | "projectId" | "branch" | "worktreePath"
  > | null;
  readonly onError: (message: string) => void;
}) {
  const pendingRef = useRef(false);
  const ensureSideChat = useEnsureSideChat();
  const openPaneThread = usePaneThreadNavigation();
  const createSideChatDraft = useComposerDraftStore((store) => store.createSideChatDraft);

  const openSideChat = (target: ThreadRouteTarget) => {
    if (!openThreadBeside(target, "right")) void openPaneThread(target);
  };

  const openDraft = () => {
    const { parent } = input;
    if (!parent) return;
    const draftId = newDraftId();
    createSideChatDraft({ draftId, threadId: newThreadId(), parent });
    openSideChat({ kind: "draft", draftId });
  };

  const start = async (parent: NonNullable<typeof input.parent>, text: string) => {
    const parentRef = scopeThreadRef(parent.environmentId, parent.id);
    const targetThreadId = newThreadId();
    const error = await ensureSideChat(parentRef, targetThreadId);
    if (error !== null) {
      input.onError(error);
      return false;
    }
    await enqueueThreadOutboxTurn({
      environmentId: parent.environmentId,
      input: {
        threadId: targetThreadId,
        message: { messageId: newMessageId(), role: "user", text, attachments: [] },
        titleSeed: deriveThreadTitleSeed({ text, attachments: [] }),
        runtimeMode: "approval-required",
        interactionMode: "default",
        dispatchMode: "auto",
        createdAt: new Date().toISOString(),
      },
    });
    openSideChat({
      kind: "server",
      threadRef: scopeThreadRef(parent.environmentId, targetThreadId),
    });
    return true;
  };

  const send = async (prompt: string) => {
    const { parent } = input;
    if (!parent || pendingRef.current) return false;
    const text = prompt.trim();
    if (text === "") {
      openDraft();
      return true;
    }
    pendingRef.current = true;
    return start(parent, text).finally(() => {
      pendingRef.current = false;
    });
  };

  return {
    available: input.parent !== null,
    openDraft: useStableCallback(openDraft),
    send: useStableCallback(send),
  };
}
