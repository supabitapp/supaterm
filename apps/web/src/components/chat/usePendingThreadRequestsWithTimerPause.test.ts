import { EnvironmentId, RuntimeRequestId, ThreadId } from "@supaterm/contracts";
import { createUserInputAutoDismissPause } from "@supaterm/client-runtime/user-input-auto-dismiss-pause";
import * as Cause from "effect/Cause";
import { AsyncResult } from "effect/reactivity";
import { describe, expect, it, vi } from "vite-plus/test";
import type { PendingUserInput } from "../../session-logic";
import {
  changesPendingCustomAnswer,
  makeQuestionTimerPause,
} from "./usePendingThreadRequestsWithTimerPause";

const environmentId = EnvironmentId.make("env");
const threadId = ThreadId.make("thread");

function question(overrides: Partial<PendingUserInput["questions"][number]> = {}) {
  return {
    id: "scope",
    header: "Scope",
    question: "Which scope?",
    options: [{ label: "All", description: "Everything" }],
    multiSelect: false,
    ...overrides,
  };
}

function pendingInput(overrides: Partial<PendingUserInput> = {}): PendingUserInput {
  return {
    requestId: RuntimeRequestId.make("question"),
    createdAt: "2026-10-18T00:00:00.000Z",
    questions: [question()],
    responseCapability: "live",
    dismissible: true,
    autoDismissAt: "2026-10-18T00:05:00.000Z",
    ...overrides,
  };
}

function timerPause(
  overrides: Partial<Parameters<typeof makeQuestionTimerPause>[0]> = {},
  result:
    | AsyncResult.Success<unknown, unknown>
    | AsyncResult.Failure<unknown, unknown> = AsyncResult.success(undefined),
) {
  const pauseUserInputAutoDismiss = vi.fn(async () => result);
  const setThreadError = vi.fn();
  const pause = makeQuestionTimerPause({
    environmentId,
    activeThreadId: threadId,
    activePendingUserInput: pendingInput(),
    canPauseUserInputAutoDismiss: true,
    pauseOnInteraction: createUserInputAutoDismissPause(),
    pauseUserInputAutoDismiss,
    setThreadError,
    ...overrides,
  });
  return { pause, pauseUserInputAutoDismiss, setThreadError };
}

describe("question timer pause", () => {
  it("pauses the active question's countdown once across repeated interactions", async () => {
    const { pause, pauseUserInputAutoDismiss } = timerPause();
    pause();
    pause();
    await vi.waitFor(() => expect(pauseUserInputAutoDismiss).toHaveBeenCalledTimes(1));
    expect(pauseUserInputAutoDismiss).toHaveBeenCalledWith({
      environmentId,
      input: expect.objectContaining({
        type: "thread.user-input.auto-dismiss.pause",
        threadId,
        requestId: RuntimeRequestId.make("question"),
      }),
    });
  });

  it.each([
    [
      "the question has no countdown",
      { activePendingUserInput: pendingInput({ autoDismissAt: null }) },
    ],
    ["nothing is pending", { activePendingUserInput: null }],
    ["the thread is not on the server yet", { activeThreadId: null }],
    [
      "the connection cannot pause or the server disables auto-dismiss",
      { canPauseUserInputAutoDismiss: false },
    ],
  ])("leaves the countdown alone when %s", async (_, overrides) => {
    const { pause, pauseUserInputAutoDismiss } = timerPause(overrides);
    pause();
    await Promise.resolve();
    expect(pauseUserInputAutoDismiss).not.toHaveBeenCalled();
  });

  it("shows a failed pause on the thread and retries on the next interaction", async () => {
    const { pause, pauseUserInputAutoDismiss, setThreadError } = timerPause(
      {},
      AsyncResult.failure(Cause.fail(new Error("Pause rejected"))),
    );
    pause();
    await vi.waitFor(() => expect(setThreadError).toHaveBeenCalledWith(threadId, "Pause rejected"));
    pause();
    await vi.waitFor(() => expect(pauseUserInputAutoDismiss).toHaveBeenCalledTimes(2));
  });

  it("does not report an interrupted pause", async () => {
    const { pause, pauseUserInputAutoDismiss, setThreadError } = timerPause(
      {},
      AsyncResult.failure(Cause.interrupt()),
    );
    pause();
    await vi.waitFor(() => expect(pauseUserInputAutoDismiss).toHaveBeenCalledTimes(1));
    await Promise.resolve();
    expect(setThreadError).not.toHaveBeenCalled();
  });
});

describe("custom answer changes", () => {
  const drafts = { scope: { customAnswer: "src" } };

  it("counts only edits that change a custom answer the question accepts", () => {
    const change = (value: string, input = pendingInput(), questionId = "scope") =>
      changesPendingCustomAnswer({
        activePendingUserInput: input,
        activePendingDraftAnswers: drafts,
        questionId,
        value,
      });
    expect(change("src/web")).toBe(true);
    expect(change("src")).toBe(false);
    expect(change("x", pendingInput({ questions: [question({ allowCustomAnswer: false })] }))).toBe(
      false,
    );
    expect(change("x", pendingInput(), "missing")).toBe(false);
    expect(
      changesPendingCustomAnswer({
        activePendingUserInput: null,
        activePendingDraftAnswers: drafts,
        questionId: "scope",
        value: "x",
      }),
    ).toBe(false);
  });

  it("treats a first keystroke on an empty answer as a change", () => {
    expect(
      changesPendingCustomAnswer({
        activePendingUserInput: pendingInput(),
        activePendingDraftAnswers: {},
        questionId: "scope",
        value: "a",
      }),
    ).toBe(true);
  });
});
