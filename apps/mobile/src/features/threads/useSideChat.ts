import { StackActions, useNavigation } from "@react-navigation/native";
import { scopeThreadRef } from "@supaterm/client-runtime/environment";
import type { EnvironmentThreadShell } from "@supaterm/client-runtime/state/models";
import { useAtomValue } from "@effect/atom-react";
import {
  sendSideChatFirstMessage,
  sideChatStartBlockedReason,
} from "@supaterm/client-runtime/state/side-chats";
import {
  AuthOrchestrationOperateScope,
  CommandId,
  MessageId,
  ThreadId,
  type EnvironmentId,
  type ScopedThreadRef,
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
 * Sends a side chat's first message under `targetThreadId`, forking `parentThreadId` unless that
 * side chat exists. Resolves whether it has reached this device, or null after telling the user
 * why it did not start; a retry with the same id never forks twice.
 */
export async function startSideChat(input: {
  readonly environmentId: EnvironmentId;
  readonly parentThreadId: ThreadId;
  readonly targetThreadId: ThreadId;
  readonly text: string;
}): Promise<"opened" | "queued" | null> {
  const readThread = (ref: ScopedThreadRef) =>
    appAtomRegistry.get(environmentThreadShells.threadShellAtom(ref));
  const targetRef = scopeThreadRef(input.environmentId, input.targetThreadId);
  const result = await sendSideChatFirstMessage({
    registry: appAtomRegistry,
    forkSideChat: threadEnvironment.forkSideChat,
    readThread,
    waitForThread: (ref) => waitForThreadShellReady({ read: () => readThread(ref) !== null }),
    parentRef: scopeThreadRef(input.environmentId, input.parentThreadId),
    targetThreadId: input.targetThreadId,
    creationSource: "mobile",
    enqueue: () => {
      const metadata = makeQueuedMessageMetadata();
      return enqueueThreadOutboxMessage({
        environmentId: input.environmentId,
        threadId: input.targetThreadId,
        messageId: MessageId.make(metadata.messageId),
        commandId: CommandId.make(metadata.commandId),
        text: input.text,
        attachments: [],
        createdAt: metadata.createdAt,
      });
    },
  });
  if (result.kind === "busy") return null;
  if (result.kind === "failed") {
    Dialog.alert("Side chat not started", result.reason);
    return null;
  }
  return readThread(targetRef) === null ? "queued" : "opened";
}

/** The side chat's message is queued, but the side chat has not reached this device yet. */
export function alertSideChatQueued() {
  Dialog.alert("Side chat started", "It opens from its thread once it reaches this device.");
}

/**
 * Side chats of `parent`. `openDraft` pushes a side chat draft that forks on its first send;
 * `send` starts one with `prompt` at once and opens it, or opens the draft holding `prompt` and
 * its thread id when it did not start, so retrying there never forks twice.
 */
export function useSideChat(
  environmentId: EnvironmentId | null,
  parent: EnvironmentThreadShell | null,
) {
  const navigation = useNavigation();
  const pendingRef = useRef(false);
  const disabledReason = useSideChatDisabledReason(environmentId, parent);

  const pushDraft = (
    owner: EnvironmentThreadShell,
    draft: { readonly sideChatId: ThreadId; readonly prompt: string },
  ) =>
    navigation.dispatch(
      StackActions.push("SideChatDraft", {
        environmentId: owner.environmentId,
        threadId: owner.id,
        sideChatId: draft.sideChatId,
        prompt: draft.prompt,
      }),
    );

  const openDraft = () => {
    if (parent === null || disabledReason !== null) return;
    pushDraft(parent, { sideChatId: ThreadId.make(uuidv4()), prompt: "" });
  };

  const send = async (prompt: string): Promise<boolean> => {
    if (parent === null || disabledReason !== null || pendingRef.current) return false;
    const text = prompt.trim();
    const sideChatId = ThreadId.make(uuidv4());
    if (text === "") {
      pushDraft(parent, { sideChatId, prompt: "" });
      return true;
    }
    pendingRef.current = true;
    const started = await startSideChat({
      environmentId: parent.environmentId,
      parentThreadId: parent.id,
      targetThreadId: sideChatId,
      text,
    }).finally(() => {
      pendingRef.current = false;
    });
    if (started === null) pushDraft(parent, { sideChatId, prompt: text });
    else if (started === "queued") alertSideChatQueued();
    else {
      navigation.dispatch(
        StackActions.push("Thread", { environmentId: parent.environmentId, threadId: sideChatId }),
      );
    }
    return true;
  };

  return { disabledReason, openDraft, send };
}
