import {
  EnvironmentId,
  NodeId,
  ProviderDriverKind,
  ProviderSessionId,
  RuntimeRequestId,
  ThreadId,
  TurnItemId,
  type OrchestrationV2ThreadProjection,
} from "@supaterm/contracts";
import * as Cause from "effect/Cause";
import * as DateTime from "effect/DateTime";
import { AsyncResult } from "effect/reactivity";
import { useLayoutEffect } from "react";
import { act, render as renderUi, type Screen } from "../../../test/render";
import { describe, expect, it, vi } from "vite-plus/test";

import { DraftId } from "../../composerDraftStore";
import { makeThreadProjectionFixture } from "../../test-fixtures";
import { usePendingThreadRequestsWithTimerPause } from "./usePendingThreadRequestsWithTimerPause";

const state = vi.hoisted(() => ({ pause: vi.fn(), command: vi.fn() }));
vi.mock(import("../../state/use-atom-command"), async (original) => {
  const { threadEnvironment } = await import("../../state/threads");
  return {
    ...(await original()),
    useAtomCommand: ((command: unknown) =>
      command === threadEnvironment.pauseUserInputAutoDismiss
        ? state.pause
        : state.command) as never,
  };
});
vi.mock(import("../../state/use-orchestration-command"), async (original) => ({
  ...(await original()),
  useOrchestrationCommand: (() => state.command) as never,
}));
vi.mock(import("../../state/threads"), async (original) => {
  const actual = await original();
  const { Atom } = await import("effect/reactivity");
  const granted = Atom.make(true);
  const pause = actual.threadEnvironment.pauseUserInputAutoDismiss;
  return {
    ...actual,
    threadEnvironment: Object.assign(Object.create(actual.threadEnvironment), {
      pauseUserInputAutoDismiss: Object.assign(Object.create(pause), {
        permissionAtom: () => granted,
      }),
    }),
  };
});
vi.mock(import("../../state/server"), async (original) => {
  const actual = await original();
  const { Atom } = await import("effect/reactivity");
  const config = Atom.make(() => ({ settings: { autoDismissQuestions: true } }));
  return {
    ...actual,
    serverEnvironment: { ...actual.serverEnvironment, configValueAtom: (() => config) as never },
  };
});

const environmentId = EnvironmentId.make("environment");
const threadId = ThreadId.make("thread");
const activeThread = { id: threadId };
let requestId: RuntimeRequestId;
let requestSequence = 0;
const nodeId = NodeId.make("question-node");
const askedAt = DateTime.makeUnsafe("2026-10-18T00:00:00.000Z");

type RuntimeRequest = OrchestrationV2ThreadProjection["runtimeRequests"][number];

function projection(overrides: Partial<RuntimeRequest> = {}) {
  const base = makeThreadProjectionFixture();
  const request: RuntimeRequest = {
    id: requestId,
    nodeId,
    providerTurnId: null,
    nativeRequestRef: {
      driver: ProviderDriverKind.make("claudeAgent"),
      nativeId: "question",
      strength: "strong",
    },
    kind: "user_input",
    status: "pending",
    responseCapability: { type: "live", providerSessionId: ProviderSessionId.make("session") },
    createdAt: askedAt,
    resolvedAt: null,
    ...overrides,
  };
  const item: OrchestrationV2ThreadProjection["turnItems"][number] = {
    id: TurnItemId.make("question-item"),
    threadId,
    runId: null,
    nodeId,
    providerThreadId: null,
    providerTurnId: null,
    nativeItemRef: null,
    parentItemId: null,
    ordinal: 0,
    status: "completed",
    title: null,
    startedAt: askedAt,
    completedAt: askedAt,
    updatedAt: askedAt,
    type: "user_input_request",
    requestId,
    questions: [
      {
        id: "scope",
        header: "Scope",
        question: "Which files?",
        options: [{ label: "All", description: "Every file", value: "all" }],
      },
      {
        id: "confirm",
        header: "Confirm",
        question: "Proceed?",
        allowCustomAnswer: false,
        options: [{ label: "Yes", description: "Go ahead", value: "yes" }],
      },
    ],
  };
  return {
    ...base,
    thread: { ...base.thread, id: threadId },
    runtimeRequests: [request],
    turnItems: [item],
  };
}

