import { describe, expect, it } from "vite-plus/test";

import {
  expireComposerStop,
  requestComposerStop,
  resolveComposerPrimaryAction,
  stepComposerStop,
  type ComposerPrimaryAction,
  type ComposerPrimaryActionBlock,
  type ComposerPrimaryActionInput,
  type ComposerStopPhase,
} from "./composerPrimaryAction.logic";

const idle: ComposerPrimaryActionInput = {
  pendingAction: null,
  canOperateThread: true,
  canQueueMessage: true,
  canInterrupt: false,
  canResume: false,
  isRunning: false,
  followUpBehavior: "steer",
  canSteer: true,
  alternateModifier: false,
  isEditingQueuedMessage: false,
  hasSendableContent: true,
  isSendBusy: false,
  isPreparingWorktree: false,
  sendDisabledReason: null,
  isEnvironmentUnavailable: false,
  providerAvailability: "ready",
  isProjectSelectionRequired: false,
  stopPhase: "idle",
};
const running = { isRunning: true, canInterrupt: true };
const emptyDraft = { hasSendableContent: false };
const resumable = { canResume: true, ...emptyDraft };
const question = {
  questionIndex: 0,
  isLastQuestion: true,
  canAdvance: true,
  isComplete: true,
  response: "ready",
} as const;

type Expected = {
  kind: ComposerPrimaryAction["kind"];
  blocked?: ComposerPrimaryActionBlock["reason"];
  busy?: true;
  stop?: ComposerPrimaryAction["stop"];
  guarded?: true;
};

describe("resolveComposerPrimaryAction", () => {
  it.each<[string, Partial<ComposerPrimaryActionInput>, Expected]>([
    ["sends a draft on an idle thread", {}, { kind: "send" }],
    [
      "has nothing to send from an empty draft",
      emptyDraft,
      { kind: "send", blocked: "nothing-to-send" },
    ],
    ["steers the running turn by default", running, { kind: "steer" }],
    [
      "queues instead while the alternate modifier is held",
      { ...running, alternateModifier: true },
      { kind: "queue" },
    ],
    [
      "queues while the turn cannot take steering",
      { ...running, canSteer: false },
      { kind: "queue" },
    ],
    [
      "stops the running turn once the draft is empty",
      { ...running, ...emptyDraft },
      { kind: "stop" },
    ],
    ["resumes a paused thread from an empty draft", resumable, { kind: "resume" }],
    ["sends rather than resumes once there is a draft", { canResume: true }, { kind: "send" }],
    [
      "saves a queued-message edit rather than stopping or resuming",
      { ...running, ...resumable, isEditingQueuedMessage: true },
      { kind: "update-queued", blocked: "nothing-to-send" },
    ],
    [
      "answers a pending question before anything else",
      { ...running, ...resumable, pendingAction: question },
      { kind: "answer" },
    ],
    [
      "waits for the last answer to be complete",
      { pendingAction: { ...question, isComplete: false } },
      { kind: "answer", blocked: "answer-incomplete" },
    ],
    [
      "waits for the current answer before the next question",
      {
        pendingAction: { ...question, isLastQuestion: false, canAdvance: false, isComplete: false },
      },
      { kind: "answer", blocked: "answer-incomplete" },
    ],
    [
      "is busy while an answer is being submitted",
      { pendingAction: { ...question, response: "submitting" } },
      { kind: "answer", busy: true },
    ],
    [
      "blocks a question that can no longer be answered without calling it busy",
      { pendingAction: { ...question, response: "not-resumable" } },
      { kind: "answer", blocked: "question-not-answerable" },
    ],
    [
      "names a missing provider on a connected environment",
      { providerAvailability: "unavailable" },
      { kind: "send", blocked: "provider-unavailable" },
    ],
    [
      "names a provider catalog that is still loading on a connected environment",
      { providerAvailability: "pending" },
      { kind: "send", blocked: "provider-pending" },
    ],
    [
      "names a missing project on a connected environment",
      { isProjectSelectionRequired: true },
      { kind: "send", blocked: "project-required" },
    ],
    [
      "still queues a message while disconnected",
      { isEnvironmentUnavailable: true },
      { kind: "send" },
    ],
    [
      "cannot resume while disconnected",
      { ...resumable, isEnvironmentUnavailable: true },
      { kind: "resume", blocked: "environment-disconnected" },
    ],
    [
      "cannot answer while disconnected",
      { pendingAction: question, isEnvironmentUnavailable: true },
      { kind: "answer", blocked: "environment-disconnected" },
    ],
    [
      "blames the disconnect when it also hides the providers",
      { isEnvironmentUnavailable: true, providerAvailability: "unavailable" },
      { kind: "send", blocked: "environment-disconnected" },
    ],
    [
      "carries the send-disabled reason",
      { sendDisabledReason: "uploading" },
      { kind: "send", blocked: "send-disabled" },
    ],
    [
      "needs queue permission to send",
      { canQueueMessage: false },
      { kind: "send", blocked: "not-permitted" },
    ],
    ["sends without thread-operate permission", { canOperateThread: false }, { kind: "send" }],
    [
      "needs thread-operate permission to resume",
      { ...resumable, canOperateThread: false },
      { kind: "resume", blocked: "not-permitted" },
    ],
    [
      "answers while no provider can take a new turn",
      {
        pendingAction: question,
        providerAvailability: "unavailable",
        isProjectSelectionRequired: true,
      },
      { kind: "answer" },
    ],
    [
      "holds an answer whose attachments cannot be sent",
      { pendingAction: question, sendDisabledReason: "Update this server" },
      { kind: "answer", blocked: "send-disabled" },
    ],
    [
      "needs thread-operate permission to answer",
      { pendingAction: question, canOperateThread: false },
      { kind: "answer", blocked: "not-permitted" },
    ],
    ["is busy while a send is in flight", { isSendBusy: true }, { kind: "send", busy: true }],
    [
      "offers Stop beside a draft while the turn can be stopped",
      { ...running, followUpBehavior: "queue" },
      { kind: "queue", stop: "ready" },
    ],
    [
      "keeps a clicked Stop waiting after the turn stops reporting it",
      { ...running, canInterrupt: false, ...emptyDraft, stopPhase: "pending" },
      { kind: "stop", stop: "stopping" },
    ],
    [
      "lets an unanswered Stop be clicked again",
      { ...running, ...emptyDraft, stopPhase: "timedOut" },
      { kind: "stop", stop: "ready" },
    ],
    [
      "guards the action that replaces a Stop that just landed",
      { ...resumable, stopPhase: "landed" },
      { kind: "resume", guarded: true },
    ],
    [
      "guards an answer submitted right after its Stop landed",
      { pendingAction: question, stopPhase: "landed" },
      { kind: "answer", guarded: true },
    ],
  ])("%s", (_name, overrides, expected) => {
    const action = resolveComposerPrimaryAction({ ...idle, ...overrides });
    expect({
      kind: action.kind,
      blocked: action.blocked?.reason ?? null,
      busy: action.busy,
      guarded: action.guarded,
      ...(expected.stop === undefined ? {} : { stop: action.stop }),
    }).toEqual({
      kind: expected.kind,
      blocked: expected.blocked ?? null,
      busy: expected.busy ?? false,
      guarded: expected.guarded ?? false,
      ...(expected.stop === undefined ? {} : { stop: expected.stop }),
    });
  });
});

