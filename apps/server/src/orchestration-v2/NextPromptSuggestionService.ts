import { resolveProjectSettings } from "@supaterm/shared/projectSettings";
import type {
  OrchestrationV2RunStatus,
  OrchestrationV2SuggestNextPromptInput,
  OrchestrationV2SuggestNextPromptResult,
  RunId,
  ServerSettingsError,
  ThreadId,
} from "@supaterm/contracts";
import { formatThreadTitleContext } from "@supaterm/provider-core/server/threadTitleContext";
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
import * as ThreadManagementService from "./ThreadManagementService.ts";

const NO_SUGGESTION: OrchestrationV2SuggestNextPromptResult = { suggestion: null };
const ACTIVE_RUN_STATUSES: ReadonlySet<OrchestrationV2RunStatus> = new Set([
  "preparing",
  "queued",
  "starting",
  "running",
  "waiting",
]);

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
      OrchestratorV2Error | ProjectStore.ProjectStoreV2Error | ServerSettingsError
    >;
  }
>()("supaterm/orchestration-v2/NextPromptSuggestionService") {}

const make = Effect.gen(function* () {
  const threads = yield* ThreadManagementService.ThreadManagementService;
  const projects = yield* ProjectStore.ProjectStoreV2;
  const serverSettings = yield* ServerSettings.ServerSettingsService;
  const textGeneration = yield* TextGeneration.TextGeneration;

  const isFreshCompletedRun = Effect.fn("NextPromptSuggestionService.isFreshCompletedRun")(
    function* (key: SuggestionKey) {
      const { runs } = yield* threads.getThreadRecords(key.threadId, ["runs"], {
        runIds: [key.runId],
      });
      const run = runs[0];
      if (run?.status !== "completed" || run.completedAt === null) return false;
      const now = yield* DateTime.now;
      return DateTime.isGreaterThan(run.completedAt, DateTime.subtractDuration(now, FRESHNESS));
    },
  );

  const generate = Effect.fn("NextPromptSuggestionService.generate")(function* (
    key: SuggestionKey,
  ) {
    // Checked on the one run first, so opening an old thread never loads its whole history.
    if (!(yield* isFreshCompletedRun(key))) return NO_SUGGESTION;

    const projection = yield* threads.getThreadRecords(key.threadId, ["messages", "runs"], {
      messageRoles: ["user", "assistant"],
    });
    if (projection.runs.some((run) => ACTIVE_RUN_STATUSES.has(run.status))) return NO_SUGGESTION;
    const rolledBack = new Set(
      projection.runs.filter((run) => run.status === "rolled_back").map((run) => run.id),
    );
    const messages = projection.messages.filter(
      (message) => !message.streaming && (message.runId === null || !rolledBack.has(message.runId)),
    );
    const latest = messages.at(-1);
    if (latest?.role !== "assistant" || latest.runId !== key.runId) return NO_SUGGESTION;

    const project = yield* projects.get(projection.thread.projectId);
    if (Option.isNone(project)) return NO_SUGGESTION;
    const settings = resolveProjectSettings(
      yield* serverSettings.getSettings,
      projection.thread.projectId,
    ).settings;

    return yield* textGeneration
      .generateNextPrompt({
        cwd: projection.thread.worktreePath ?? project.value.workspaceRoot,
        conversation: formatThreadTitleContext(messages).message,
        modelSelection: settings.textGenerationModelSelection,
      })
      .pipe(
        // A missing hint costs the user nothing; an error toast on every reply would.
        Effect.catchCause((cause) =>
          Cause.hasInterruptsOnly(cause)
            ? Effect.interrupt
            : Effect.logWarning("Next prompt suggestion failed", {
                threadId: key.threadId,
                cause,
              }).pipe(Effect.as(NO_SUGGESTION)),
        ),
      );
  });

  // Every client showing the thread asks about the same run; they share one model call.
  const suggestions = yield* Cache.makeWith(generate, {
    capacity: 256,
    timeToLive: (exit) => (Exit.isSuccess(exit) ? FRESHNESS : Duration.zero),
  });

  const suggest: NextPromptSuggestionService["Service"]["suggest"] = Effect.fn(
    "NextPromptSuggestionService.suggest",
  )(function* (input) {
    if (!(yield* serverSettings.getSettings).nextPromptSuggestionsEnabled) return NO_SUGGESTION;
    return yield* Cache.get(
      suggestions,
      new SuggestionKey({ threadId: input.threadId, runId: input.afterRunId }),
    );
  });

  return NextPromptSuggestionService.of({ suggest });
});

export const layer = Layer.effect(NextPromptSuggestionService, make);
