import { assert, describe, it } from "@effect/vitest";
import {
  type OrchestrationV2Run,
  type OrchestrationV2RunStatus,
  type OrchestrationV2ThreadShell,
  ProviderDriverKind,
  RunId,
  ThreadId,
} from "@supaterm/contracts";
import * as DateTime from "effect/DateTime";
import * as Effect from "effect/Effect";
import * as Fiber from "effect/Fiber";
import * as Layer from "effect/Layer";
import { TestClock } from "effect/testing";

import * as ServerSettings from "../serverSettings.ts";
import * as NextPromptSuggestion from "./NextPromptSuggestionService.ts";
import type { ProjectionRecordFilter } from "./ProjectionStore.ts";
import * as PromptSuggestionHub from "./PromptSuggestionHub.ts";
import * as ThreadManagement from "./ThreadManagementService.ts";

const NOW = "2026-10-27T12:00:00.000Z";
const threadId = ThreadId.make("thread:next-prompt");

const ACTIVE_STATUSES: ReadonlySet<OrchestrationV2RunStatus> = new Set([
  "preparing",
  "queued",
  "starting",
  "running",
  "waiting",
]);

interface Turn {
  readonly id: string;
  readonly status?: OrchestrationV2RunStatus;
  readonly completedAt?: string;
}

function makeLayer(options: { readonly turns: ReadonlyArray<Turn>; readonly enabled?: boolean }) {
  let turns = options.turns;
  const getThreadShell = () => {
    const latest = turns.at(-1);
    const latestStatus = latest?.status ?? "completed";
    return Effect.succeed({
      latestRunId: latest === undefined ? null : RunId.make(latest.id),
      activeRunId:
        latest !== undefined && ACTIVE_STATUSES.has(latestStatus) ? RunId.make(latest.id) : null,
    } as OrchestrationV2ThreadShell);
  };
  const getThreadRecords = (
    _threadId: ThreadId,
    _fields: unknown,
    filter?: ProjectionRecordFilter,
  ) =>
    Effect.succeed({
      runs: turns
        .map(
          (turn) =>
            ({
              id: RunId.make(turn.id),
              threadId,
              status: turn.status ?? "completed",
              completedAt:
                (turn.status ?? "completed") === "completed"
                  ? DateTime.makeUnsafe(turn.completedAt ?? NOW)
                  : null,
            }) as OrchestrationV2Run,
        )
        .filter((run) => filter?.runIds === undefined || filter.runIds.includes(run.id)),
    });
  const layer = NextPromptSuggestion.layer.pipe(
    Layer.provideMerge(PromptSuggestionHub.layer),
    Layer.provide(
      Layer.mergeAll(
        Layer.mock(ThreadManagement.ThreadManagementService)({
          getThreadShell,
          getThreadRecords:
            getThreadRecords as unknown as ThreadManagement.ThreadManagementService["Service"]["getThreadRecords"],
        }),
        ServerSettings.layerTest({ nextPromptSuggestionsEnabled: options.enabled ?? true }),
      ),
    ),
  );
  return {
    layer,
    setTurns: (next: ReadonlyArray<Turn>) => {
      turns = next;
    },
  };
}

const suggest = (afterRunId: string) =>
  Effect.gen(function* () {
    yield* TestClock.setTime(Date.parse(NOW));
    const service = yield* NextPromptSuggestion.NextPromptSuggestionService;
    return yield* service.suggest({ threadId, afterRunId: RunId.make(afterRunId) });
  });

const claudeRun = {
  driver: ProviderDriverKind.make("claudeAgent"),
  threadId,
  runId: RunId.make("run-2"),
} as const;

const predict = (suggestion: string) =>
  Effect.gen(function* () {
    const predictions = yield* PromptSuggestionHub.PromptSuggestionHub;
    yield* predictions.offer({ type: "prompt_suggestion.expected", ...claudeRun });
    yield* predictions.offer({ type: "prompt_suggestion.ready", ...claudeRun, suggestion });
  });

const answeredTurns: ReadonlyArray<Turn> = [{ id: "run-1" }, { id: "run-2" }];

