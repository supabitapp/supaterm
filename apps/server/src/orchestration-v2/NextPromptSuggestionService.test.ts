import { assert, describe, it, vi } from "@effect/vitest";
import {
  MessageId,
  type OrchestrationV2ConversationMessage,
  type OrchestrationV2Run,
  type OrchestrationV2RunStatus,
  type OrchestrationV2ThreadProjection,
  ProjectId,
  ProviderInstanceId,
  RunId,
  TextGenerationError,
  ThreadId,
} from "@supaterm/contracts";
import * as DateTime from "effect/DateTime";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";
import * as Option from "effect/Option";
import { TestClock } from "effect/testing";

import * as ServerSettings from "../serverSettings.ts";
import * as TextGeneration from "../textGeneration/TextGeneration.ts";
import * as NextPromptSuggestion from "./NextPromptSuggestionService.ts";
import type { ProjectionRecordFilter } from "./ProjectionStore.ts";
import * as ProjectStore from "./ProjectStore.ts";
import * as ThreadManagement from "./ThreadManagementService.ts";

const NOW = "2026-10-27T12:00:00.000Z";
const threadId = ThreadId.make("thread:next-prompt");
const projectId = ProjectId.make("project:next-prompt");
const projectModel = {
  instanceId: ProviderInstanceId.make("claudeAgent"),
  model: "claude-haiku-5-5",
} as const;

interface Turn {
  readonly id: string;
  readonly user: string;
  readonly assistant?: string;
  readonly status?: OrchestrationV2RunStatus;
  readonly completedAt?: string;
}

function threadRecords(turns: ReadonlyArray<Turn>) {
  const runs = turns.map(
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
  );
  const messages = turns.flatMap((turn, index) => {
    const at = DateTime.makeUnsafe(Date.parse(NOW) - (turns.length - index) * 60_000);
    const message = (role: "user" | "assistant", text: string) =>
      ({
        id: MessageId.make(`${turn.id}:${role}`),
        threadId,
        runId: RunId.make(turn.id),
        nodeId: null,
        role,
        text,
        attachments: [],
        streaming: false,
        createdAt: at,
        updatedAt: at,
      }) as unknown as OrchestrationV2ConversationMessage;
    return [
      message("user", turn.user),
      ...(turn.assistant === undefined ? [] : [message("assistant", turn.assistant)]),
    ];
  });
  return {
    thread: { id: threadId, projectId, worktreePath: "/repo/.worktrees/next-prompt" },
    messages,
    runs,
  } as unknown as OrchestrationV2ThreadProjection;
}

function makeLayer(options: {
  readonly turns: ReadonlyArray<Turn>;
  readonly enabled?: boolean;
  readonly generate?: TextGeneration.TextGeneration["Service"]["generateNextPrompt"];
}) {
  const projection = threadRecords(options.turns);
  const getThreadRecords = (
    _threadId: ThreadId,
    _fields: unknown,
    filter?: ProjectionRecordFilter,
  ) =>
    Effect.succeed({
      ...projection,
      messages: projection.messages.filter(
        (message) =>
          (filter?.messageIds === undefined || filter.messageIds.includes(message.id)) &&
          (filter?.messageRoles === undefined || filter.messageRoles.includes(message.role)),
      ),
      runs: projection.runs.filter(
        (run) => filter?.runIds === undefined || filter.runIds.includes(run.id),
      ),
    });
  const generateNextPrompt = vi.fn(
    options.generate ?? (() => Effect.succeed({ suggestion: "yes, score rows on the same shots" })),
  );
  const layer = NextPromptSuggestion.layer.pipe(
    Layer.provide(
      Layer.mergeAll(
        Layer.mock(ThreadManagement.ThreadManagementService)({
          getThreadRecords:
            getThreadRecords as ThreadManagement.ThreadManagementService["Service"]["getThreadRecords"],
        }),
        Layer.mock(ProjectStore.ProjectStoreV2)({
          get: () => Effect.succeed(Option.some({ projectId, workspaceRoot: "/repo" } as never)),
        }),
        Layer.mock(TextGeneration.TextGeneration)({ generateNextPrompt }),
        ServerSettings.layerTest({
          nextPromptSuggestionsEnabled: options.enabled ?? true,
          projectSettingsOverrides: { [projectId]: { textGenerationModelSelection: projectModel } },
        }),
      ),
    ),
  );
  return { layer, generateNextPrompt };
}

const suggest = (afterMessageId: string) =>
  Effect.gen(function* () {
    yield* TestClock.setTime(Date.parse(NOW));
    const service = yield* NextPromptSuggestion.NextPromptSuggestionService;
    return yield* service.suggest({ threadId, afterMessageId: MessageId.make(afterMessageId) });
  });

