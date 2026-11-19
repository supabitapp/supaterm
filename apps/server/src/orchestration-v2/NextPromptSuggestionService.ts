import type {
  OrchestrationV2SuggestNextPromptInput,
  OrchestrationV2SuggestNextPromptResult,
  RunId,
  ServerSettingsError,
  ThreadId,
} from "@supaterm/contracts";
import { sanitizeNextPrompt } from "@supaterm/provider-core/server/textGenerationUtils";
import * as Cache from "effect/Cache";
import * as Context from "effect/Context";
import * as Data from "effect/Data";
import * as DateTime from "effect/DateTime";
import * as Duration from "effect/Duration";
import * as Effect from "effect/Effect";
import * as Exit from "effect/Exit";
import * as Layer from "effect/Layer";
import * as Option from "effect/Option";

import * as ServerSettings from "../serverSettings.ts";
import type { OrchestratorV2Error } from "./Orchestrator.ts";
import * as PromptSuggestionHub from "./PromptSuggestionHub.ts";
import * as ThreadManagementService from "./ThreadManagementService.ts";

const NO_SUGGESTION: OrchestrationV2SuggestNextPromptResult = { suggestion: null };

const FRESHNESS = Duration.hours(6);

class SuggestionKey extends Data.Class<{
  readonly threadId: ThreadId;
  readonly runId: RunId;
}> {}

export class NextPromptSuggestionService extends Context.Service<
  NextPromptSuggestionService,
  {
    readonly suggest: (
      input: OrchestrationV2SuggestNextPromptInput,
    ) => Effect.Effect<
      OrchestrationV2SuggestNextPromptResult,
      OrchestratorV2Error | ServerSettingsError
    >;
  }
>()("supaterm/orchestration-v2/NextPromptSuggestionService") {}

const make = Effect.gen(function* () {
  const threads = yield* ThreadManagementService.ThreadManagementService;
  const serverSettings = yield* ServerSettings.ServerSettingsService;
  const providerPredictions = yield* PromptSuggestionHub.PromptSuggestionHub;

  const isAwaitingReply = Effect.fn("NextPromptSuggestionService.isAwaitingReply")(function* (
    key: SuggestionKey,
  ) {
    const shell = yield* threads.getThreadShell(key.threadId);
    const latestRunId = shell?.latestRunId ?? null;
    if (latestRunId === null || shell?.activeRunId !== null) return false;
    const { runs } = yield* threads.getThreadRecords(key.threadId, ["runs"], {
      runIds: latestRunId === key.runId ? [key.runId] : [key.runId, latestRunId],
    });
    const run = runs.find((candidate) => candidate.id === key.runId);
    const latest = runs.find((candidate) => candidate.id === latestRunId);
    if (run?.status !== "completed" || run.completedAt === null || latest === undefined)
      return false;
    const steeredPastLatest =
      latest.status === "cancelled" && latest.startedAt === null && run.ordinal < latest.ordinal;
    if (latest !== run && !steeredPastLatest) return false;
    const now = yield* DateTime.now;
    return DateTime.isGreaterThan(run.completedAt, DateTime.subtractDuration(now, FRESHNESS));
  });

  const predict = Effect.fn("NextPromptSuggestionService.predict")(function* (key: SuggestionKey) {
    const predicted = Option.getOrNull(yield* providerPredictions.await(key));
    return predicted === null ? null : sanitizeNextPrompt(predicted);
  });

  const suggestions = yield* Cache.makeWith(predict, {
    capacity: 256,
    timeToLive: (exit) => (Exit.isSuccess(exit) ? FRESHNESS : Duration.zero),
  });

  const suggest: NextPromptSuggestionService["Service"]["suggest"] = Effect.fn(
    "NextPromptSuggestionService.suggest",
  )(function* (input) {
    if (!(yield* serverSettings.getSettings).nextPromptSuggestionsEnabled) return NO_SUGGESTION;
    const key = new SuggestionKey({ threadId: input.threadId, runId: input.afterRunId });
    if (!(yield* isAwaitingReply(key))) return NO_SUGGESTION;
    return { suggestion: yield* Cache.get(suggestions, key) };
  });

  return NextPromptSuggestionService.of({ suggest });
});

export const layer = Layer.effect(NextPromptSuggestionService, make);
