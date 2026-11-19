import type { ThreadStructure } from "@supaterm/client-runtime/state/shell";
import type {
  EnvironmentId,
  RunId,
  ScopedThreadRef,
  ThreadId,
  WorktreeSetupSnapshot,
} from "@supaterm/contracts";
import { scopedThreadKey } from "@supaterm/client-runtime/environment";
import { workspacePreparationRetryRunIds } from "@supaterm/client-runtime/state/turn-item-presentation";
import { useState } from "react";
import { useStableCallback } from "../../hooks/useStableCallback";
import { useEnvironmentQuery } from "../../state/query";
import { threadEnvironment } from "../../state/threads";
import { useAtomCommand } from "../../state/use-atom-command";
import { vcsEnvironment } from "../../state/vcs";
import { useTerminalUiStateStore } from "../../terminalUiStateStore";
import type { Thread } from "../../types";
import { focusTerminal } from "../../lib/terminalFocus";
import { resolveVisibleWorktreeSetup, resolveWorktreeSetupProgress } from "../ChatView.logic";
import { worktreeSetupAgentStarted } from "@supaterm/client-runtime/worktree-setup";

const retryingWorkspacePreparationRunIds = new Set<RunId>();

/**
 * Progress of the worktree a send is preparing for this route: the live setup
 * snapshot, whether it holds the composer, and the actions on its card.
 */
export function useWorktreeSetup(input: {
  readonly routeThreadRef: ScopedThreadRef;
  readonly ownerKey: string;
  readonly activeThread:
    | { readonly id: ThreadId; readonly worktreePath: string | null }
    | undefined;
  readonly threadRef: ScopedThreadRef | null;
  readonly serverProjection: ThreadStructure | null;
  readonly activityRun: Thread["latestRun"] | null;
  readonly sendQueuesBehindSetup: boolean;
  readonly followUpSent: boolean;
}) {
  const {
    routeThreadRef,
    ownerKey,
    activeThread,
    threadRef,
    serverProjection,
    activityRun,
    sendQueuesBehindSetup,
    followUpSent,
  } = input;
  const cancelWorktreeSetup = useAtomCommand(vcsEnvironment.cancelWorktreeSetup, {
    reportFailure: false,
  });
  const retryWorkspacePreparation = useAtomCommand(threadEnvironment.retryWorkspacePreparation);
  const storeEnsureTerminal = useTerminalUiStateStore((state) => state.ensureTerminal);
  const [startedSetup, setStartedSetup] = useState<{
    readonly environmentId: EnvironmentId;
    readonly threadId: ThreadId;
    readonly ownerKey: string;
  } | null>(null);
  const [heldSnapshot, setHeldSnapshot] = useState<WorktreeSetupSnapshot | null>(null);
  const started = startedSetup !== null && startedSetup.ownerKey === ownerKey;
  const target = started ? startedSetup : routeThreadRef;
  const runPreparing = activityRun?.status === "preparing";
  const snapshotQuery = useEnvironmentQuery(
    started ||
      (activeThread?.id === routeThreadRef.threadId &&
        (runPreparing || activeThread.worktreePath !== null))
      ? vcsEnvironment.worktreeSetup({
          environmentId: target.environmentId,
          input: { threadId: target.threadId },
        })
      : null,
  );
  const latestSnapshot = snapshotQuery.data;
  const routeThreadKey = scopedThreadKey(routeThreadRef);
  const [heldSource, setHeldSource] = useState({ latest: latestSnapshot, routeThreadKey });
  if (heldSource.routeThreadKey !== routeThreadKey) {
    setHeldSource({ latest: latestSnapshot, routeThreadKey });
    setHeldSnapshot(null);
  } else if (heldSource.latest !== latestSnapshot) {
    setHeldSource({ latest: latestSnapshot, routeThreadKey });
    if (latestSnapshot) {
      setHeldSnapshot((current) =>
        current?.threadId === latestSnapshot.threadId && current.sequence > latestSnapshot.sequence
          ? current
          : latestSnapshot,
      );
    }
  }
  const { snapshot: liveSnapshot, isPreparingWorktree } = resolveWorktreeSetupProgress({
    threadId: target.threadId,
    runStatus: activityRun?.status,
    latest: latestSnapshot,
    held: heldSnapshot,
  });
  const worktreeSetup = resolveVisibleWorktreeSetup({
    live: liveSnapshot,
    recorded: null,
    runs: serverProjection?.runs ?? [],
    followUpSent,
  });
  const blocksSend =
    !sendQueuesBehindSetup &&
    (worktreeSetup !== null
      ? worktreeSetup.phase === "running" && !worktreeSetupAgentStarted(worktreeSetup)
      : isPreparingWorktree);

  const retryableRunIdsKey = [
    ...workspacePreparationRetryRunIds(
      serverProjection?.runs ?? [],
      serverProjection?.turnItems ?? [],
    ),
  ].join("\n");
  const [retryableRunIds, setRetryableRunIds] = useState(() => ({
    key: retryableRunIdsKey,
    ids: new Set(retryableRunIdsKey === "" ? [] : (retryableRunIdsKey.split("\n") as RunId[])),
  }));
  if (retryableRunIds.key !== retryableRunIdsKey) {
    setRetryableRunIds({
      key: retryableRunIdsKey,
      ids: new Set(retryableRunIdsKey === "" ? [] : (retryableRunIdsKey.split("\n") as RunId[])),
    });
  }

  const begin = useStableCallback(
    (thread: { readonly environmentId: EnvironmentId; readonly threadId: ThreadId } | null) =>
      setStartedSetup(thread === null ? null : { ...thread, ownerKey }),
  );
  const cancel = useStableCallback(async () => {
    if (!worktreeSetup || worktreeSetup.phase !== "running") return false;
    const result = await cancelWorktreeSetup({
      environmentId: target.environmentId,
      input: { threadId: worktreeSetup.threadId },
    });
    return result._tag === "Success" && result.value.cancelled;
  });
  const retryPreparation = useStableCallback((runId: RunId) => {
    if (!threadRef || retryingWorkspacePreparationRunIds.has(runId)) return;
    retryingWorkspacePreparationRunIds.add(runId);
    void retryWorkspacePreparation({
      environmentId: threadRef.environmentId,
      input: { threadId: threadRef.threadId, runId },
    }).finally(() => retryingWorkspacePreparationRunIds.delete(runId));
  });
  const setupThreadRef =
    worktreeSetup && threadRef && worktreeSetup.threadId === threadRef.threadId ? threadRef : null;
  const openSetupTerminal = setupThreadRef
    ? (terminalId: string) => {
        storeEnsureTerminal(setupThreadRef, terminalId, { open: true, active: true });
        focusTerminal(setupThreadRef, terminalId);
      }
    : null;

  return {
    worktreeSetup,
    isPreparingWorktree,
    blocksSend,
    retryableRunIds: retryableRunIds.ids,
    begin,
    cancel,
    retryPreparation,
    openSetupTerminal,
  };
}