const answeredTurns: ReadonlyArray<Turn> = [
  { id: "run-1", user: "Compare the two pipelines.", assistant: "Ring + cues wins overall." },
  {
    id: "run-2",
    user: "Why does the table disagree?",
    assistant: "Rows were scored on different shots. Should I score them on the same shots?",
  },
];

describe("NextPromptSuggestionService", () => {
  it.effect("predicts a reply to the assistant's latest message with the project's model", () => {
    const { layer, generateNextPrompt } = makeLayer({ turns: answeredTurns });
    return Effect.gen(function* () {
      const result = yield* suggest("run-2:assistant");

      assert.deepStrictEqual(result, { suggestion: "yes, score rows on the same shots" });
      assert.strictEqual(generateNextPrompt.mock.calls.length, 1);
      const input = generateNextPrompt.mock.calls[0]![0];
      assert.deepStrictEqual(input.modelSelection, projectModel);
      assert.strictEqual(input.cwd, "/repo/.worktrees/next-prompt");
      assert.ok(input.conversation.includes("Compare the two pipelines."));
      assert.ok(
        input.conversation.trimEnd().endsWith("Should I score them on the same shots?"),
        input.conversation,
      );
    }).pipe(Effect.provide(layer));
  });

  it.effect("shares one model call between clients asking about the same reply", () => {
    const { layer, generateNextPrompt } = makeLayer({ turns: answeredTurns });
    return Effect.gen(function* () {
      const results = yield* Effect.all([suggest("run-2:assistant"), suggest("run-2:assistant")], {
        concurrency: "unbounded",
      });
      const again = yield* suggest("run-2:assistant");

      assert.deepStrictEqual(
        [...results, again].map((result) => result.suggestion),
        [
          "yes, score rows on the same shots",
          "yes, score rows on the same shots",
          "yes, score rows on the same shots",
        ],
      );
      assert.strictEqual(generateNextPrompt.mock.calls.length, 1);
    }).pipe(Effect.provide(layer));
  });

  it.effect("does not call a model when suggestions are turned off", () => {
    const { layer, generateNextPrompt } = makeLayer({ turns: answeredTurns, enabled: false });
    return Effect.gen(function* () {
      assert.deepStrictEqual(yield* suggest("run-2:assistant"), { suggestion: null });
      assert.strictEqual(generateNextPrompt.mock.calls.length, 0);
    }).pipe(Effect.provide(layer));
  });

  it.effect("does not call a model for a reply the user has already answered", () => {
    const { layer, generateNextPrompt } = makeLayer({
      turns: [...answeredTurns, { id: "run-3", user: "Yes, do it.", assistant: "Done." }],
    });
    return Effect.gen(function* () {
      assert.deepStrictEqual(yield* suggest("run-2:assistant"), { suggestion: null });
      assert.strictEqual(generateNextPrompt.mock.calls.length, 0);
    }).pipe(Effect.provide(layer));
  });

  it.effect("does not call a model while a newer run is still working", () => {
    const { layer, generateNextPrompt } = makeLayer({
      turns: [...answeredTurns, { id: "run-3", user: "Yes, do it.", status: "running" }],
    });
    return Effect.gen(function* () {
      assert.deepStrictEqual(yield* suggest("run-2:assistant"), { suggestion: null });
      assert.strictEqual(generateNextPrompt.mock.calls.length, 0);
    }).pipe(Effect.provide(layer));
  });

  it.effect("does not call a model for a reply whose run did not complete", () => {
    const { layer, generateNextPrompt } = makeLayer({
      turns: [answeredTurns[0]!, { ...answeredTurns[1]!, status: "interrupted" }],
    });
    return Effect.gen(function* () {
      assert.deepStrictEqual(yield* suggest("run-2:assistant"), { suggestion: null });
      assert.strictEqual(generateNextPrompt.mock.calls.length, 0);
    }).pipe(Effect.provide(layer));
  });

  it.effect("does not call a model when reopening a thread that finished long ago", () => {
    const { layer, generateNextPrompt } = makeLayer({
      turns: [answeredTurns[0]!, { ...answeredTurns[1]!, completedAt: "2026-10-26T12:00:00.000Z" }],
    });
    return Effect.gen(function* () {
      assert.deepStrictEqual(yield* suggest("run-2:assistant"), { suggestion: null });
      assert.strictEqual(generateNextPrompt.mock.calls.length, 0);
    }).pipe(Effect.provide(layer));
  });

  it.effect("answers with no suggestion when the model fails", () => {
    const { layer } = makeLayer({
      turns: answeredTurns,
      generate: () =>
        Effect.fail(new TextGenerationError({ operation: "generateNextPrompt", detail: "boom" })),
    });
    return Effect.gen(function* () {
      assert.deepStrictEqual(yield* suggest("run-2:assistant"), { suggestion: null });
    }).pipe(Effect.provide(layer));
  });
});
