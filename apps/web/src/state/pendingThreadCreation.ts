import {
  buildPendingThreadShell,
  type PendingThreadCreation,
} from "@supaterm/client-runtime/pending-thread-creation";
import { optimisticThreadCreationShell } from "@supaterm/client-runtime/state/thread-creation";
import type { OrchestrationV2ThreadShell } from "@supaterm/contracts";
import * as DateTime from "effect/DateTime";
import type { PendingThreadTurn } from "./threadOutbox";

// ChatView resets its retained creation during render whenever this identity
// changes, so one outbox entry must always present as the same object.
const presentedCreations = new WeakMap<PendingThreadTurn, WebPendingThreadCreation | null>();

export function pendingThreadCreation(entry: PendingThreadTurn): WebPendingThreadCreation | null {
  const cached = presentedCreations.get(entry);
  if (cached !== undefined) return cached;
  const presented = presentPendingThreadCreation(entry);
  presentedCreations.set(entry, presented);
  return presented;
}

function presentPendingThreadCreation(entry: PendingThreadTurn) {
  const { input, environmentId } = entry.payload;
  const creation = input.bootstrap?.createThread;
  if (!creation) return null;
  const message = {
    environmentId,
    threadId: input.threadId,
    messageId: input.message.messageId,
    text: input.message.text,
    context: input.message.context,
    createdAt: entry.createdAt,
    entry,
    shell: buildPendingThreadShell({
      ...creation,
      environmentId,
      threadId: input.threadId,
      modelSelection: input.modelSelection ?? creation.modelSelection,
      runtimeMode: input.runtimeMode,
      interactionMode: input.interactionMode,
      creationSource: input.creationSource ?? "web",
    }),
  };
  return {
    message,
    outcome:
      entry.status === "failed"
        ? { kind: "failed", message, reason: entry.error ?? "Could not start the thread." }
        : entry.status === "delivered"
          ? { kind: "delivered", message }
          : null,
  } satisfies PendingThreadCreation<typeof message>;
}

export type WebPendingThreadCreation = NonNullable<ReturnType<typeof presentPendingThreadCreation>>;

const undeliveredShells = new WeakMap<PendingThreadTurn, OrchestrationV2ThreadShell | null>();

/** Once delivered, the startTurn overlay and then the server's shell own the row instead. */
export function undeliveredCreationShell(
  entry: PendingThreadTurn,
): OrchestrationV2ThreadShell | null {
  const cached = undeliveredShells.get(entry);
  if (cached !== undefined) return cached;
  const creation = entry.payload.input.bootstrap?.createThread;
  const shell =
    creation === undefined || entry.status !== "pending"
      ? null
      : optimisticThreadCreationShell(
          entry.payload.input,
          creation,
          DateTime.makeUnsafe(entry.createdAt),
        );
  undeliveredShells.set(entry, shell);
  return shell;
}
