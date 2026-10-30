import type { EnvironmentId, ThreadId } from "@supaterm/contracts";
import type { EnvironmentThreadShell } from "@supaterm/client-runtime/state/shell";
import { nextPromptSuggestionRunId } from "@supaterm/client-runtime/state/orchestration";
import { useAtomValue } from "@effect/atom-react";
import * as Effect from "effect/Effect";
import { Atom } from "effect/reactivity";
import { useMemo } from "react";

import { orchestrationEnvironment } from "../../state/orchestration";
import { useAtomCommand } from "../../state/use-atom-command";
import { useEnvironmentQuery } from "../../state/query";

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
  const runId = nextPromptSuggestionRunId({ enabled, connected, canSuggest, latestRun });
  const query = useMemo(
    () =>
      threadId === null || runId === null
        ? null
        : Atom.make(
            Effect.promise(async () => {
              const answer = await suggestNextPrompt({
                environmentId,
                input: { threadId, afterRunId: runId },
              });
              return answer._tag === "Success" ? answer.value.suggestion : null;
            }),
          ).pipe(Atom.withLabel("mobile:next-prompt-suggestion")),
    [environmentId, threadId, runId, suggestNextPrompt],
  );
  return useEnvironmentQuery(query).data;
}
