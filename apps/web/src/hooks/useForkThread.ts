import { scopeThreadRef } from "@supaterm/client-runtime/environment";
import type { EnvironmentThreadShell } from "@supaterm/client-runtime/state/shell";
import {
  isAtomCommandInterrupted,
  settlePromise,
  squashAtomCommandFailure,
} from "@supaterm/client-runtime/state/runtime";
import { AuthOrchestrationOperateScope, type RunId, type ThreadId } from "@supaterm/contracts";
import { useState } from "react";

import { newThreadId } from "../lib/utils";
import { waitForThreadShell } from "../state/entities";
import { useEnvironment } from "../state/environments";
import { useEnvironmentScope } from "../state/session";
import { threadEnvironment } from "../state/threads";
import { useAtomCommand } from "../state/use-atom-command";
import { usePaneThreadNavigation } from "../chatPanes/paneScope";

const pendingForks = new Set<string>();

/** Fork actions share creation, duplicate prevention, and navigation across entry points. */
export function useForkThread(
  thread: Pick<EnvironmentThreadShell, "environmentId" | "id" | "title"> | null | undefined,
  disabled = false,
) {
  const openThread = usePaneThreadNavigation();
  const environmentId = thread?.environmentId ?? null;
  const threadId = thread?.id ?? null;
  const title = thread?.title ?? "";
  const environment = useEnvironment(environmentId);
  const canOperate = useEnvironmentScope(environmentId, AuthOrchestrationOperateScope);
  const forkFromRun = useAtomCommand(threadEnvironment.forkFromRun, { reportFailure: false });
  const [busy, setBusy] = useState(false);
  const available = !disabled && canOperate && environment?.connection.phase === "connected";
  const onForkFromRun = async (source: {
    readonly sourceThreadId: ThreadId;
    readonly runId: RunId;
  }) => {
    if (environmentId === null || threadId === null || !available) return;
    const key = JSON.stringify([environmentId, threadId]);
    if (pendingForks.has(key)) return;
    pendingForks.add(key);
    setBusy(true);
    const settled = await settlePromise(async () => {
      const targetThreadId = newThreadId();
      const targetThreadRef = scopeThreadRef(environmentId, targetThreadId);
      const result = await forkFromRun({
        environmentId,
        input: { ...source, targetThreadId, title: `${title} fork` },
      });
      if (result._tag === "Failure") {
        if (isAtomCommandInterrupted(result)) return;
        throw squashAtomCommandFailure(result);
      }
      if (!(await waitForThreadShell(targetThreadRef))) {
        throw new Error(
          "The fork was created, but its thread data did not reach this client. Reconnect and try opening it from the sidebar.",
        );
      }
      await openThread({ kind: "server", threadRef: targetThreadRef });
    });
    pendingForks.delete(key);
    setBusy(false);
    if (settled._tag === "Failure") throw squashAtomCommandFailure(settled);
  };
  return { onForkFromRun, disabled: !available || busy };
}
