import type { EnvironmentId, ThreadId } from "@supaterm/contracts";
import type { EnvironmentThreadShell } from "@supaterm/client-runtime/state/shell";
import { offeredPromptSuggestion } from "@supaterm/client-runtime/state/orchestration";

import { orchestrationEnvironment } from "../../state/orchestration";
import { useEnvironmentQuery } from "../../state/query";

/** The provider's predicted next prompt, while the run that produced it is the thread's latest completed run. */
export function useNextPromptSuggestion(input: {
  readonly environmentId: EnvironmentId;
  readonly threadId: ThreadId | null;
  readonly enabled: boolean;
  readonly latestRun: EnvironmentThreadShell["latestRun"];
}): string | null {
  const { environmentId, threadId, enabled, latestRun } = input;
  const { data } = useEnvironmentQuery(
    enabled && threadId !== null && latestRun
      ? orchestrationEnvironment.v2.promptSuggestion({ environmentId, input: { threadId } })
      : null,
  );
  return offeredPromptSuggestion({ suggestion: data, latestRun })?.text ?? null;
}
