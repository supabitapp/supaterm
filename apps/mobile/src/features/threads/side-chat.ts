import { openSideChatsOf } from "@supaterm/client-runtime/state/sideChats";
import {
  threadRuntimeIsActive,
  type EnvironmentThreadShell,
} from "@supaterm/client-runtime/state/shell";
import * as Cause from "effect/Cause";

export const SIDE_CHAT_COMMANDS = [
  { name: "side", description: "Ask a side question without interrupting this thread" },
  { name: "btw", description: "Same as /side" },
] as const;

const SIDE_CHAT_COMMAND_PATTERN = /^\/(?:side|btw)(?=\s|$)/;

/** The question after `/side` or `/btw`, empty for a bare command, or null for any other text. */
export function parseSideChatCommand(text: string): string | null {
  const trimmed = text.trimStart();
  const command = SIDE_CHAT_COMMAND_PATTERN.exec(trimmed);
  return command === null ? null : trimmed.slice(command[0].length).trim();
}

export function isSideChatCommandName(name: string): boolean {
  return SIDE_CHAT_COMMANDS.some((command) => command.name === name);
}

/** A parent's open side chats, the one asked most recently first. */
export function parentSideChats<
  Thread extends Pick<
    EnvironmentThreadShell,
    | "environmentId"
    | "id"
    | "sideChat"
    | "lineage"
    | "archivedAt"
    | "deletedAt"
    | "createdAt"
    | "latestUserMessageAt"
  >,
>(
  threads: Iterable<Thread>,
  parent: Pick<EnvironmentThreadShell, "environmentId" | "id">,
): ReadonlyArray<Thread> {
  return openSideChatsOf(threads, parent.id).filter(
    (thread) => thread.environmentId === parent.environmentId,
  );
}

const BUSY_RUN_STATUSES = new Set(["preparing", "queued", "starting", "running", "waiting"]);

/** The server refuses a merge-back while the parent has a run in flight or queued. */
export function sideChatMergeBackBlockReason(
  parent: Pick<EnvironmentThreadShell, "title" | "runtime" | "latestRun"> | null,
): string | null {
  if (parent === null) return "The parent thread is gone";
  const busy =
    threadRuntimeIsActive(parent.runtime) ||
    (parent.latestRun !== null && BUSY_RUN_STATUSES.has(parent.latestRun.status));
  return busy ? `Available when ${parent.title || "the parent thread"} is idle` : null;
}

export function sideChatParentAttention(
  parent: Pick<EnvironmentThreadShell, "hasPendingApprovals" | "hasPendingUserInput"> | null,
): string | null {
  if (parent?.hasPendingApprovals) return "Parent is waiting for your approval";
  if (parent?.hasPendingUserInput) return "Parent is waiting for your answer";
  return null;
}

export function commandFailureMessage(cause: Cause.Cause<unknown>, fallback: string): string {
  const error = Cause.squash(cause);
  return error instanceof Error && error.message.trim().length > 0 ? error.message : fallback;
}
