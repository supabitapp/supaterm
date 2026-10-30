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

// A suggestion is for a conversation the user is in the middle of, not an older thread they are
// browsing.
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

  // Checked on every request, cached answers included: the thread can move on at any time.
  const isAwaitingReply = Effect.fn("NextPromptSuggestionService.isAwaitingReply")(function* (
    key: SuggestionKey,
  ) {
    const shell = yield* threads.getThreadShell(key.threadId);
    if (shell?.latestRunId !== key.runId || shell.activeRunId !== null) return false;
    const { runs } = yield* threads.getThreadRecords(key.threadId, ["runs"], {
      runIds: [key.runId],
    });
    const run = runs[0];
    if (run?.status !== "completed" || run.completedAt === null) return false;
    const now = yield* DateTime.now;
    return DateTime.isGreaterThan(run.completedAt, DateTime.subtractDuration(now, FRESHNESS));
  });

  // Only Claude predicts next prompts, from the whole turn and its warm prompt cache. Other
  // providers have no prediction and get no suggestion.
  const predict = Effect.fn("NextPromptSuggestionService.predict")(function* (key: SuggestionKey) {
    const predicted = Option.getOrNull(yield* providerPredictions.await(key));
    return predicted === null ? null : sanitizeNextPrompt(predicted);
  });

  // Every client showing the thread asks about the same run; they share one wait for Claude. An
  // interrupted wait is not kept, so the next request waits again.
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
