import {
  type EnvironmentProject,
  type EnvironmentThreadShell,
  threadRuntimeIsActive,
} from "@supaterm/client-runtime/state/shell";
import { threadFamilyRead, type ThreadFamilyRead } from "@supaterm/client-runtime/state/threads";
import {
  AuthOrchestrationOperateScope,
  type EnvironmentId,
  type MessageId,
} from "@supaterm/contracts";
import { Atom } from "effect/reactivity";
import { scopedThreadKey } from "../lib/scopedEntities";
import { appAtomRegistry } from "./atom-registry";
import { pendingThreadCreationOutcomesAtom } from "./pending-thread-creation";
import { environmentProjects } from "./projects";
import { environmentServerConfigsAtom } from "./server";
import { environmentSession, sessionHasScope } from "./session";
import { confirmThreadOutboxMessageQueued, threadOutboxManager } from "./thread-outbox";
import { removeThreadOutboxMessage } from "./thread-outbox-removal";
import {
  isQueuedThreadCreationSendable,
  resolveThreadOutboxDeliveryAction,
  resolveThreadOutboxDispatchStep,
  type QueuedThreadMessage,
} from "./thread-outbox-model";
import { environmentThreadShells, threadFamilies } from "./threads";
import {
  dispatchingQueuedMessageIdAtom,
  editingQueuedMessageIdsAtom,
  threadOutboxShellStatusesAtom,
} from "./use-thread-outbox";
import { workspaceConnections } from "./workspace";
import {
  deliverQueuedMessage,
  restoreQueuedDelivery,
  type QueuedDeliveryOutcome,
} from "./threadOutboxSend";
import type { ThreadOutboxDeliveryState } from "./threadOutboxDeliveryState";
import {
  recoverEditedCreationAfterDelivery,
  removeAcknowledgedQueuedMessage,
} from "./threadOutboxRecovery";

function findThread(
  threads: ReadonlyArray<EnvironmentThreadShell>,
  message: QueuedThreadMessage,
): EnvironmentThreadShell | undefined {
  return threads.find(
    (candidate) =>
      candidate.environmentId === message.environmentId && candidate.id === message.threadId,
  );
}

function findCreationProject(
  projects: ReadonlyArray<EnvironmentProject>,
  message: QueuedThreadMessage,
): EnvironmentProject | undefined {
  return projects.find(
    (candidate) =>
      candidate.environmentId === message.environmentId &&
      candidate.id === message.creation?.projectId,
  );
}

export const deliveryInputsAtom = Atom.make((get) => {
  const connectedEnvironments = get(workspaceConnections.environmentsAtom);
  const operableEnvironments = new Set<EnvironmentId>();
  for (const { environmentId } of connectedEnvironments) {
    if (
      sessionHasScope(
        get(environmentSession.sessionStateAtom(environmentId)),
        AuthOrchestrationOperateScope,
      )
    ) {
      operableEnvironments.add(environmentId);
    }
  }
  return {
    creationOutcomes: get(pendingThreadCreationOutcomesAtom),
    dispatchingQueuedMessageId: get(dispatchingQueuedMessageIdAtom),
    editingQueuedMessageIds: get(editingQueuedMessageIdsAtom),
    queuedMessagesByThreadKey: get(threadOutboxManager.queuedMessagesByThreadKeyAtom),
    shellStatuses: get(threadOutboxShellStatusesAtom),
    threads: get(environmentThreadShells.threadShellsAtom),
    projects: get(environmentProjects.projectsAtom),
    serverConfigs: get(environmentServerConfigsAtom),
    connectedEnvironments,
    operableEnvironments,
  };
}).pipe(Atom.withLabel("mobile:thread-outbox:delivery-inputs"));

