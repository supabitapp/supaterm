import { CommandId, EnvironmentId, MessageId, ThreadId } from "@supaterm/contracts";
import { afterEach, expect, it, vi } from "vite-plus/test";
import type { ComposerDraft } from "./use-composer-drafts";
import type { QueuedThreadMessage } from "./thread-outbox-model";

vi.mock("./use-composer-drafts", async () => {
  const { Atom } = await import("effect/reactivity");
  return { composerDraftsAtom: Atom.make<Record<string, ComposerDraft>>({}).pipe(Atom.keepAlive) };
});
vi.mock("./threadOutboxRecovery", () => ({ recoveryDraftKey: () => "recovery" }));

import { appAtomRegistry } from "./atom-registry";
import { composerDraftsAtom } from "./use-composer-drafts";
import { ThreadOutboxDeliveryState } from "./threadOutboxDeliveryState";
import { threadOutboxRetryDelayMs } from "./thread-outbox-model";

const message = {
  environmentId: EnvironmentId.make("environment"),
  threadId: ThreadId.make("thread"),
  messageId: MessageId.make("message"),
  commandId: CommandId.make("command"),
  text: "queued text",
  attachments: [],
  createdAt: "2026-10-01T00:00:00Z",
} satisfies QueuedThreadMessage;

afterEach(() => appAtomRegistry.set(composerDraftsAtom, {}));

it("backs off acknowledged cleanup without allowing another send", async () => {
  vi.useFakeTimers();
  using _clock = { [Symbol.dispose]: () => vi.useRealTimers() };
  const wakeup = vi.fn();
  const state = new ThreadOutboxDeliveryState(wakeup);
  using _state = { [Symbol.dispose]: () => state.dispose() };
  state.begin(message.messageId);
  state.settle(message.messageId, { status: "acknowledged" });
  expect(state.needsRemoval(message.messageId)).toBe(true);
  expect(state.canAttempt(message)).toBe(false);
  await vi.advanceTimersByTimeAsync(threadOutboxRetryDelayMs(1));
  expect(wakeup).toHaveBeenCalledOnce();
  expect(state.canAttempt(message)).toBe(true);
  state.begin(message.messageId);
  state.settle(message.messageId, { status: "retry" });
  expect(state.needsRemoval(message.messageId)).toBe(true);
  expect(state.canAttempt(message)).toBe(false);
  await vi.advanceTimersByTimeAsync(threadOutboxRetryDelayMs(2));
  expect(wakeup).toHaveBeenCalledTimes(2);
  state.begin(message.messageId);
  state.settle(message.messageId, { status: "removed" });
  expect(state.needsRemoval(message.messageId)).toBe(false);
});

it("wakes blocked recovery only after that draft's attachments change", () => {
  const wakeup = vi.fn();
  const state = new ThreadOutboxDeliveryState(wakeup);
  using _state = { [Symbol.dispose]: () => state.dispose() };
  const attachments: ComposerDraft["attachments"] = [];
  appAtomRegistry.set(composerDraftsAtom, { recovery: { text: "original", attachments } });
  state.begin(message.messageId);
  state.settle(message.messageId, { status: "blocked", message });
  appAtomRegistry.set(composerDraftsAtom, {
    recovery: { text: "edited text", attachments },
    other: { text: "another draft", attachments: [] },
  });
  expect(state.canAttempt(message)).toBe(false);
  expect(wakeup).not.toHaveBeenCalled();
  appAtomRegistry.set(composerDraftsAtom, { recovery: { text: "edited text", attachments: [] } });
  expect(state.canAttempt(message)).toBe(true);
  expect(wakeup).toHaveBeenCalledOnce();
});

it("releases each queued family's resources and pending retry when the message leaves", async () => {
  vi.useFakeTimers();
  using _clock = { [Symbol.dispose]: () => vi.useRealTimers() };
  const wakeup = vi.fn();
  const release = vi.fn();
  const mount = vi.fn(() => release);
  const state = new ThreadOutboxDeliveryState(wakeup);
  using _state = { [Symbol.dispose]: () => state.dispose() };
  state.retainFamily(message.messageId, mount);
  state.retainFamily(message.messageId, mount);
  state.retry(message.messageId);
  state.prune(new Set([message.messageId]));
  expect(release).not.toHaveBeenCalled();
  state.prune(new Set());
  await vi.runAllTimersAsync();
  expect(mount).toHaveBeenCalledOnce();
  expect(release).toHaveBeenCalledOnce();
  expect(wakeup).not.toHaveBeenCalled();
});

it("a replaced message and disposal both release blocked draft subscriptions", () => {
  const wakeup = vi.fn();
  const state = new ThreadOutboxDeliveryState(wakeup);
  state.settle(message.messageId, { status: "blocked", message });
  expect(state.canAttempt({ ...message, text: "edited" })).toBe(true);
  state.settle(message.messageId, { status: "blocked", message });
  state.dispose();
  appAtomRegistry.set(composerDraftsAtom, { recovery: { text: "changed", attachments: [] } });
  expect(wakeup).not.toHaveBeenCalled();
});
