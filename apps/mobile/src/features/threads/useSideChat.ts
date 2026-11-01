import { StackActions, useNavigation } from "@react-navigation/native";
import { scopeThreadRef } from "@supaterm/client-runtime/environment";
import type { EnvironmentThreadShell } from "@supaterm/client-runtime/state/models";
import {
  isAtomCommandInterrupted,
  squashAtomCommandFailure,
} from "@supaterm/client-runtime/state/runtime";
import { useAtomValue } from "@effect/atom-react";
import { sideChatStartBlockedReason } from "@supaterm/client-runtime/state/side-chats";
import {
  AuthOrchestrationOperateScope,
  CommandId,
  MessageId,
  ThreadId,
  type EnvironmentId,
} from "@supaterm/contracts";
import { Atom } from "effect/reactivity";
import { useRef } from "react";

import * as Dialog from "../../components/ui/Dialog";
import { makeQueuedMessageMetadata } from "../../lib/commandMetadata";
import { uuidv4 } from "../../lib/uuid";
import { appAtomRegistry } from "../../state/atom-registry";
import { useEnvironmentServerConfig } from "../../state/entities";
import { useEnvironmentScope } from "../../state/session";
import { enqueueThreadOutboxMessage } from "../../state/thread-outbox";
import {
  environmentThreadDetails,
  environmentThreadShells,
  threadEnvironment,
} from "../../state/threads";
import { useAtomCommand } from "../../state/use-atom-command";
import { waitForThreadShellReady } from "./threadForkNavigation";

const NOT_PENDING_ATOM = Atom.make(false).pipe(Atom.withLabel("side-chat:worktree-not-pending"));

/** Why `parent` cannot start a side chat, or null when it can; a null parent is a draft. */
export function useSideChatDisabledReason(
  environmentId: EnvironmentId | null,
  parent: EnvironmentThreadShell | null,
): string | null {
  const serverConfig = useEnvironmentServerConfig(environmentId);
  const canOperate = useEnvironmentScope(environmentId, AuthOrchestrationOperateScope);
  const worktreePending = useAtomValue(
    parent === null
      ? NOT_PENDING_ATOM
      : environmentThreadDetails.worktreePendingAtom(
          scopeThreadRef(parent.environmentId, parent.id),
        ),
  );
  return sideChatStartBlockedReason({
    parent:
      parent === null
        ? { kind: "draft", sideChat: false }
        : {
            kind: "thread",
            lineage: parent.lineage,
            deletedAt: parent.deletedAt,
            worktreePending,
          },
    canOperate,
    supported:
      serverConfig === null ? null : serverConfig.environment.capabilities.sideChats === true,
  });
}

/**
 * Forks `parentThreadId` into a new side chat and queues `text` as its first message. Resolves
 * the side chat's id, or null after telling the user why it did not start.
 */
export function useStartSideChat() {
  const forkSideChat = useAtomCommand(threadEnvironment.forkSideChat, { reportFailure: false });
  return async (input: {
    readonly environmentId: EnvironmentId;
    readonly parentThreadId: ThreadId;
    readonly text: string;
  }): Promise<ThreadId | null> => {
    const targetThreadId = ThreadId.make(uuidv4());
    const fork = await forkSideChat({
      environmentId: input.environmentId,
      input: {
        sourceThreadId: input.parentThreadId,
        targetThreadId,
        title: "Side chat",
        creationSource: "mobile",
      },
    });
    if (fork._tag === "Failure") {
      if (!isAtomCommandInterrupted(fork)) {
        const error = squashAtomCommandFailure(fork);
        Dialog.alert(
          "Side chat not started",
          error instanceof Error ? error.message : "Try again in a moment.",
        );
      }
      return null;
    }
    const targetRef = scopeThreadRef(input.environmentId, targetThreadId);
    const ready = await waitForThreadShellReady({
      read: () => appAtomRegistry.get(environmentThreadShells.threadShellAtom(targetRef)) !== null,
    });
    if (!ready) {
      Dialog.alert(
        "Side chat created",
        "It did not reach this client. Reconnect and open it from its thread.",
      );
      return null;
    }
    const metadata = makeQueuedMessageMetadata();
    await enqueueThreadOutboxMessage({
      environmentId: input.environmentId,
      threadId: targetThreadId,
      messageId: MessageId.make(metadata.messageId),
      commandId: CommandId.make(metadata.commandId),
      text: input.text,
      attachments: [],
      runtimeMode: "approval-required",
      interactionMode: "default",
      createdAt: metadata.createdAt,
    });
    return targetThreadId;
  };
}

/**
 * Side chats of `parent`. `openDraft` pushes an empty side chat that forks on its first send;
 * `send` starts one with `prompt` at once and opens it.
 */
export function useSideChat(
  environmentId: EnvironmentId | null,
  parent: EnvironmentThreadShell | null,
) {
  const navigation = useNavigation();
  const pendingRef = useRef(false);
  const disabledReason = useSideChatDisabledReason(environmentId, parent);
  const startSideChat = useStartSideChat();

  const openDraft = () => {
    if (parent === null || disabledReason !== null) return;
    navigation.dispatch(
      StackActions.push("SideChatDraft", {
        environmentId: parent.environmentId,
        threadId: parent.id,
      }),
    );
  };

  const send = async (prompt: string): Promise<boolean> => {
    if (parent === null || disabledReason !== null || pendingRef.current) return false;
    const text = prompt.trim();
    if (text === "") {
      openDraft();
      return true;
    }
    pendingRef.current = true;
    const threadId = await startSideChat({
      environmentId: parent.environmentId,
      parentThreadId: parent.id,
      text,
    }).finally(() => {
      pendingRef.current = false;
    });
    if (threadId === null) return false;
    navigation.dispatch(
      StackActions.push("Thread", { environmentId: parent.environmentId, threadId }),
    );
    return true;
  };

  return { disabledReason, openDraft, send };
}
