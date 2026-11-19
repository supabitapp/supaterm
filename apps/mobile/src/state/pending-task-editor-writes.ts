import type { QueuedThreadMessage } from "./thread-outbox";
import { threadOutboxRevision, updateThreadOutboxMessage } from "./thread-outbox";
import { getComposerDraftSnapshot, sameComposerDraftState } from "./use-composer-drafts";

type PendingTaskEditorWriteResult =
  | {
      readonly status: "complete";
      readonly updated: boolean;
      readonly nextRevision: number;
    }
  | {
      readonly status: "failed";
      readonly error: unknown;
      readonly nextRevision: number;
    };

const pendingWrites = new Map<
  QueuedThreadMessage["messageId"],
  Promise<PendingTaskEditorWriteResult>
>();

/** Captures the editor revision and predecessor save; the promise survives clearing its map entry. */
export function capturePendingTaskEditorWriteBaseline(messageId: QueuedThreadMessage["messageId"]) {
  const capturedRevision = threadOutboxRevision(messageId);
  const predecessor = pendingWrites.get(messageId);
  if (!predecessor) {
    return Promise.resolve(capturedRevision);
  }
  return predecessor.then(
    ({ nextRevision }) => Math.max(capturedRevision, nextRevision),
    () => capturedRevision,
  );
}

export function flushPendingTaskEditorWrite(input: {
  readonly message: QueuedThreadMessage;
  readonly baseline: Promise<number>;
  readonly draftKey: string;
}) {
  const { message } = input;
  const draftSnapshot = getComposerDraftSnapshot(input.draftKey);
  const write = input.baseline.then(async (expectedRevision) => {
    try {
      const updated = await updateThreadOutboxMessage(message, expectedRevision);
      return {
        status: "complete",
        updated,
        nextRevision: expectedRevision + (updated ? 1 : 0),
      } satisfies PendingTaskEditorWriteResult;
    } catch (error) {
      return {
        status: "failed",
        error,
        nextRevision: expectedRevision,
      } satisfies PendingTaskEditorWriteResult;
    }
  });

  pendingWrites.set(message.messageId, write);
  const removeWrite = () => {
    if (pendingWrites.get(message.messageId) === write) {
      pendingWrites.delete(message.messageId);
    }
  };
  void write.then(removeWrite, removeWrite);

  return write.then((result) => {
    if (result.status === "failed") {
      throw result.error;
    }
    return (
      result.updated &&
      sameComposerDraftState(draftSnapshot, getComposerDraftSnapshot(input.draftKey))
    );
  }) satisfies Promise<boolean>;
}
