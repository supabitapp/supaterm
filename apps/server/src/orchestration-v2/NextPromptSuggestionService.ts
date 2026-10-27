import { resolveProjectSettings } from "@supaterm/shared/projectSettings";
import type {
  OrchestrationV2SuggestNextPromptInput,
  OrchestrationV2SuggestNextPromptResult,
  RunId,
  ServerSettingsError,
  ThreadId,
} from "@supaterm/contracts";
import { formatThreadTitleContext } from "@supaterm/provider-core/server/threadTitleContext";
import { sanitizeNextPrompt } from "@supaterm/provider-core/server/textGenerationUtils";
import * as Cache from "effect/Cache";
import * as Cause from "effect/Cause";
import * as Context from "effect/Context";
import * as Data from "effect/Data";
import * as DateTime from "effect/DateTime";
import * as Duration from "effect/Duration";
import * as Effect from "effect/Effect";
import * as Exit from "effect/Exit";
import * as Layer from "effect/Layer";
import * as Option from "effect/Option";

import * as ServerSettings from "../serverSettings.ts";
import * as TextGeneration from "../textGeneration/TextGeneration.ts";
import type { OrchestratorV2Error } from "./Orchestrator.ts";
import * as ProjectStore from "./ProjectStore.ts";
import * as PromptSuggestionHub from "./PromptSuggestionHub.ts";
import * as ThreadManagementService from "./ThreadManagementService.ts";

const NO_SUGGESTION: OrchestrationV2SuggestNextPromptResult = { suggestion: null };

// A suggestion is for a conversation the user is in the middle of. Opening an older thread is
// browsing history, and must not spend the user's tokens.
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
  const projects = yield* ProjectStore.ProjectStoreV2;
  const serverSettings = yield* ServerSettings.ServerSettingsService;
  const textGeneration = yield* TextGeneration.TextGeneration;
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

  const generate = Effect.fn("NextPromptSuggestionService.generate")(function* (
    key: SuggestionKey,
  ) {
    // A provider that predicts for itself, like Claude, already saw the whole turn and reuses
    // its prompt cache, so its answer stands, including a decision not to suggest anything.
    const predicted = yield* providerPredictions.await(key);
    if (Option.isSome(predicted)) {
      return predicted.value === null ? null : sanitizeNextPrompt(predicted.value);
    }

    const projection = yield* threads.getThreadRecords(key.threadId, ["messages", "runs"], {
      messageRoles: ["user", "assistant"],
    });
    const rolledBack = new Set(
      projection.runs.filter((run) => run.status === "rolled_back").map((run) => run.id),
    );
    const messages = projection.messages.filter(
      (message) => !message.streaming && (message.runId === null || !rolledBack.has(message.runId)),
    );
    const latest = messages.at(-1);
    if (latest?.role !== "assistant" || latest.runId !== key.runId) return null;

    const project = yield* projects.get(projection.thread.projectId);
    if (Option.isNone(project)) return null;
    const settings = resolveProjectSettings(
      yield* serverSettings.getSettings,
      projection.thread.projectId,
    ).settings;
    const generated = yield* textGeneration.generateNextPrompt({
      cwd: projection.thread.worktreePath ?? project.value.workspaceRoot,
      conversation: formatThreadTitleContext(messages).message,
      modelSelection: settings.textGenerationModelSelection,
    });
    return generated.suggestion;
  });

  // Every client showing the thread asks about the same run; they share one model call. A
  // failure is not kept, so the next request tries again.
  const suggestions = yield* Cache.makeWith(generate, {
    capacity: 256,
    timeToLive: (exit) => (Exit.isSuccess(exit) ? FRESHNESS : Duration.zero),
  });

  const suggest: NextPromptSuggestionService["Service"]["suggest"] = Effect.fn(
    "NextPromptSuggestionService.suggest",
  )(function* (input) {
    if (!(yield* serverSettings.getSettings).nextPromptSuggestionsEnabled) return NO_SUGGESTION;
    const key = new SuggestionKey({ threadId: input.threadId, runId: input.afterRunId });
    if (!(yield* isAwaitingReply(key))) return NO_SUGGESTION;
    return yield* Cache.get(suggestions, key).pipe(
      Effect.map((suggestion) => ({ suggestion })),
      // A missing hint costs the user nothing; an error toast on every reply would.
      Effect.catchCause((cause) =>
        Cause.hasInterruptsOnly(cause)
          ? Effect.interrupt
          : Effect.logWarning("Next prompt suggestion failed", {
              threadId: input.threadId,
              cause,
            }).pipe(Effect.as(NO_SUGGESTION)),
      ),
    );
  });

  return NextPromptSuggestionService.of({ suggest });
});

export const layer = Layer.effect(NextPromptSuggestionService, make);
