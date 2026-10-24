import type { PendingThreadTurn } from "../../state/threadOutbox";

export type ThreadOutboxStatus =
  | "failed"
  | "editing"
  | "offline"
  | "transcribing"
  | "sending"
  | "retrying"
  | "waiting";

export function resolveThreadOutboxStatus(input: {
  readonly head: Pick<PendingThreadTurn, "id" | "status" | "error"> | undefined;
  readonly editingMessageId: string | null;
  readonly deliverable: boolean;
  readonly isPreparing: (id: string) => boolean;
  readonly isSending: (id: string) => boolean;
}): ThreadOutboxStatus {
  const { head } = input;
  if (!head) return "waiting";
  if (head.status === "failed") return "failed";
  if (head.id === input.editingMessageId) return "editing";
  if (!input.deliverable) return "offline";
  if (input.isPreparing(head.id)) return "transcribing";
  if (input.isSending(head.id)) return "sending";
  if (head.error !== null) return "retrying";
  return "waiting";
}

export function formatVoiceMessageDuration(durationMs: number): string {
  const seconds = Math.max(0, Math.round(durationMs / 1_000));
  return `${Math.floor(seconds / 60)}:${String(seconds % 60).padStart(2, "0")}`;
}
