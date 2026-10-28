import type { EnvironmentId, RunId, ThreadId } from "@supaterm/contracts";
import type { EnvironmentThreadShell } from "@supaterm/client-runtime/state/shell";
import { nextPromptSuggestionRunId } from "@supaterm/client-runtime/state/orchestration";
import { useAtomValue } from "@effect/atom-react";
import { useEffect, useState } from "react";

import { orchestrationEnvironment } from "../../state/orchestration";
import { useAtomCommand } from "../../state/use-atom-command";

/**
 * What the user is likely to send after the agent's latest reply. It lives in this screen only;
 * the server decides whether the run is recent enough to spend a model call on.
 */
export function useNextPromptSuggestion(input: {
  readonly environmentId: EnvironmentId;
  readonly threadId: ThreadId | null;
  /** A request made before the environment connects fails, and nothing would retry it. */
  readonly connected: boolean;
  readonly enabled: boolean;
  readonly latestRun: EnvironmentThreadShell["latestRun"];
}): string | null {
  const { environmentId, threadId, connected, enabled, latestRun } = input;
  const canSuggest = useAtomValue(
    orchestrationEnvironment.suggestNextPrompt.permissionAtom(environmentId),
  );
  const suggestNextPrompt = useAtomCommand(orchestrationEnvironment.suggestNextPrompt, {
    reportFailure: false,
    reportDefect: false,
  });
  const [result, setResult] = useState<{
    readonly threadId: ThreadId;
    readonly runId: RunId;
    readonly text: string;
  } | null>(null);
  const runId = nextPromptSuggestionRunId({ enabled, connected, canSuggest, latestRun });
  const active = threadId !== null && runId !== null;

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

  return active && result?.threadId === threadId && result.runId === runId ? result.text : null;
}
