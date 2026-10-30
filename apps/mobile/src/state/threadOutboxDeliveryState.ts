import type { MessageId } from "@supaterm/contracts";
import { appAtomRegistry } from "./atom-registry";
import { threadOutboxRetryDelayMs, type QueuedThreadMessage } from "./thread-outbox-model";
import { recoveryDraftKey } from "./threadOutboxRecovery";
import type { QueuedDeliveryOutcome } from "./threadOutboxSend";
import { composerDraftsAtom } from "./use-composer-drafts";

type DeliveryStep = "send" | "remove";
type DeliveryPhase =
  | { readonly status: "ready" }
  | { readonly status: "delivering"; readonly step: DeliveryStep; readonly attempt: number }
  | {
      readonly status: "retry";
      readonly step: DeliveryStep;
      readonly attempt: number;
      readonly notBefore: number;
      readonly timer: ReturnType<typeof setTimeout>;
    }
  | {
      readonly status: "blocked";
      readonly message: QueuedThreadMessage;
      readonly unsubscribe: () => void;
    };

interface DeliveryEntry {
  phase: DeliveryPhase;
  releaseFamily?: () => void;
}

export class ThreadOutboxDeliveryState {
  private readonly entries = new Map<MessageId, DeliveryEntry>();
  private disposed = false;

  constructor(private readonly wakeup: () => void) {}

  canAttempt(message: QueuedThreadMessage): boolean {
    const entry = this.entries.get(message.messageId);
    if (entry?.phase.status === "blocked") {
      if (entry.phase.message === message) return false;
      entry.phase.unsubscribe();
      entry.phase = { status: "ready" };
    }
    return entry?.phase.status !== "retry" || entry.phase.notBefore <= Date.now();
  }

  needsRemoval(messageId: MessageId): boolean {
    const phase = this.entries.get(messageId)?.phase;
    return (phase?.status === "retry" || phase?.status === "delivering") && phase.step === "remove";
  }

  begin(messageId: MessageId): void {
    const entry = this.entry(messageId);
    const previous = entry.phase;
    if (previous.status === "retry") clearTimeout(previous.timer);
    entry.phase = {
      status: "delivering",
      step: this.needsRemoval(messageId) ? "remove" : "send",
      attempt: previous.status === "retry" ? previous.attempt : 0,
    };
  }

  settle(messageId: MessageId, outcome: QueuedDeliveryOutcome): void {
    if (this.disposed) return;
    if (outcome.status === "acknowledged" || outcome.status === "retry") {
      this.retry(messageId, outcome.status === "acknowledged" ? "remove" : undefined);
    } else if (outcome.status === "blocked") {
      this.block(outcome.message);
    } else {
      this.reset(this.entry(messageId));
    }
  }

  retry(messageId: MessageId, step?: DeliveryStep): void {
    if (this.disposed) return;
    const entry = this.entry(messageId);
    const phase = entry.phase;
    const attempt =
      (phase.status === "retry" || phase.status === "delivering" ? phase.attempt : 0) + 1;
    const nextStep = step ?? (this.needsRemoval(messageId) ? "remove" : "send");
    this.reset(entry);
    const delay = threadOutboxRetryDelayMs(attempt);
    entry.phase = {
      status: "retry",
      step: nextStep,
      attempt,
      notBefore: Date.now() + delay,
      timer: setTimeout(this.wakeup, delay),
    };
  }

  retainFamily(messageId: MessageId, mount: () => () => void): void {
    const entry = this.entry(messageId);
    if (!entry.releaseFamily) entry.releaseFamily = mount();
  }

  prune(queuedIds: ReadonlySet<MessageId>): void {
    for (const [id, entry] of this.entries) {
      if (queuedIds.has(id)) continue;
      this.reset(entry);
      entry.releaseFamily?.();
      this.entries.delete(id);
    }
  }

  dispose(): void {
    this.disposed = true;
    this.prune(new Set());
  }

  private entry(messageId: MessageId): DeliveryEntry {
    const existing = this.entries.get(messageId);
    if (existing) return existing;
    const entry: DeliveryEntry = { phase: { status: "ready" } };
    this.entries.set(messageId, entry);
    return entry;
  }

  private reset(entry: DeliveryEntry): void {
    if (entry.phase.status === "retry") clearTimeout(entry.phase.timer);
    if (entry.phase.status === "blocked") entry.phase.unsubscribe();
    entry.phase = { status: "ready" };
  }

  private block(message: QueuedThreadMessage): void {
    const entry = this.entry(message.messageId);
    this.reset(entry);
    const draftKey = recoveryDraftKey(message);
    const editorKey = message.creation ? `pending-task:${message.messageId}` : null;
    const drafts = appAtomRegistry.get(composerDraftsAtom);
    const attachments = drafts[draftKey]?.attachments;
    const editorAttachments = editorKey === null ? undefined : drafts[editorKey]?.attachments;
    const unsubscribe = appAtomRegistry.subscribe(composerDraftsAtom, (next) => {
      if (
        next[draftKey]?.attachments === attachments &&
        (editorKey === null || next[editorKey]?.attachments === editorAttachments)
      )
        return;
      if (entry.phase.status !== "blocked") return;
      this.reset(entry);
      this.wakeup();
    });
    entry.phase = { status: "blocked", message, unsubscribe };
  }
}
