import type { OrchestrationV2AppThreadLineage } from "@supaterm/contracts";
import { parseSideChatCommand } from "@supaterm/shared/composerTrigger";

export type SideChatParent =
  /** A thread that exists only on this client until its first send. */
  | { readonly kind: "draft"; readonly sideChat: boolean }
  | {
      readonly kind: "thread";
      readonly lineage: Pick<OrchestrationV2AppThreadLineage, "relationshipToParent" | "sideChat">;
      readonly deletedAt: unknown;
      /** See `orchestrationV2WorktreePending`. */
      readonly worktreePending: boolean;
    };

/**
 * Why `parent` cannot start a side chat, or null when it can. Mirrors the server's side chat fork
 * refusals; a parent still in its first turn is allowed, its side chat starts from a digest.
 */
export function sideChatStartBlockedReason(input: {
  readonly parent: SideChatParent;
  readonly canOperate: boolean;
  /** The environment's `sideChats` capability, or null while its server config loads. */
  readonly supported: boolean | null;
}): string | null {
  const { parent } = input;
  if (parent.kind === "draft" ? parent.sideChat : parent.lineage.sideChat === true) {
    return "Side chats cannot start side chats.";
  }
  if (parent.kind === "thread" && parent.lineage.relationshipToParent === "subagent") {
    return "Subagent threads cannot start side chats.";
  }
  if (!input.canOperate) return "This connection cannot start side chats.";
  if (input.supported === null) return "Side chats are not ready yet. Try again in a moment.";
  if (!input.supported) return "Update this environment's Supaterm server to use side chats.";
  if (parent.kind === "draft") return "Side chats start after the first message.";
  if (parent.deletedAt != null) return "This thread was deleted.";
  if (parent.worktreePending) return "Available once the thread's worktree is set up.";
  return null;
}

export type SideChatCommandAction =
  | { readonly kind: "none" }
  | { readonly kind: "refuse"; readonly reason: string }
  | { readonly kind: "start"; readonly prompt: string };

/**
 * What sending `text` does: `/side [prompt]` or `/btw [prompt]` starts a side chat, or is refused
 * with `blockedReason` rather than reaching the thread's agent as a message.
 */
export function resolveSideChatCommand(
  text: string,
  blockedReason: string | null,
): SideChatCommandAction {
  const command = parseSideChatCommand(text);
  if (command === null) return { kind: "none" };
  return blockedReason === null
    ? { kind: "start", prompt: command.prompt }
    : { kind: "refuse", reason: blockedReason };
}
