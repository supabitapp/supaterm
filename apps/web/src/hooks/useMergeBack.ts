import type { ThreadStructure } from "@supaterm/client-runtime/state/shell";
import {
  isAtomCommandInterrupted,
  squashAtomCommandFailure,
} from "@supaterm/client-runtime/state/runtime";
import { resolveLatestMergeBackRun } from "@supaterm/client-runtime/state/thread-workflows";
import type { EnvironmentId, ThreadId } from "@supaterm/contracts";
import { useState } from "react";

import { toastManager } from "../components/ui/toast";
import { threadEnvironment } from "../state/threads";
import { useAtomCommand } from "../state/use-atom-command";

/** Merges a fork's latest finished run back into the thread it was forked from. */
export function useMergeBack(input: {
  readonly environmentId: EnvironmentId;
  readonly threadId: ThreadId;
  readonly targetThreadId: ThreadId | null;
  readonly projection: ThreadStructure | null;
}) {
  const { environmentId, threadId, targetThreadId, projection } = input;
  const mergeBack = useAtomCommand(threadEnvironment.mergeBack, { reportFailure: false });
  const [isMerging, setIsMerging] = useState(false);
  const latestRun = projection === null ? null : resolveLatestMergeBackRun(projection);

  /** Resolves true once the parent has accepted the merge. */
  const merge = async (): Promise<boolean> => {
    if (latestRun === null || targetThreadId === null || isMerging) return false;
    setIsMerging(true);
    const result = await mergeBack({
      environmentId,
      input: { sourceThreadId: threadId, targetThreadId, runId: latestRun.id },
    });
    setIsMerging(false);
    if (result._tag === "Success") return true;
    if (!isAtomCommandInterrupted(result)) {
      const error = squashAtomCommandFailure(result);
      toastManager.add({
        type: "error",
        title: "Could not merge back",
        description: error instanceof Error ? error.message : "An error occurred.",
      });
    }
    return false;
  };

  return { latestRun, isMerging, merge };
}