describe("composer Stop phase", () => {
  const at = (phase: ComposerStopPhase, runId: string | null = "run") => ({ runId, phase });
  const facts: Parameters<typeof stepComposerStop>[1] = {
    runId: "run",
    canInterrupt: true,
    canOperateThread: true,
  };

  it.each<[string, ReturnType<typeof at>, Partial<typeof facts>, ComposerStopPhase]>([
    [
      "lands once the run stops being interruptible",
      at("pending"),
      { canInterrupt: false },
      "landed",
    ],
    ["lands a retried stop the same way", at("timedOut"), { canInterrupt: false }, "landed"],
    ["waits while the run can still be interrupted", at("pending"), {}, "pending"],
    [
      "does not read lost permission as the stop landing",
      at("pending"),
      { canInterrupt: false, canOperateThread: false },
      "pending",
    ],
    ["clears the guard when a new turn can be stopped", at("landed"), {}, "idle"],
    ["starts afresh for a different run", at("pending", "first"), { runId: "second" }, "idle"],
    ["keeps a pending stop while the run id clears", at("pending"), { runId: null }, "pending"],
  ])("%s", (_name, state, input, phase) => {
    expect(stepComposerStop(state, { ...facts, ...input }).phase).toBe(phase);
  });

  it("returns the same state when nothing moves", () => {
    const state = at("idle");
    expect(stepComposerStop(state, facts)).toBe(state);
  });

  it("times a stop out to retryable and lifts the landed guard", () => {
    expect(expireComposerStop(at("pending")).phase).toBe("timedOut");
    expect(expireComposerStop(at("landed")).phase).toBe("idle");
    expect(requestComposerStop(at("timedOut")).phase).toBe("pending");
  });
});
