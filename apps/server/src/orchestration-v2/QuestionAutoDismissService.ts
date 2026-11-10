import { CommandId, USER_INPUT_AUTO_DISMISS_TIMEOUT_MS } from "@supaterm/contracts";
import * as Context from "effect/Context";
import * as SecureRandom from "effect/crypto/SecureRandom";
import * as DateTime from "effect/DateTime";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";

import * as Scheduler from "../scheduling/Scheduler.ts";
import * as ThreadManagement from "./ThreadManagementService.ts";
import * as ProjectionStore from "./ProjectionStore.ts";

export class QuestionAutoDismissService extends Context.Service<
  QuestionAutoDismissService,
  {
    readonly sweep: Effect.Effect<void, ProjectionStore.ProjectionStoreV2Error>;
  }
>()("supaterm/orchestration-v2/QuestionAutoDismissService") {}

const make = Effect.gen(function* () {
  const projections = yield* ProjectionStore.ProjectionStoreV2;
  const random = yield* SecureRandom.SecureRandom;
  const threads = yield* ThreadManagement.ThreadManagementService;

  const sweep = Effect.gen(function* () {
    const now = yield* DateTime.now;
    const requests = yield* projections.getQuestionAutoDismissCandidates(
      DateTime.subtract(now, { milliseconds: USER_INPUT_AUTO_DISMISS_TIMEOUT_MS }),
    );

    for (const request of requests) {
      const { threadId, requestId, deadline } = request;
      const attemptId = yield* random.uuidV4();
      yield* threads
        .dispatch({
          type: "thread.user-input.auto-dismiss",
          commandId: CommandId.make(
            `question-auto-dismiss:${requestId}:${DateTime.toEpochMillis(deadline)}:${attemptId}`,
          ),
          threadId,
          requestId,
          deadline,
        })
        .pipe(
          Effect.catch((cause) =>
            Effect.logWarning("Question automatic dismissal failed", {
              threadId,
              requestId,
              cause,
            }),
          ),
        );
    }
  });

  return QuestionAutoDismissService.of({ sweep });
});

export const layer = Layer.effect(QuestionAutoDismissService, make);

export const layerWorker = Layer.effectDiscard(
  Effect.gen(function* () {
    const questions = yield* QuestionAutoDismissService;
    const scheduler = yield* Scheduler.Scheduler;
    yield* scheduler.register("question-auto-dismiss", questions.sweep);
  }),
);
