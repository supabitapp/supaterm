import type { ScopedThreadRef } from "@supaterm/contracts";
import { useEffect, useReducer, useState } from "react";
import { threadEnvironment } from "../../state/threads";
import { useAtomCommand } from "../../state/use-atom-command";

export function useDeferredWorkLoading(
  threadRef: ScopedThreadRef | null,
  row: { expanded: boolean; deferredWorkItemIds?: ReadonlyArray<string> },
  onToggle: () => void,
) {
  const loadWork = useAtomCommand(threadEnvironment.loadEarlierHistory, { reportFailure: false });
  const environmentId = threadRef?.environmentId;
  const threadId = threadRef?.threadId;
  const anchorsKey = row.deferredWorkItemIds?.join("\n") ?? "";
  const [attempt, retry] = useReducer((current: number) => current + 1, 0);
  const requestKey = `${environmentId}:${threadId}:${anchorsKey}:${attempt}`;
  const [failedRequest, setFailedRequest] = useState<string | null>(null);
  // oxlint-disable-next-line supaterm/no-unreasoned-state-sync -- Restored expanded folds request paged server history; cleanup retires replies for replaced anchors and unmounted rows.
  useEffect(() => {
    if (!row.expanded || !anchorsKey || environmentId === undefined || threadId === undefined)
      return;
    let active = true;
    void Promise.all(
      anchorsKey
        .split("\n")
        .map((workAnchorId) => loadWork({ environmentId, input: { threadId, workAnchorId } })),
    ).then(
      (results) => {
        if (active)
          setFailedRequest(
            results.some((result) => result._tag === "Failure" || result.value._tag === "error")
              ? requestKey
              : null,
          );
      },
      () => {
        if (active) setFailedRequest(requestKey);
      },
    );
    return () => {
      active = false;
    };
  }, [row.expanded, anchorsKey, environmentId, threadId, requestKey, loadWork]);
  const error =
    anchorsKey && failedRequest === requestKey ? "Couldn't load work. Click to retry." : null;
  const loading = threadRef !== null && row.expanded && anchorsKey !== "" && error === null;
  const toggle = () => {
    if (error && row.expanded) retry();
    else onToggle();
  };
  return { loading, error, toggle };
}
