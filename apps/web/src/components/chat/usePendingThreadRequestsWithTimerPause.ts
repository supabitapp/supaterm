import { useAtomValue } from "@effect/atom-react";
import {
  CommandId,
  type EnvironmentId,
  type OrchestrationV2Command,
  type ThreadId,
} from "@supaterm/contracts";
import {
  isAtomCommandInterrupted,
  squashAtomCommandFailure,
  type AtomCommandResult,
} from "@supaterm/client-runtime/state/runtime";
import { createUserInputAutoDismissPause } from "@supaterm/client-runtime/user-input-auto-dismiss-pause";
import { useState } from "react";
import { useStableCallback } from "../../hooks/useStableCallback";
import { randomUUID } from "../../lib/utils";
import type { PendingUserInputDraftAnswer } from "../../pendingUserInput";
import type { PendingUserInput } from "../../session-logic";
import { serverEnvironment } from "../../state/server";
import { threadEnvironment } from "../../state/threads";
import { useAtomCommand } from "../../state/use-atom-command";
import { usePendingThreadRequests } from "./usePendingThreadRequests";

type PendingThreadRequestsInput = Parameters<typeof usePendingThreadRequests>[0];

/** Pauses the auto-dismiss timer of the question the making render saw, once per question. */
function makeQuestionTimerPause(input: {
  readonly environmentId: EnvironmentId;
  readonly activeThreadId: ThreadId | null;
  readonly activePendingUserInput: PendingUserInput | null;
  readonly canPauseUserInputAutoDismiss: boolean;
  readonly pauseOnInteraction: ReturnType<typeof createUserInputAutoDismissPause>;
  readonly pauseUserInputAutoDismiss: (value: {
    readonly environmentId: EnvironmentId;
    readonly input: Extract<
      OrchestrationV2Command,
      { type: "thread.user-input.auto-dismiss.pause" }
    >;
  }) => Promise<AtomCommandResult<unknown, unknown>>;
  readonly setThreadError: PendingThreadRequestsInput["setThreadError"];
}) {
  return () => {
    const { environmentId, activeThreadId, activePendingUserInput } = input;
    if (
      !activePendingUserInput ||
      activePendingUserInput.autoDismissAt == null ||
      !activeThreadId ||
      !input.canPauseUserInputAutoDismiss
    )
      return;
    void input.pauseOnInteraction(
      {
        environmentId,
        threadId: activeThreadId,
        requestId: activePendingUserInput.requestId,
      },
      async () => {
        const result = await input.pauseUserInputAutoDismiss({
          environmentId,
          input: {
            type: "thread.user-input.auto-dismiss.pause",
            commandId: CommandId.make(randomUUID()),
            threadId: activeThreadId,
            requestId: activePendingUserInput.requestId,
          },
        });
        if (result._tag === "Failure" && !isAtomCommandInterrupted(result)) {
          const error = squashAtomCommandFailure(result);
          input.setThreadError(
            activeThreadId,
            error instanceof Error ? error.message : "Could not pause automatic dismissal.",
          );
        }
        return result._tag === "Success";
      },
    );
  };
}

/** Whether typing `value` changes a custom answer the question accepts. */
function changesPendingCustomAnswer(input: {
  readonly activePendingUserInput: PendingUserInput | null;
  readonly activePendingDraftAnswers: Record<string, PendingUserInputDraftAnswer>;
  readonly questionId: string;
  readonly value: string;
}) {
  const question = input.activePendingUserInput?.questions.find(
    (entry) => entry.id === input.questionId,
  );
  if (!question || question.allowCustomAnswer === false) return false;
  return input.value !== (input.activePendingDraftAnswers[input.questionId]?.customAnswer ?? "");
}

/**
 * Pending thread requests whose question countdown pauses on the user's first
 * answer, so a question the user is answering is not dismissed under them.
 */
export function usePendingThreadRequestsWithTimerPause(input: PendingThreadRequestsInput) {
  const requests = usePendingThreadRequests(input);
  const { environmentId, activeThreadId, setThreadError } = input;
  const { activePendingUserInput, activePendingDraftAnswers } = requests;
  const pauseUserInputAutoDismiss = useAtomCommand(threadEnvironment.pauseUserInputAutoDismiss, {
    reportFailure: false,
  });
  const questionTimerPermission = useAtomValue(
    threadEnvironment.pauseUserInputAutoDismiss.permissionAtom(environmentId, {
      type: "thread.user-input.auto-dismiss.pause",
    }),
  );
  const questionTimerConfig = useAtomValue(serverEnvironment.configValueAtom(environmentId));
  const supportsQuestionAutoDismiss =
    questionTimerConfig?.settings.autoDismissQuestions !== false && questionTimerConfig != null;
  const [pauseOnInteraction] = useState(createUserInputAutoDismissPause);
  const pauseActiveQuestionTimer = makeQuestionTimerPause({
    environmentId,
    activeThreadId,
    activePendingUserInput,
    canPauseUserInputAutoDismiss: questionTimerPermission && supportsQuestionAutoDismiss,
    pauseOnInteraction,
    pauseUserInputAutoDismiss,
    setThreadError,
  });

  const onSelectActivePendingUserInputOption = useStableCallback(
    (questionId: string, optionValue: string) => {
      pauseActiveQuestionTimer();
      requests.onSelectActivePendingUserInputOption(questionId, optionValue);
    },
  );
  const onChangeActivePendingUserInputCustomAnswer = (questionId: string, value: string) => {
    if (
      changesPendingCustomAnswer({
        activePendingUserInput,
        activePendingDraftAnswers,
        questionId,
        value,
      })
    )
      pauseActiveQuestionTimer();
    requests.onChangeActivePendingUserInputCustomAnswer(questionId, value);
  };

  return {
    ...requests,
    supportsQuestionAutoDismiss,
    onSelectActivePendingUserInputOption,
    onChangeActivePendingUserInputCustomAnswer,
  };
}
