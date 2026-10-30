import { deliveryInputsAtom, selectQueuedDelivery } from "./threadOutboxQueue";
import { ThreadOutboxDeliveryState } from "./threadOutboxDeliveryState";
import type { QueuedDeliveryOutcome } from "./threadOutboxSend";
import { createAcknowledgedThreadMessageEchoesAtom } from "./acknowledged-thread-message-echoes";
import { scheduleUnusedComposerAttachmentCleanup } from "./use-composer-drafts";
import * as Dialog from "../components/ui/Dialog";
import type { MessageId } from "@supaterm/contracts";
import { Atom } from "effect/reactivity";
import { scopedThreadKey } from "../lib/scopedEntities";
import {
  acknowledgedThreadMessagesAtom,
  forgetAcknowledgedThreadMessage,
} from "./acknowledged-thread-messages";
import { appAtomRegistry } from "./atom-registry";
import {
  clearPendingThreadCreationOutcome,
  pendingThreadCreationOutcomesAtom,
} from "./pending-thread-creation";
import { threadOutboxManager } from "./thread-outbox";
import { environmentThreadDetails, environmentThreadShells } from "./threads";
import { dispatchingQueuedMessageIdAtom } from "./use-thread-outbox";

function beginDispatchingQueuedMessage(queuedMessageId: MessageId): void {
  appAtomRegistry.set(dispatchingQueuedMessageIdAtom, queuedMessageId);
}

function finishDispatchingQueuedMessage(queuedMessageId: MessageId): void {
  const current = appAtomRegistry.get(dispatchingQueuedMessageIdAtom);
  appAtomRegistry.set(dispatchingQueuedMessageIdAtom, current === queuedMessageId ? null : current);
}

// Read through the shell atom, not once: the shell often lands before the
// outcome is recorded, and that entry must still be collected when it does.
const settledCreationOutcomeKeysAtom = Atom.make((get): ReadonlyArray<string> => {
  const outcomes = get(pendingThreadCreationOutcomesAtom);
  const threads = get(environmentThreadShells.threadShellsAtom);
  return Object.entries(outcomes).flatMap(([threadKey, outcome]) =>
    outcome.kind === "delivered" &&
    threads.some(
      (thread) =>
        scopedThreadKey(thread.environmentId, thread.id) === threadKey &&
        (thread.latestRun !== null ||
          thread.runtime?.status === "failed" ||
          thread.runtime?.status === "cancelled" ||
          thread.runtime?.status === "interrupted"),
    )
      ? [threadKey]
      : [],
  );
}).pipe(Atom.withLabel("mobile:thread-outbox:settled-creation-outcomes"));

/**
 * Delivers queued thread messages one at a time. A drain pass runs whenever its inputs
 * change (outbox, locks, shells, projects, configs, connections, scopes) and when a retry
 * backoff expires. `dispatchingQueuedMessageIdAtom` is the single in-flight slot; clearing
 * it re-runs the drain for the next message.
 */
export function createThreadOutboxDelivery(): {
  readonly drain: () => void;
  readonly dispose: () => void;
} {
  let disposed = false;
  const deliveryState = new ThreadOutboxDeliveryState(drain);
  const beginDelivery = (messageId: MessageId) => {
    deliveryState.begin(messageId);
    beginDispatchingQueuedMessage(messageId);
  };
  const settle = (messageId: MessageId, delivery: Promise<QueuedDeliveryOutcome>): void => {
    void delivery
      .then(
        (outcome) => deliveryState.settle(messageId, outcome),
        (error: unknown) => {
          console.warn("[thread-outbox] queued message delivery threw", { messageId, error });
          deliveryState.retry(messageId);
        },
      )
      .finally(() => finishDispatchingQueuedMessage(messageId));
  };

  // A pass writes atoms the pass reads (family mounts, the dispatch slot), and the registry
  // notifies subscribers synchronously, so drain() can be called from inside a pass. That call
  // only asks for another pass; a nested pass would decide from inputs the outer one is still
  // acting on and could start a second delivery.
  let draining = false;
  let drainRequested = false;
  function drain(): void {
    if (disposed) return;
    if (draining) {
      drainRequested = true;
      return;
    }
    draining = true;
    try {
      do {
        if (disposed) return;
        drainRequested = false;
        drainPass();
      } while (drainRequested);
    } finally {
      draining = false;
    }
  }

  function drainPass(): void {
    const next = selectQueuedDelivery(deliveryState);
    if (next === null) return;
    beginDelivery(next.messageId);
    settle(next.messageId, next.run());
  }

  const stopDraining = appAtomRegistry.subscribe(deliveryInputsAtom, drain, { immediate: true });
  const stopCollectingOutcomes = appAtomRegistry.subscribe(
    settledCreationOutcomeKeysAtom,
    (threadKeys) => {
      for (const threadKey of threadKeys) clearPendingThreadCreationOutcome(threadKey);
    },
    { immediate: true },
  );

  return {
    drain,
    dispose: () => {
      disposed = true;
      stopDraining();
      stopCollectingOutcomes();
      deliveryState.dispose();
    },
  };
}

function loadThreadOutbox(isActive: () => boolean): void {
  void threadOutboxManager.load().then((loaded) => {
    if (loaded || !isActive()) return;
    Dialog.alert(
      "Some queued messages could not be loaded",
      "Unreadable records and attachment files are still saved. Other messages can still be sent.",
      [
        { text: "Dismiss", style: "cancel" },
        { text: "Retry", onPress: () => loadThreadOutbox(isActive) },
      ],
    );
  });
}

/** App-lifetime: loads the persisted outbox and delivers queued messages. */
export function installThreadOutboxDelivery(): () => void {
  let active = true;
  loadThreadOutbox(() => active);
  const delivery = createThreadOutboxDelivery();
  const stopAcknowledgedCleanup = appAtomRegistry.subscribe(
    createAcknowledgedThreadMessageEchoesAtom({
      messagesAtom: acknowledgedThreadMessagesAtom,
      threadAtom: environmentThreadDetails.threadAtom,
      sequenceAtom: environmentThreadDetails.sequenceAtom,
    }),
    (messages) => {
      for (const message of messages) forgetAcknowledgedThreadMessage(message);
      scheduleUnusedComposerAttachmentCleanup(messages.flatMap((message) => message.attachments));
    },
    { immediate: true },
  );
  return () => {
    active = false;
    stopAcknowledgedCleanup();
    delivery.dispose();
  };
}
