import type { OrchestrationV2AppThread, OrchestrationV2Run } from "@supaterm/contracts";
import * as DateTime from "effect/DateTime";

const SIDE_CHAT_BOUNDARY = `<side_chat>
The parent thread's history above is reference context, not your current task. You are in a side chat: answer the user's questions here without continuing, executing, or completing the parent thread's work. Do not modify files, git state, or other workspace state, and do not start subagents, unless the user asks for it in this side chat. The parent thread may still be working in the same workspace.
</side_chat>`;

const SIDE_CHAT_REMINDER = `<side_chat>
Still a side chat: answer without continuing the parent thread's work, and leave the workspace unchanged unless the user asks.
</side_chat>`;

const SIDE_CHAT_PROMOTED = `<side_chat>
This conversation is no longer a side chat. The earlier side chat restrictions no longer apply.
</side_chat>`;

/**
 * Rides in the user message: Codex swaps per-turn developer instructions for
 * catalog collaboration-mode text, and Claude fixes its system prompt per
 * process. The approval-required runtime mode is the actual enforcement.
 */
export function sideChatTurnNote(input: {
  readonly thread: Pick<OrchestrationV2AppThread, "sideChat" | "sideChatPromotedAt">;
  readonly runs: ReadonlyArray<Pick<OrchestrationV2Run, "ordinal" | "requestedAt">>;
  readonly run: Pick<OrchestrationV2Run, "ordinal">;
}): string {
  const earlierRuns = input.runs.filter((candidate) => candidate.ordinal < input.run.ordinal);
  if (input.thread.sideChat === true) {
    return earlierRuns.length === 0 ? SIDE_CHAT_BOUNDARY : SIDE_CHAT_REMINDER;
  }
  const promotedAt = input.thread.sideChatPromotedAt;
  if (promotedAt == null || earlierRuns.length === 0) return "";
  return earlierRuns.some((candidate) => DateTime.isGreaterThan(candidate.requestedAt, promotedAt))
    ? ""
    : SIDE_CHAT_PROMOTED;
}
