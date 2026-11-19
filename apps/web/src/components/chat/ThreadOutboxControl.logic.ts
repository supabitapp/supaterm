import type { PendingThreadTurn } from "../../state/threadOutbox";

export type ThreadOutboxStatus =
  | "failed"
  | "editing"
  | "offline"
  | "sending"
  | "retrying"
  | "waiting";

export function resolveThreadOutboxStatus(input: {
  readonly head: Pick<PendingThreadTurn, "id" | "status" | "error"> | undefined;
  readonly editingMessageId: string | null;
  readonly deliverable: boolean;
  readonly isSending: (id: string) => boolean;
}): ThreadOutboxStatus {
  const { head } = input;
  if (!head) return "waiting";
  if (head.status === "failed") return "failed";
  if (head.id === input.editingMessageId) return "editing";
  if (!input.deliverable) return "offline";
  if (input.isSending(head.id)) return "sending";
  if (head.error !== null) return "retrying";
  return "waiting";
}
