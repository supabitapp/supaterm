import { StackActions, useNavigation } from "@react-navigation/native";
import { scopeThreadRef } from "@supaterm/client-runtime/environment";
import {
  isAtomCommandInterrupted,
  type AtomCommandResult,
} from "@supaterm/client-runtime/state/runtime";
import type { EnvironmentThreadShell } from "@supaterm/client-runtime/state/shell";
import type { OpenSideChatInput } from "@supaterm/client-runtime/state/threads";
import {
  AuthOrchestrationOperateScope,
  CommandId,
  MessageId,
  ThreadId,
  type EnvironmentId,
} from "@supaterm/contracts";

import * as Dialog from "../../components/ui/Dialog";
import { makeQueuedMessageMetadata } from "../../lib/commandMetadata";
import { scopedThreadKey } from "../../lib/scopedEntities";
import { uuidv4 } from "../../lib/uuid";
import { appAtomRegistry } from "../../state/atom-registry";
import { readEnvironmentScope } from "../../state/session";
import { enqueueThreadOutboxMessage } from "../../state/thread-outbox";
import { environmentThreadShells, threadEnvironment } from "../../state/threads";
import { useAtomCommand } from "../../state/use-atom-command";
import {
  clearComposerDraftContent,
  getComposerDraftSnapshot,
  scheduleUnusedComposerAttachmentCleanup,
  type ComposerDraft,
} from "../../state/use-composer-drafts";
import { commandFailureMessage, parentSideChats, parseSideChatCommand } from "./side-chat";
import { waitForThreadShellReady } from "./threadForkNavigation";

// Shared by every entry point so the composer and the command palette cannot
// fork the same parent twice at once.
const openingParentKeys = new Set<string>();
const pendingComposerFocus = new Set<string>();

/** Consumes the request an opened side chat leaves for its composer to take focus. */
export function takePendingSideChatFocus(threadKey: string): boolean {
  return pendingComposerFocus.delete(threadKey);
}

interface OpenSideChatRequest {
  readonly parent: EnvironmentThreadShell;
  /** The parent composer draft holding `/side`; its question moves to the side chat. */
  readonly draftKey?: string;
  /** Opens a new side chat even when the parent already has one. */
  readonly fresh?: boolean;
}

interface SideChatTarget {
  readonly environmentId: EnvironmentId;
  readonly id: ThreadId;
}

function draftUnchanged(draftKey: string, snapshot: ComposerDraft): boolean {
  const current = getComposerDraftSnapshot(draftKey);
  return (
    current.text === snapshot.text &&
    current.attachments.length === snapshot.attachments.length &&
    current.attachments.every(
      (attachment, index) => attachment.id === snapshot.attachments[index]?.id,
    )
  );
}

async function openSideChatFlow(
  request: OpenSideChatRequest,
  dependencies: {
    readonly fork: (target: {
      readonly environmentId: EnvironmentId;
      readonly input: OpenSideChatInput;
    }) => Promise<AtomCommandResult<unknown, unknown>>;
    readonly show: (sideChat: SideChatTarget, focusComposer: boolean) => void;
  },
): Promise<void> {
  const { parent } = request;
  if (!readEnvironmentScope(parent.environmentId, AuthOrchestrationOperateScope)) {
    Dialog.alert("Could not open side chat", "This connection cannot change threads.");
    return;
  }
  const draft = request.draftKey === undefined ? null : getComposerDraftSnapshot(request.draftKey);
  const question = draft === null ? "" : parseSideChatCommand(draft.text);
  if (question === null) return;
  const attachments = draft?.attachments ?? [];
  const asks = question.length > 0 || attachments.length > 0;
  const clearCommand = () => {
    if (
      request.draftKey === undefined ||
      draft === null ||
      !draftUnchanged(request.draftKey, draft)
    )
      return;
    clearComposerDraftContent(request.draftKey, { deferAttachmentCleanup: true });
    scheduleUnusedComposerAttachmentCleanup(attachments);
  };

  if (!asks && request.fresh !== true) {
    const latest = parentSideChats(
      appAtomRegistry.get(environmentThreadShells.threadShellsAtom),
      parent,
    )[0];
    if (latest !== undefined) {
      clearCommand();
      dependencies.show(latest, true);
      return;
    }
  }

  const targetThreadId = ThreadId.make(uuidv4());
  const targetRef = scopeThreadRef(parent.environmentId, targetThreadId);
  const opened = await dependencies.fork({
    environmentId: parent.environmentId,
    input: { sourceThreadId: parent.id, targetThreadId, creationSource: "mobile" },
  });
  if (opened._tag === "Failure") {
    if (!isAtomCommandInterrupted(opened)) {
      Dialog.alert("Could not open side chat", commandFailureMessage(opened.cause, "Try again."));
    }
    return;
  }
  const ready = await waitForThreadShellReady({
    read: () => appAtomRegistry.get(environmentThreadShells.threadShellAtom(targetRef)) !== null,
  });
  const sideChat = appAtomRegistry.get(environmentThreadShells.threadShellAtom(targetRef));
  if (!ready || sideChat === null) {
    Dialog.alert(
      "Side chat created",
      "Its thread data did not reach this client. Reconnect and open it from Side chats on the parent thread.",
    );
    return;
  }
  if (asks && draft !== null) {
    const metadata = makeQueuedMessageMetadata();
    try {
      await enqueueThreadOutboxMessage({
        environmentId: sideChat.environmentId,
        threadId: sideChat.id,
        messageId: MessageId.make(metadata.messageId),
        commandId: CommandId.make(metadata.commandId),
        text: question,
        attachments,
        ...(draft.context === undefined ? {} : { context: draft.context }),
        modelSelection: sideChat.modelSelection,
        runtimeMode: sideChat.runtimeMode,
        interactionMode: sideChat.interactionMode,
        createdAt: metadata.createdAt,
      });
    } catch (error) {
      Dialog.alert(
        "Could not send to the side chat",
        error instanceof Error ? error.message : "Your question is still in the composer.",
      );
      dependencies.show(sideChat, true);
      return;
    }
  }
  clearCommand();
  dependencies.show(sideChat, !asks);
}

/**
 * Opens a parent's side chat. A `/side <question>` draft forks a new one and
 * sends the question there; a bare request reopens the latest one, if any.
 */
export function useOpenSideChat() {
  const navigation = useNavigation();
  const fork = useAtomCommand(threadEnvironment.openSideChat, { reportFailure: false });
  const show = (sideChat: SideChatTarget, focusComposer: boolean) => {
    if (focusComposer) {
      pendingComposerFocus.add(scopedThreadKey(sideChat.environmentId, sideChat.id));
    }
    navigation.dispatch(
      StackActions.push("Thread", {
        environmentId: String(sideChat.environmentId),
        threadId: String(sideChat.id),
      }),
    );
  };

  return async (request: OpenSideChatRequest): Promise<void> => {
    const parentKey = scopedThreadKey(request.parent.environmentId, request.parent.id);
    if (openingParentKeys.has(parentKey)) return;
    openingParentKeys.add(parentKey);
    await openSideChatFlow(request, { fork, show }).finally(() => {
      openingParentKeys.delete(parentKey);
    });
  };
}