describe("NextPromptSuggestionService", () => {
  it.effect("waits for Claude's own prediction of the reply", () => {
    const { layer } = makeLayer({ turns: answeredTurns });
    return Effect.gen(function* () {
      const predictions = yield* PromptSuggestionHub.PromptSuggestionHub;
      yield* predictions.offer({ type: "prompt_suggestion.expected", ...claudeRun });
      const pending = yield* Effect.forkChild(suggest("run-2"), { startImmediately: true });
      yield* predictions.offer({
        type: "prompt_suggestion.ready",
        ...claudeRun,
        suggestion: ' "score them on the same shots" ',
      });

      assert.deepStrictEqual(yield* Fiber.join(pending), {
        suggestion: "score them on the same shots",
      });
    }).pipe(Effect.provide(layer));
  });

  it.effect("suggests nothing for a provider that does not predict", () => {
    const { layer } = makeLayer({ turns: answeredTurns });
    return Effect.gen(function* () {
      assert.deepStrictEqual(yield* suggest("run-2"), { suggestion: null });
    }).pipe(Effect.provide(layer));
  });

  it.effect("respects Claude declining to predict, without making later clients wait", () => {
    const { layer } = makeLayer({ turns: answeredTurns });
    return Effect.gen(function* () {
      const predictions = yield* PromptSuggestionHub.PromptSuggestionHub;
      yield* predictions.offer({ type: "prompt_suggestion.expected", ...claudeRun });
      const pending = yield* Effect.forkChild(
        Effect.all([suggest("run-2"), suggest("run-2")], { concurrency: "unbounded" }),
        { startImmediately: true },
      );
      yield* TestClock.adjust("21 seconds");

      assert.deepStrictEqual(yield* Fiber.join(pending), [
        { suggestion: null },
        { suggestion: null },
      ]);
      assert.deepStrictEqual(yield* suggest("run-2"), { suggestion: null });
    }).pipe(Effect.provide(layer));
  });

  it.effect("suggests nothing when suggestions are turned off", () => {
    const { layer } = makeLayer({ turns: answeredTurns, enabled: false });
    return Effect.gen(function* () {
      yield* predict("yes, do it");
      assert.deepStrictEqual(yield* suggest("run-2"), { suggestion: null });
    }).pipe(Effect.provide(layer));
  });

  it.effect("suggests nothing for a reply the user has already answered", () => {
    const { layer } = makeLayer({ turns: [...answeredTurns, { id: "run-3" }] });
    return Effect.gen(function* () {
      yield* predict("yes, do it");
      assert.deepStrictEqual(yield* suggest("run-2"), { suggestion: null });
    }).pipe(Effect.provide(layer));
  });

  it.effect("suggests nothing while a newer run is still working", () => {
    const { layer } = makeLayer({ turns: [...answeredTurns, { id: "run-3", status: "running" }] });
    return Effect.gen(function* () {
      yield* predict("yes, do it");
      assert.deepStrictEqual(yield* suggest("run-2"), { suggestion: null });
    }).pipe(Effect.provide(layer));
  });

  it.effect("suggests nothing for a reply whose run did not complete", () => {
    const { layer } = makeLayer({
      turns: [{ id: "run-1" }, { id: "run-2", status: "interrupted" }],
    });
    return Effect.gen(function* () {
      yield* predict("yes, do it");
      assert.deepStrictEqual(yield* suggest("run-2"), { suggestion: null });
    }).pipe(Effect.provide(layer));
  });

  it.effect("suggests nothing when reopening a thread that finished long ago", () => {
    const { layer } = makeLayer({
      turns: [{ id: "run-1" }, { id: "run-2", completedAt: "2026-10-26T12:00:00.000Z" }],
    });
    return Effect.gen(function* () {
      yield* predict("yes, do it");
      assert.deepStrictEqual(yield* suggest("run-2"), { suggestion: null });
    }).pipe(Effect.provide(layer));
  });

  it.effect("stops offering a kept suggestion once the thread moves on", () => {
    const { layer, setTurns } = makeLayer({ turns: answeredTurns });
    return Effect.gen(function* () {
      yield* predict("yes, do it");
      assert.deepStrictEqual(yield* suggest("run-2"), { suggestion: "yes, do it" });
      setTurns([...answeredTurns, { id: "run-3", status: "queued" }]);

      assert.deepStrictEqual(yield* suggest("run-2"), { suggestion: null });
    }).pipe(Effect.provide(layer));
  });
});
