import { scopeThreadRef } from "@supaterm/client-runtime/environment";
import { deriveThreadTitleSeed } from "@supaterm/client-runtime/operations";
import type { EnvironmentThreadShell } from "@supaterm/client-runtime/state/shell";
import {
  sendSideChatFirstMessage,
  sideChatStartBlockedReason,
} from "@supaterm/client-runtime/state/side-chats";
import {
  AuthOrchestrationOperateScope,
  type EnvironmentId,
  type ScopedThreadRef,
  type ThreadId,
} from "@supaterm/contracts";
import { useAtomValue } from "@effect/atom-react";
import { Atom } from "effect/reactivity";

import { newDraftId, newMessageId, newThreadId } from "~/lib/utils";
import { openSideChatBeside } from "../../chatPanes/actions";
import { appAtomRegistry } from "../../rpc/atomRegistry";
import { usePaneThreadNavigation } from "../../chatPanes/paneScope";
import { useChatPaneStore } from "../../chatPanes/store";
import type { DraftId } from "../../draftId";
import { markPromotedDraftThreadByRef, useComposerDraftStore } from "../../composerDraftStore";
import { useStableCallback } from "../../hooks/useStableCallback";
import { readThreadShell, useServerConfigs, waitForThreadShell } from "../../state/entities";
import { useEnvironmentScope } from "../../state/session";
import { enqueueThreadOutboxTurn } from "../../state/threadOutbox";
import { environmentThreadDetails, threadEnvironment } from "../../state/threads";

const NOT_PENDING_ATOM = Atom.make(false).pipe(Atom.withLabel("side-chat:worktree-not-pending"));

/** Why `thread` cannot start a side chat, or null when it can. */
export function useSideChatBlockedReason(input: {
  readonly environmentId: EnvironmentId | null;
  /** The server thread, or null while the thread is a draft on this client. */
  readonly thread: Pick<EnvironmentThreadShell, "id" | "lineage" | "deletedAt"> | null;
  readonly sideChatDraft?: boolean;
}): string | null {
  const { environmentId, thread } = input;
  const serverConfig = useServerConfigs().get(environmentId ?? ("" as EnvironmentId)) ?? null;
  const canOperate = useEnvironmentScope(environmentId, AuthOrchestrationOperateScope);
  const worktreePending = useAtomValue(
    environmentId !== null && thread !== null
      ? environmentThreadDetails.worktreePendingAtom(scopeThreadRef(environmentId, thread.id))
      : NOT_PENDING_ATOM,
  );
  return sideChatStartBlockedReason({
    parent:
      thread === null
        ? { kind: "draft", sideChat: input.sideChatDraft === true }
        : {
            kind: "thread",
            lineage: thread.lineage,
            deletedAt: thread.deletedAt,
            worktreePending,
          },
    canOperate,
    supported:
      serverConfig === null ? null : serverConfig.environment.capabilities.sideChats === true,
  });
}

/** Sends a side chat draft's first message; see `sendSideChatFirstMessage`. */
export async function sendSideChatDraftMessage<A>(input: {
  readonly parentRef: ScopedThreadRef;
  readonly draftId: DraftId | null;
  readonly targetThreadId: ThreadId;
  readonly enqueue: () => Promise<A>;
}) {
  const { draftId, ...send } = input;
  const result = await sendSideChatFirstMessage({
    registry: appAtomRegistry,
    forkSideChat: threadEnvironment.forkSideChat,
    readThread: readThreadShell,
    waitForThread: waitForThreadShell,
    creationSource: "web",
    ...send,
  });
  if (result.kind === "queued" && draftId !== null) {
    const threadRef = scopeThreadRef(input.parentRef.environmentId, input.targetThreadId);
    useChatPaneStore.getState().promoteParkedDraft(draftId, threadRef);
  }
  return result;
}

/**
 * Side chats of `parent`, or none when it is null. Each one opens as a draft beside its parent
 * that holds its thread id and first message, so a start that fails is retried from the draft.
 * `send` with a prompt also starts sending that first message; it resolves false when nothing
 * opened.
 */
export function useSideChat(input: {
  readonly parent: Pick<
    EnvironmentThreadShell,
    | "environmentId"
    | "id"
    | "projectId"
    | "branch"
    | "worktreePath"
    | "modelSelection"
    | "runtimeMode"
    | "interactionMode"
  > | null;
  readonly onError: (message: string) => void;
}) {
  const openPaneThread = usePaneThreadNavigation();

  const openDraft = (prompt = "") => {
    const { parent } = input;
    if (!parent) return null;
    const draftId = newDraftId();
    const threadId = newThreadId();
    const store = useComposerDraftStore.getState();
    store.createSideChatDraft({ draftId, threadId, parent });
    if (prompt !== "") store.setPrompt(draftId, prompt);
    const target = { kind: "draft", draftId } as const;
    const parentRef = scopeThreadRef(parent.environmentId, parent.id);
    if (!openSideChatBeside(target, { parentRef, sideChat: target })) void openPaneThread(target);
    return { parent, draftId, threadId };
  };

  const send = async (prompt: string) => {
    const text = prompt.trim();
    const draft = openDraft(text);
    if (draft === null) return false;
    if (text === "") return true;
    void sendFirstMessage(draft, text);
    return true;
  };

  const sendFirstMessage = async (
    { parent, draftId, threadId }: NonNullable<ReturnType<typeof openDraft>>,
    text: string,
  ) => {
    const result = await sendSideChatDraftMessage({
      parentRef: scopeThreadRef(parent.environmentId, parent.id),
      draftId,
      targetThreadId: threadId,
      enqueue: () => {
        // The fork copied the parent's current modes; this client's copy of the parent may lag.
        const modes = readThreadShell(scopeThreadRef(parent.environmentId, threadId)) ?? parent;
        return enqueueThreadOutboxTurn({
          environmentId: parent.environmentId,
          input: {
            threadId,
            message: { messageId: newMessageId(), role: "user", text, attachments: [] },
            titleSeed: deriveThreadTitleSeed({ text, attachments: [] }),
            runtimeMode: modes.runtimeMode,
            interactionMode: modes.interactionMode,
            dispatchMode: "auto",
            createdAt: new Date().toISOString(),
          },
          draftId,
        });
      },
    });
    if (result.kind === "failed") input.onError(result.reason);
    if (result.kind === "queued") {
      const store = useComposerDraftStore.getState();
      if (store.getComposerDraft(draftId)?.prompt === text) store.clearComposerContent(draftId);
      markPromotedDraftThreadByRef(scopeThreadRef(parent.environmentId, threadId));
    }
  };

  return {
    available: input.parent !== null,
    openDraft: useStableCallback(() => void openDraft()),
    send: useStableCallback(send),
  };
}
