import type { EnvironmentThreadShell } from "@supaterm/client-runtime/state/shell";
import { threadRuntimeIsActive } from "@supaterm/client-runtime/state/models";
import { isHiddenSideChat, openSideChatsOf } from "@supaterm/client-runtime/state/sideChats";
import type {
  OrchestrationV2AppThreadLineage,
  OrchestrationV2ContextTransfer,
  ThreadId,
} from "@supaterm/contracts";

const SIDE_CHAT_SLASH_COMMANDS = ["side", "btw"] as const;
export type SideChatSlashCommand = (typeof SIDE_CHAT_SLASH_COMMANDS)[number];

export function isSideChatSlashCommand(name: string): name is SideChatSlashCommand {
  return (SIDE_CHAT_SLASH_COMMANDS as ReadonlyArray<string>).includes(name);
}

/** The question after `/side` or `/btw`, empty for the bare command, or null for any other prompt. */
export function parseSideChatCommand(prompt: string): string | null {
  const match = /^\s*\/(side|btw)(?=\s|$)([\s\S]*)$/u.exec(prompt);
  return match ? (match[2] ?? "").trim() : null;
}

interface ListedThread {
  readonly environmentId: string;
  readonly id: ThreadId;
  readonly sideChat?: boolean | undefined;
  readonly lineage: OrchestrationV2AppThreadLineage;
}

/** Thread lists leave out side chats whose parent is still in the same list. */
export function withoutHiddenSideChats<Thread extends ListedThread>(
  threads: ReadonlyArray<Thread>,
): ReadonlyArray<Thread> {
  if (!threads.some((thread) => thread.sideChat === true)) return threads;
  const threadIdsByEnvironment = new Map<string, Set<ThreadId>>();
  for (const thread of threads) {
    const threadIds = threadIdsByEnvironment.get(thread.environmentId) ?? new Set<ThreadId>();
    threadIds.add(thread.id);
    threadIdsByEnvironment.set(thread.environmentId, threadIds);
  }
  return threads.filter(
    (thread) => !isHiddenSideChat(thread, threadIdsByEnvironment.get(thread.environmentId)!),
  );
}

/** The side chat a bare `/side` reopens: the one the user last asked in. */
export function latestSideChat<
  Thread extends ListedThread &
    Pick<EnvironmentThreadShell, "archivedAt" | "deletedAt" | "createdAt" | "latestUserMessageAt">,
>(threads: Iterable<Thread>, parentThreadId: ThreadId): Thread | null {
  return openSideChatsOf(threads, parentThreadId)[0] ?? null;
}

/** The server refuses a merge-back while the parent has a run in flight or queued. */
export function isSideChatParentBusy(
  parent: Pick<EnvironmentThreadShell, "runtime" | "latestRun">,
): boolean {
  const status = parent.latestRun?.status;
  return (
    threadRuntimeIsActive(parent.runtime) ||
    status === "preparing" ||
    status === "queued" ||
    status === "starting" ||
    status === "running" ||
    status === "waiting"
  );
}

/** What of the parent the side chat started from, from its fork transfer. */
export function sideChatContextNote(
  transfers: ReadonlyArray<
    Pick<OrchestrationV2ContextTransfer, "type" | "targetThreadId" | "snapshot" | "resolution">
  >,
  threadId: ThreadId,
): string | null {
  const transfer = transfers.find(
    (candidate) => candidate.type === "fork" && candidate.targetThreadId === threadId,
  );
  if (transfer === undefined) return null;
  if (transfer.snapshot === "live") return "Includes the parent's run in progress";
  if (transfer.resolution !== null && transfer.resolution.strategy !== "native_fork") {
    return "Starts from a summary of the parent";
  }
  return "Starts from the parent's last finished run";
}

/** A merge-back still waiting for the parent's next turn survives discarding the side chat. */
export function hasPendingSideChatMerge(
  transfers: ReadonlyArray<
    Pick<OrchestrationV2ContextTransfer, "type" | "sourceThreadId" | "status">
  >,
  threadId: ThreadId,
): boolean {
  return transfers.some(
    (transfer) =>
      transfer.type === "merge_back" &&
      transfer.sourceThreadId === threadId &&
      transfer.status === "pending",
  );
}
