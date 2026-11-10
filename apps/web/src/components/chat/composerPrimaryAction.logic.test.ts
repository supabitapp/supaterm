import { describe, expect, it } from "vite-plus/test";

import {
  resolveComposerPrimaryAction,
  type ComposerPrimaryAction,
  type ComposerPrimaryActionBlock,
  type ComposerPrimaryActionInput,
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
      "needs thread-operate permission to answer",
      { pendingAction: question, canOperateThread: false },
      { kind: "answer", blocked: "not-permitted" },
    ],
    ["is busy while a send is in flight", { isSendBusy: true }, { kind: "send", busy: true }],
  ])("%s", (_name, overrides, expected) => {
    const action = resolveComposerPrimaryAction({ ...idle, ...overrides });
    expect({
      kind: action.kind,
      blocked: action.blocked?.reason ?? null,
      busy: action.busy,
    }).toEqual({
      kind: expected.kind,
      blocked: expected.blocked ?? null,
      busy: expected.busy ?? false,
    });
  });
});