let screen: Screen;
let requests: ReturnType<typeof usePendingThreadRequestsWithTimerPause>;
const setThreadError = vi.fn();

function Probe({ serverProjection }: { serverProjection: OrchestrationV2ThreadProjection }) {
  const current = usePendingThreadRequestsWithTimerPause({
    environmentId,
    activeThreadId: threadId,
    activeThread,
    serverProjection,
    supportsQuestionAttachments: false,
    composerDraftTarget: DraftId.make("draft"),
    setComposerDraftPrompt: vi.fn(),
    promptRef: { current: "" },
    composerRef: { current: null },
    setThreadError,
  });
  useLayoutEffect(() => {
    requests = current;
  }, [current]);
  return null;
}

const render = (serverProjection: OrchestrationV2ThreadProjection) =>
  screen.rerender(<Probe serverProjection={serverProjection} />);
const typeAnswer = (questionId: string, value: string) =>
  act(() => requests.onChangeActivePendingUserInputCustomAnswer(questionId, value));
const chooseOption = (questionId: string, value: string) =>
  act(() => requests.onSelectActivePendingUserInputOption(questionId, value));
const flushPause = () => act(async () => {});

async function setupTest() {
  await using resources = new AsyncDisposableStack();

  vi.clearAllMocks();
  requestId = RuntimeRequestId.make(`question-${requestSequence++}`);
  state.pause.mockResolvedValue(AsyncResult.success(undefined));
  screen = resources.use(await renderUi(null, { router: false }));

  return resources.move();
}

describe("question countdown pause", () => {
  it("pauses the countdown once when the user starts typing an answer", async () => {
    await using _test = await setupTest();
    await render(projection());
    expect(requests.supportsQuestionAutoDismiss).toBe(true);
    await typeAnswer("scope", "src");
    await typeAnswer("scope", "src/web");
    await flushPause();
    expect(requests.activePendingDraftAnswers.scope?.customAnswer).toBe("src/web");
    expect(state.pause).toHaveBeenCalledOnce();
    expect(state.pause).toHaveBeenCalledWith({
      environmentId,
      input: expect.objectContaining({
        type: "thread.user-input.auto-dismiss.pause",
        threadId,
        requestId,
      }),
    });
  });

  it("pauses the countdown when the user chooses an option", async () => {
    await using _test = await setupTest();
    await render(projection());
    await chooseOption("confirm", "yes");
    await flushPause();
    expect(requests.activePendingDraftAnswers.confirm?.selectedOptionValues).toEqual(["yes"]);
    expect(state.pause).toHaveBeenCalledOnce();
  });

  it("keeps the countdown running for edits that change no answer", async () => {
    await using _test = await setupTest();
    await render(projection());
    const unchangedAnswer = requests.activePendingDraftAnswers.confirm?.customAnswer ?? "";
    expect(unchangedAnswer).toBe("");
    await typeAnswer("scope", "");
    expect(state.pause).not.toHaveBeenCalled();
    await typeAnswer("confirm", "typed into a choice-only question");
    await flushPause();
    expect(requests.activePendingDraftAnswers.confirm?.customAnswer ?? "").toBe(unchangedAnswer);
    expect(state.pause).not.toHaveBeenCalled();
  });

  it("never pauses a question that has no countdown", async () => {
    await using _test = await setupTest();
    await render(projection({ nativeRequestRef: null }));
    await typeAnswer("scope", "src");
    await chooseOption("confirm", "yes");
    await flushPause();
    expect(requests.activePendingDraftAnswers.scope?.customAnswer).toBe("src");
    expect(state.pause).not.toHaveBeenCalled();
  });

  it("shows a failed pause on the thread and tries again on the next answer", async () => {
    await using _test = await setupTest();
    state.pause.mockResolvedValue(AsyncResult.failure(Cause.fail(new Error("Pause rejected"))));
    await render(projection());
    await typeAnswer("scope", "src");
    await flushPause();
    expect(setThreadError).toHaveBeenCalledWith(threadId, "Pause rejected");
    await typeAnswer("scope", "src/web");
    await flushPause();
    expect(state.pause).toHaveBeenCalledTimes(2);
  });
});