export function selectQueuedDelivery(deliveryState: ThreadOutboxDeliveryState): {
  readonly messageId: MessageId;
  readonly run: () => Promise<QueuedDeliveryOutcome>;
} | null {
  const {
    dispatchingQueuedMessageId,
    editingQueuedMessageIds,
    queuedMessagesByThreadKey,
    shellStatuses,
    threads,
    projects,
    serverConfigs,
    connectedEnvironments,
    operableEnvironments,
  } = appAtomRegistry.get(deliveryInputsAtom);
  if (dispatchingQueuedMessageId !== null) {
    return null;
  }

  const queuedMessageIds = new Set(
    Object.values(queuedMessagesByThreadKey)
      .flat()
      .map((message) => message.messageId),
  );
  deliveryState.prune(queuedMessageIds);

  for (const [threadKey, queuedMessages] of Object.entries(queuedMessagesByThreadKey)) {
    const nextQueuedMessage = queuedMessages[0];
    if (!nextQueuedMessage) {
      continue;
    }
    const messageId = nextQueuedMessage.messageId;
    if (nextQueuedMessage.creation === undefined && deliveryState.needsRemoval(messageId)) {
      if (!deliveryState.canAttempt(nextQueuedMessage)) {
        continue;
      }
      return {
        messageId,
        run: () =>
          removeAcknowledgedQueuedMessage(nextQueuedMessage).then((status) => ({
            status: status === "removed" ? "removed" : "acknowledged",
          })),
      };
    }
    if (editingQueuedMessageIds[messageId]) {
      continue;
    }
    if (!deliveryState.canAttempt(nextQueuedMessage)) continue;

    let thread = findThread(threads, nextQueuedMessage);
    if (thread && scopedThreadKey(thread.environmentId, thread.id) !== threadKey) {
      continue;
    }

    const creation = nextQueuedMessage.creation;
    const awaitingCreatedThread =
      appAtomRegistry.get(pendingThreadCreationOutcomesAtom)[threadKey]?.kind === "delivered";
    const environment = connectedEnvironments.find(
      (candidate) => candidate.environmentId === nextQueuedMessage.environmentId,
    );
    const shellStatus = shellStatuses.get(nextQueuedMessage.environmentId) ?? "empty";
    const serverConfig = serverConfigs.get(nextQueuedMessage.environmentId);
    let familyRead: ThreadFamilyRead | undefined;
    if (
      thread === undefined &&
      creation === undefined &&
      serverConfig?.shellThreadFamilies === true
    ) {
      // The family keeps the row readable through dispatch once it loads; the current shell
      // generation's read decides whether the thread is gone.
      deliveryState.retainFamily(messageId, () =>
        threadFamilies.mount(
          appAtomRegistry,
          nextQueuedMessage.environmentId,
          nextQueuedMessage.threadId,
        ),
      );
      familyRead = threadFamilyRead(
        appAtomRegistry.get(
          threadFamilies.familyAtom(nextQueuedMessage.environmentId, nextQueuedMessage.threadId),
        ),
      );
      if (familyRead === "settled") {
        // The rows read at the start of this pass can lag the family that just settled;
        // decide from the merged rows as they are now.
        thread = findThread(
          appAtomRegistry.get(environmentThreadShells.threadShellsAtom),
          nextQueuedMessage,
        );
      } else if (familyRead === "failed") {
        threadFamilies.refresh(
          appAtomRegistry,
          nextQueuedMessage.environmentId,
          nextQueuedMessage.threadId,
        );
      }
    }
    const deliveryAction = resolveThreadOutboxDeliveryAction({
      isCreation: creation !== undefined,
      threadExists: thread !== undefined,
      shellStatus,
      environmentConnected: environment?.connectionState === "connected",
      threadBusy: threadRuntimeIsActive(thread?.runtime),
      awaitingCreatedThread,
      ...(familyRead === undefined ? {} : { threadFamilyRead: familyRead }),
    });
    if (
      deliveryAction === "wait" &&
      shellStatus === "live" &&
      familyRead !== undefined &&
      familyRead !== "settled"
    ) {
      // An empty family read changes no merged row, so nothing else would wake the drain.
      deliveryState.retry(messageId);
      continue;
    }
    if (deliveryAction === "send" && !operableEnvironments.has(nextQueuedMessage.environmentId)) {
      continue;
    }
    const dispatchStep = resolveThreadOutboxDispatchStep({
      deliveryAction,
      fileAttachments: nextQueuedMessage.attachments.filter(
        (attachment) => attachment.type === "file",
      ),
      serverConfig: serverConfig
        ? {
            maxFileUploadBytes:
              serverConfig.environment.capabilities.fileAttachments?.maxUploadBytes,
          }
        : null,
    });
    if (dispatchStep.step === "wait") {
      continue;
    }
    if (dispatchStep.step === "retry") {
      deliveryState.retry(messageId);
      continue;
    }
    if (dispatchStep.step === "restore") {
      return {
        messageId,
        run: () =>
          confirmThreadOutboxMessageQueued(nextQueuedMessage).then((queued) =>
            !queued || appAtomRegistry.get(editingQueuedMessageIdsAtom)[messageId]
              ? { status: "deferred" }
              : restoreQueuedDelivery(nextQueuedMessage, dispatchStep.reason),
          ),
      };
    }
    const creationProjectCwd =
      creation !== undefined
        ? (findCreationProject(projects, nextQueuedMessage)?.workspaceRoot ??
          creation.projectCwd ??
          null)
        : null;
    if (deliveryAction === "send" && creation !== undefined) {
      if (!isQueuedThreadCreationSendable(nextQueuedMessage)) {
        continue;
      }
      if (creationProjectCwd === null && shellStatus !== "live") {
        continue;
      }
    }

    const removeQueuedMessage = (warning: string) =>
      removeThreadOutboxMessage(nextQueuedMessage).then(
        () => ({ status: "removed" as const }),
        (error) => {
          console.warn(warning, {
            environmentId: nextQueuedMessage.environmentId,
            threadId: nextQueuedMessage.threadId,
            messageId,
            error,
          });
          return { status: "retry" as const };
        },
      );
    // Confirm durability before sending; optimistic enqueue can still roll back on write failure.
    const run = () =>
      confirmThreadOutboxMessageQueued(nextQueuedMessage).then((queued) => {
        if (!queued) {
          return { status: "deferred" as const };
        }
        // Re-check editor ownership after the durable read before any dispatch or recovery.
        if (appAtomRegistry.get(editingQueuedMessageIdsAtom)[messageId]) {
          return { status: "deferred" as const };
        }
        if (deliveryAction === "send") {
          const liveThread = findThread(
            appAtomRegistry.get(environmentThreadShells.threadShellsAtom),
            nextQueuedMessage,
          );
          const liveDeliveryAction = resolveThreadOutboxDeliveryAction({
            isCreation: creation !== undefined,
            threadExists: liveThread !== undefined,
            shellStatus,
            environmentConnected: environment?.connectionState === "connected",
            threadBusy: threadRuntimeIsActive(liveThread?.runtime),
            awaitingCreatedThread:
              appAtomRegistry.get(pendingThreadCreationOutcomesAtom)[threadKey]?.kind ===
              "delivered",
          });
          if (liveDeliveryAction !== "send") {
            return { status: "deferred" as const };
          }
        }
        if (deliveryAction === "remove") {
          if (creation !== undefined)
            return recoverEditedCreationAfterDelivery(nextQueuedMessage).then((status) => ({
              status,
            }));
          return removeQueuedMessage(
            "[thread-outbox] failed to remove message for a missing thread",
          );
        }
        if (creation !== undefined) {
          if (creationProjectCwd === null) {
            return removeQueuedMessage(
              "[thread-outbox] dropped pending task for a missing project",
            );
          }
          return deliverQueuedMessage(nextQueuedMessage, {
            kind: "creation",
            projectCwd: creationProjectCwd,
          });
        }
        return thread !== undefined
          ? deliverQueuedMessage(nextQueuedMessage, { kind: "thread", thread })
          : Promise.resolve({ status: "retry" as const });
      });
    return { messageId, run };
  }
  return null;
}
