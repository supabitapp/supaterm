import type { EnvironmentId, OrchestrationV2Run, RunId, ThreadId } from "@supaterm/contracts";
import { offeredPromptSuggestion } from "@supaterm/client-runtime/state/orchestration";
import { useAtom } from "@effect/atom-react";
import { Atom } from "effect/reactivity";

import { orchestrationEnvironment } from "~/state/orchestration";
import { useEnvironmentQuery } from "~/state/query";

import type { ThreadShell } from "../../types";

// Run ids derive from thread ids, which can repeat across environments.
const dismissKey = (environmentId: EnvironmentId, runId: RunId) => `${environmentId}\u0000${runId}`;

const NONE_DISMISSED: ReadonlySet<string> = new Set();
const dismissedPromptSuggestionsAtom = Atom.make(NONE_DISMISSED).pipe(
  Atom.keepAlive,
  Atom.withLabel("composer:dismissed-prompt-suggestions"),
);

/**
 * The provider's predicted next prompt, while the run that produced it is the thread's latest
 * completed run and Escape has not dismissed it.
 */
export function useNextPromptSuggestion(input: {
  readonly environmentId: EnvironmentId;
  readonly threadId: ThreadId | null;
  readonly enabled: boolean;
  readonly latestRun: ThreadShell["latestRun"] | undefined;
  readonly runs: ReadonlyArray<OrchestrationV2Run>;
}) {
  const { environmentId, threadId, enabled, latestRun, runs } = input;
  const { data } = useEnvironmentQuery(
    enabled && threadId !== null && latestRun
      ? orchestrationEnvironment.v2.promptSuggestion({ environmentId, input: { threadId } })
      : null,
  );
  const [dismissed, setDismissed] = useAtom(dismissedPromptSuggestionsAtom);
  const offered = offeredPromptSuggestion({ suggestion: data, latestRun, runs });
  const visible = offered !== null && !dismissed.has(dismissKey(environmentId, offered.runId));

  return {
    suggestion: visible ? offered.text : null,
    dismiss: () => {
      if (offered === null) return;
      setDismissed((current) => new Set(current).add(dismissKey(environmentId, offered.runId)));
    },
  };
}
