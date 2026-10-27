import type { OrchestrationV2AppThreadLineage, ThreadId } from "@supaterm/contracts";

interface SideChatShell {
  readonly id: ThreadId;
  readonly sideChat?: boolean | undefined;
  readonly lineage: OrchestrationV2AppThreadLineage;
}

/**
 * A side chat lives beside its parent. Once the parent is deleted it is listed
 * like any other thread so its work stays reachable.
 */
export function isHiddenSideChat(
  thread: Omit<SideChatShell, "id">,
  threadIds: ReadonlySet<ThreadId>,
): boolean {
  return (
    thread.sideChat === true &&
    thread.lineage.parentThreadId !== null &&
    threadIds.has(thread.lineage.parentThreadId)
  );
}

export function sideChatsOf<Thread extends SideChatShell>(
  threads: Iterable<Thread>,
  parentThreadId: ThreadId,
): ReadonlyArray<Thread> {
  const sideChats: Thread[] = [];
  for (const thread of threads) {
    if (thread.sideChat === true && thread.lineage.parentThreadId === parentThreadId) {
      sideChats.push(thread);
    }
  }
  return sideChats;
}

interface ListedSideChat extends SideChatShell {
  readonly archivedAt: string | null;
  readonly deletedAt?: string | null | undefined;
  readonly createdAt: string;
  readonly latestUserMessageAt: string | null;
}

const lastAskedAt = (thread: ListedSideChat) => thread.latestUserMessageAt ?? thread.createdAt;

/**
 * A parent's open side chats, the one asked most recently first. Streaming
 * answers do not move the user's last question, so the order holds meanwhile.
 */
export function openSideChatsOf<Thread extends ListedSideChat>(
  threads: Iterable<Thread>,
  parentThreadId: ThreadId,
): ReadonlyArray<Thread> {
  return sideChatsOf(threads, parentThreadId)
    .filter((thread) => thread.archivedAt === null && thread.deletedAt == null)
    .toSorted((left, right) => lastAskedAt(right).localeCompare(lastAskedAt(left)));
}
