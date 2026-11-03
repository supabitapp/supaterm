import {
  handoffRunsSignature,
  type MessagesTimelineRowsInput,
  type MessagesTimelineRow,
  deriveMessagesTimelineRowsWithState,
  nextWorktreeSetupRowPlacement,
  sameRowsInput,
  type StableMessagesTimelineRowsState,
  computeStableMessagesTimelineRows,
  withExitingWorktreeSetupRow,
  type WorktreeSetupRowPlacement,
} from "./MessagesTimeline.logic";
import { useEffect, useState } from "react";
import { TIMELINE_ROW_EXIT_MS } from "./TimelineRowExit";
import type { HandoffTimelineRun } from "./V2LifecycleRow";

const EMPTY_TIMELINE_RUNS: ReadonlyArray<HandoffTimelineRun> = [];

export function useStableHandoffRuns(
  runs: ReadonlyArray<HandoffTimelineRun>,
): ReadonlyArray<HandoffTimelineRun> {
  const [state, setState] = useState<{
    readonly source: ReadonlyArray<HandoffTimelineRun> | null;
    readonly signature: string;
    readonly value: ReadonlyArray<HandoffTimelineRun>;
  }>({ source: null, signature: "", value: EMPTY_TIMELINE_RUNS });
  if (state.source === runs) return state.value;
  const signature = handoffRunsSignature(runs);
  const value =
    signature === state.signature
      ? state.value
      : runs.map((run) => ({
          id: run.id,
          ordinal: run.ordinal,
          providerInstanceId: run.providerInstanceId,
          modelSelection: run.modelSelection,
        }));
  setState({ source: runs, signature, value });
  return value;
}

/**
 * Rows derived from the previous projection of the same list, so a streamed
 * text update patches its message rows instead of deriving every row again.
 */
export function useIncrementalTimelineRows(
  identity: string,
  input: MessagesTimelineRowsInput,
): MessagesTimelineRow[] {
  const [state, setState] = useState(() => ({
    identity,
    input,
    projection: deriveMessagesTimelineRowsWithState(input),
  }));
  if (state.identity === identity && sameRowsInput(state.input, input)) {
    return state.projection.rows;
  }
  const projection = deriveMessagesTimelineRowsWithState(
    input,
    state.identity === identity ? state.projection : null,
  );
  setState({ identity, input, projection });
  return projection.rows;
}

export function useStableRows(
  rows: MessagesTimelineRow[],
  identity: string,
): MessagesTimelineRow[] {
  const [state, setState] = useState<{
    readonly identity: string;
    readonly source: MessagesTimelineRow[] | null;
    readonly stable: StableMessagesTimelineRowsState;
  }>({ identity, source: null, stable: { byId: new Map(), result: [] } });
  if (state.identity === identity && state.source === rows) return state.stable.result;
  const stable = computeStableMessagesTimelineRows(
    rows,
    state.identity === identity ? state.stable : { byId: new Map(), result: [] },
  );
  setState({ identity, source: rows, stable });
  return stable.result;
}

/**
 * Keeps a worktree setup row that left the list where it was, marked exiting,
 * for its exit transition. Switching lists drops it at once.
 */
export function useExitingWorktreeSetupRow(
  rows: MessagesTimelineRow[],
  identity: string,
): MessagesTimelineRow[] {
  const [state, setState] = useState<{
    readonly identity: string;
    readonly source: MessagesTimelineRow[] | null;
    readonly placement: WorktreeSetupRowPlacement | null;
    readonly result: MessagesTimelineRow[];
  }>({ identity, source: null, placement: null, result: rows });
  let current = state;
  if (state.identity !== identity || state.source !== rows) {
    const placement = nextWorktreeSetupRowPlacement(
      state.identity === identity ? state.placement : null,
      rows,
    );
    current = {
      identity,
      source: rows,
      placement,
      result: withExitingWorktreeSetupRow(rows, placement),
    };
    setState(current);
  }
  const exitingRow = current.placement?.row.exiting ? current.placement.row : null;

  // oxlint-disable-next-line supaterm/no-unreasoned-state-sync -- drops the exiting row once its CSS exit transition has run; the timer is cleared if the setup comes back
  useEffect(() => {
    if (!exitingRow) return;
    const timeout = window.setTimeout(() => {
      setState((latest) =>
        latest.placement?.row === exitingRow
          ? { ...latest, placement: null, result: latest.source ?? [] }
          : latest,
      );
    }, TIMELINE_ROW_EXIT_MS);
    return () => window.clearTimeout(timeout);
  }, [exitingRow]);

  return current.result;
}
