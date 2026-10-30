import { useAtomValue } from "@effect/atom-react";
import type { PendingThreadRequests } from "@supaterm/client-runtime/state/thread-requests";
import { deriveReportedModelSelection } from "@supaterm/client-runtime/state/thread-execution";
import type { ThreadTurnSubagents } from "@supaterm/client-runtime/state/thread-subagents";
import type { EnvironmentThread } from "@supaterm/client-runtime/state/shell";
import type {
  EnvironmentId,
  OrchestrationV2ThreadProjection,
  ScopedThreadRef,
  ThreadId,
} from "@supaterm/contracts";
import { Atom } from "effect/reactivity";

type EnvironmentThreadStructure = NonNullable<
  ReturnType<
    typeof environmentThreadDetails.quietThreadAtom
  > extends import("effect/reactivity").Atom.Atom<infer A>
    ? A
    : never
>;
import { environmentThreadDetails, useEnvironmentThread } from "./threads";
import { useThreadSelection } from "./use-thread-selection";

const EMPTY_THREAD_PROJECTION_ATOM = Atom.make<EnvironmentThread | null>(null).pipe(
  Atom.withLabel("mobile-thread-projection:empty"),
);
const EMPTY_THREAD_STRUCTURE_ATOM = Atom.make<EnvironmentThreadStructure | null>(null).pipe(
  Atom.withLabel("mobile-thread-structure:empty"),
);
const EMPTY_VISIBLE_TURN_ITEMS_ATOM = Atom.make<
  OrchestrationV2ThreadProjection["visibleTurnItems"]
>(Object.freeze([])).pipe(Atom.withLabel("mobile-thread-visible-turn-items:empty"));

export interface ThreadDetailTarget {
  readonly environmentId: EnvironmentId | null;
  readonly threadId: ThreadId | null;
}

export function useThreadDetail(target: ThreadDetailTarget) {
  return useEnvironmentThread(target.environmentId, target.threadId);
}

export function useSelectedThreadDetailState() {
  const { selectedThreadRef } = useThreadSelection();
  return useEnvironmentThread(
    selectedThreadRef?.environmentId ?? null,
    selectedThreadRef?.threadId ?? null,
  );
}

export function useThreadProjection(target: ThreadDetailTarget): EnvironmentThread | null {
  return useAtomValue(
    target.environmentId === null || target.threadId === null
      ? EMPTY_THREAD_PROJECTION_ATOM
      : environmentThreadDetails.threadAtom({
          environmentId: target.environmentId,
          threadId: target.threadId,
        }),
  );
}

/** Keeps its value through streamed text; runs, sessions, and item status still update. */
export function useQuietThreadStructure(
  ref: ScopedThreadRef | null,
): EnvironmentThreadStructure | null {
  return useAtomValue(
    ref === null ? EMPTY_THREAD_STRUCTURE_ATOM : environmentThreadDetails.quietThreadAtom(ref),
  );
}

export function useSelectedThreadProjection(): EnvironmentThread | null {
  const { selectedThreadRef } = useThreadSelection();
  return useThreadProjection({
    environmentId: selectedThreadRef?.environmentId ?? null,
    threadId: selectedThreadRef?.threadId ?? null,
  });
}

const selectReportedModelSelection = (thread: EnvironmentThread | null) =>
  thread === null ? null : deriveReportedModelSelection(thread.projection);
const EMPTY_QUEUED_COUNT_ATOM = Atom.make(0);
const EMPTY_TURN_SUBAGENTS_ATOM = Atom.make<ThreadTurnSubagents | null>(null);

export function useSelectedThreadComposerMetadata() {
  const { selectedThreadRef } = useThreadSelection();
  const reportedModelSelection = useAtomValue(
    selectedThreadRef === null
      ? EMPTY_THREAD_PROJECTION_ATOM
      : environmentThreadDetails.threadAtom(selectedThreadRef),
    selectReportedModelSelection,
  );
  const queuedCount = useAtomValue(
    selectedThreadRef === null
      ? EMPTY_QUEUED_COUNT_ATOM
      : environmentThreadDetails.queuedCountAtom(selectedThreadRef),
  );
  const turnSubagents = useAtomValue(
    selectedThreadRef === null
      ? EMPTY_TURN_SUBAGENTS_ATOM
      : environmentThreadDetails.turnSubagentsAtom(selectedThreadRef),
  );
  return { reportedModelSelection, queuedCount, turnSubagents };
}

export function useThreadVisibleTurnItems(
  target: ThreadDetailTarget,
): OrchestrationV2ThreadProjection["visibleTurnItems"] {
  return useAtomValue(
    target.environmentId === null || target.threadId === null
      ? EMPTY_VISIBLE_TURN_ITEMS_ATOM
      : environmentThreadDetails.visibleTurnItemsAtom({
          environmentId: target.environmentId,
          threadId: target.threadId,
        }),
  );
}

export function useSelectedThreadVisibleTurnItems(): OrchestrationV2ThreadProjection["visibleTurnItems"] {
  const { selectedThreadRef } = useThreadSelection();
  return useThreadVisibleTurnItems({
    environmentId: selectedThreadRef?.environmentId ?? null,
    threadId: selectedThreadRef?.threadId ?? null,
  });
}

const EMPTY_WORKTREE_PATH_ATOM = Atom.make<string | null>(null);
const EMPTY_PENDING_REQUESTS_ATOM = Atom.make<PendingThreadRequests | null>(null);

export function useSelectedThreadWorktreePath() {
  const { selectedThreadRef } = useThreadSelection();
  return useAtomValue(
    selectedThreadRef === null
      ? EMPTY_WORKTREE_PATH_ATOM
      : environmentThreadDetails.worktreePathAtom(selectedThreadRef),
  );
}

export function useThreadWorktreePath(ref: ScopedThreadRef | null) {
  return useAtomValue(
    ref === null ? EMPTY_WORKTREE_PATH_ATOM : environmentThreadDetails.worktreePathAtom(ref),
  );
}

export function useThreadReportedModelSelection(ref: ScopedThreadRef | null) {
  return useAtomValue(
    ref === null ? EMPTY_THREAD_PROJECTION_ATOM : environmentThreadDetails.threadAtom(ref),
    selectReportedModelSelection,
  );
}

export function useSelectedThreadPendingRequests() {
  const { selectedThreadRef } = useThreadSelection();
  return useAtomValue(
    selectedThreadRef === null
      ? EMPTY_PENDING_REQUESTS_ATOM
      : environmentThreadDetails.pendingRequestsAtom(selectedThreadRef),
  );
}
