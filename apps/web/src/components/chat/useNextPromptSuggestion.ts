import type { EnvironmentId, RunId, ThreadId } from "@supaterm/contracts";
import { useAtomValue } from "@effect/atom-react";
import { useEffect, useState } from "react";

import { useStableCallback } from "~/hooks/useStableCallback";
import { orchestrationEnvironment } from "~/state/orchestration";
import { useAtomCommand } from "~/state/use-atom-command";

import type { ThreadShell } from "../../types";

interface SuggestedRun {
  readonly threadId: ThreadId;
  readonly runId: RunId;
}

/**
 * What the user is likely to send after the agent's latest reply. It lives in this component
 * only; the server decides whether the run is recent enough to spend a model call on.
 */
export function useNextPromptSuggestion(input: {
  readonly environmentId: EnvironmentId;
  readonly threadId: ThreadId | null;
  /** A request made before the environment connects fails, and nothing would retry it. */
  readonly connected: boolean;
  readonly enabled: boolean;
  readonly latestRun: ThreadShell["latestRun"] | undefined;
}) {
  const { environmentId, threadId, connected, enabled, latestRun } = input;
  const canSuggest = useAtomValue(
    orchestrationEnvironment.suggestNextPrompt.permissionAtom(environmentId),
  );
  const suggestNextPrompt = useStableCallback(
    useAtomCommand(orchestrationEnvironment.suggestNextPrompt, {
      reportFailure: false,
      reportDefect: false,
    }),
  );
  const [result, setResult] = useState<(SuggestedRun & { readonly text: string }) | null>(null);
  const [dismissed, setDismissed] = useState<SuggestedRun | null>(null);
  const runId = latestRun?.status === "completed" ? latestRun.runId : null;
  const active = connected && enabled && canSuggest && threadId !== null && runId !== null;

  useEffect(() => {
    if (!active) return;
    let current = true;
    void suggestNextPrompt({ environmentId, input: { threadId, afterRunId: runId } }).then(
      (answer) => {
        if (!current || answer._tag !== "Success" || answer.value.suggestion === null) return;
        setResult({ threadId, runId, text: answer.value.suggestion });
      },
    );
    return () => {
      current = false;
    };
  }, [active, environmentId, threadId, runId, suggestNextPrompt]);

  const matches = (entry: SuggestedRun | null) =>
    entry !== null && entry.threadId === threadId && entry.runId === runId;
  const visible = active && result !== null && matches(result) && !matches(dismissed);

  return {
    suggestion: visible ? result.text : null,
    dismiss: () => {
      if (threadId !== null && runId !== null) setDismissed({ threadId, runId });
    },
  };
}
