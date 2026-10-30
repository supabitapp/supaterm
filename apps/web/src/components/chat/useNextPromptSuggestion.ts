import type { EnvironmentId, RunId, ThreadId } from "@supaterm/contracts";
import { nextPromptSuggestionRunId } from "@supaterm/client-runtime/state/orchestration";
import { useAtomValue } from "@effect/atom-react";
import { useState } from "react";
import * as Data from "effect/Data";
import * as Effect from "effect/Effect";
import { AsyncResult, Atom } from "effect/reactivity";
import { runAtomCommand } from "@supaterm/client-runtime/state/runtime";

import { useEnvironment } from "~/state/environments";
import { orchestrationEnvironment } from "~/state/orchestration";

import type { ThreadShell } from "../../types";

class SuggestedRun extends Data.Class<{
  readonly environmentId: EnvironmentId;
  readonly threadId: ThreadId;
  readonly runId: RunId;
}> {}

const suggestionAtom = Atom.family((target: SuggestedRun | null) =>
  target === null
    ? Atom.make(AsyncResult.success<string | null>(null))
    : Atom.make((get) =>
        Effect.promise(async () => {
          const answer = await runAtomCommand(
            get.registry,
            orchestrationEnvironment.suggestNextPrompt,
            {
              environmentId: target.environmentId,
              input: { threadId: target.threadId, afterRunId: target.runId },
            },
            { reportFailure: false, reportDefect: false },
          );
          return answer._tag === "Success" ? answer.value.suggestion : null;
        }),
      ).pipe(Atom.setIdleTTL(0)),
);

export function useNextPromptSuggestion(input: {
  readonly environmentId: EnvironmentId;
  readonly threadId: ThreadId | null;
  readonly enabled: boolean;
  readonly latestRun: ThreadShell["latestRun"] | undefined;
}) {
  const { environmentId, threadId, enabled, latestRun } = input;
  // A request made before the environment connects fails, and nothing would retry it.
  const connected = useEnvironment(environmentId)?.connection.phase === "connected";
  const canSuggest = useAtomValue(
    orchestrationEnvironment.suggestNextPrompt.permissionAtom(environmentId),
  );
  const [dismissed, setDismissed] = useState<SuggestedRun | null>(null);
  const runId = nextPromptSuggestionRunId({ enabled, connected, canSuggest, latestRun });
  const active = threadId !== null && runId !== null;

  const result = useAtomValue(
    suggestionAtom(active ? new SuggestedRun({ environmentId, threadId, runId }) : null),
  );
  const visible =
    active &&
    result._tag === "Success" &&
    (dismissed?.threadId !== threadId || dismissed.runId !== runId);

  return {
    suggestion: visible ? result.value : null,
    dismiss: () => {
      if (threadId !== null && runId !== null)
        setDismissed(new SuggestedRun({ environmentId, threadId, runId }));
    },
  };
}
