import type { ProviderReplayTranscript } from "@supaterm/contracts";
import * as Effect from "effect/Effect";
import * as Duration from "effect/Duration";
import * as Schema from "effect/Schema";

export class OpenCodeReplayTranscriptDecodeError extends Schema.TaggedError<OpenCodeReplayTranscriptDecodeError>()(
  "OpenCodeReplayTranscriptDecodeError",
  {
    driver: Schema.optional(Schema.String),
    protocol: Schema.optional(Schema.String),
    scenario: Schema.optional(Schema.String),
    cause: Schema.Defect(),
  },
) {
  override get message() {
    return `Failed to decode OpenCode replay transcript for scenario ${this.scenario ?? "<unknown>"}.`;
  }
}

export class OpenCodeReplayMismatchError extends Schema.TaggedError<OpenCodeReplayMismatchError>()(
  "OpenCodeReplayMismatchError",
  {
    scenario: Schema.String,
    cursor: Schema.Number,
    expected: Schema.Unknown,
    actual: Schema.Unknown,
  },
) {
  override get message() {
    return `OpenCode replay frame mismatch at cursor ${this.cursor} in scenario ${this.scenario}.`;
  }
}

export class OpenCodeReplayIncompleteError extends Schema.TaggedError<OpenCodeReplayIncompleteError>()(
  "OpenCodeReplayIncompleteError",
  {
    scenario: Schema.String,
    cursor: Schema.Number,
    remaining: Schema.Number,
  },
) {
  override get message() {
    return `OpenCode replay ended with ${this.remaining} unconsumed entries in scenario ${this.scenario}.`;
  }
}

function replayValueMatches(expected: unknown, actual: unknown): boolean;
function replayValueMatches(expected: unknown, actual: unknown) {
  if (expected === "<any>" || expected === "<workspace>") return true satisfies boolean;
  if (expected === "<string>")
    return (typeof actual === "string" && actual.length > 0) satisfies boolean;
  if (Array.isArray(expected)) {
    return (Array.isArray(actual) &&
      expected.length === actual.length &&
      expected.every((entry, index) => replayValueMatches(entry, actual[index]))) satisfies boolean;
  }
  if (typeof expected === "object" && expected !== null) {
    if (typeof actual !== "object" || actual === null) return false satisfies boolean;
    return Object.entries(expected).every(([key, value]) =>
      replayValueMatches(value, (actual as Record<string, unknown>)[key]),
    ) satisfies boolean;
  }
  return Object.is(expected, actual) satisfies boolean;
}

function frameRecord(frame: unknown) {
  return typeof frame === "object" && frame !== null ? (frame as Record<string, unknown>) : null;
}

function materializeMessageIds(value: unknown, messageIds: ReadonlyMap<string, string>): unknown;
function materializeMessageIds(value: unknown, messageIds: ReadonlyMap<string, string>) {
  if (Array.isArray(value))
    return value.map((entry) => materializeMessageIds(entry, messageIds)) satisfies unknown;
  const record = frameRecord(value);
  if (record === null) return value satisfies unknown;
  return Object.fromEntries(
    Object.entries(record).map(([key, entry]) => [
      key,
      typeof entry === "string" &&
      (key === "id" ||
        key === "messageID" ||
        key === "parentID" ||
        key === "inboxID" ||
        key === "before")
        ? (messageIds.get(entry) ?? entry)
        : materializeMessageIds(entry, messageIds),
    ]),
  ) satisfies unknown;
}

export class OpenCodeReplayController {
  private cursor = 0;
  exited = false;

  get finished() {
    return this.cursor >= this.transcript.entries.length;
  }
  private readonly waiters = new Set<() => void>();
  private failure: unknown = null;
  private readonly transcript: ProviderReplayTranscript;
  private messageIds = new Map<string, string>();

  constructor(transcript: ProviderReplayTranscript) {
    this.transcript = transcript;
  }

  async expectOutbound(actual: unknown) {
    try {
      const entry = this.transcript.entries[this.cursor];
      const expectedFrame = entry?.type === "expect_outbound" ? frameRecord(entry.frame) : null;
      const actualFrame = frameRecord(actual);
      const messageIds = new Map(this.messageIds);
      let conflictingMessageId = false;
      if (expectedFrame?.type === "session.prompt" && actualFrame?.type === expectedFrame.type) {
        const recordedId = frameRecord(expectedFrame.input)?.id;
        const actualId = frameRecord(actualFrame.input)?.id;
        if (
          typeof recordedId === "string" &&
          typeof actualId === "string" &&
          recordedId !== "<any>" &&
          recordedId !== "<workspace>" &&
          !messageIds.has(recordedId)
        ) {
          conflictingMessageId = [...messageIds.values()].includes(actualId);
          if (!conflictingMessageId) messageIds.set(recordedId, actualId);
        }
      }
      const expected =
        entry?.type === "expect_outbound"
          ? materializeMessageIds(entry.frame, messageIds)
          : (entry ?? null);
      if (
        conflictingMessageId ||
        entry?.type !== "expect_outbound" ||
        !replayValueMatches(expected, actual)
      ) {
        throw new OpenCodeReplayMismatchError({
          scenario: this.transcript.scenario,
          cursor: this.cursor,
          expected,
          actual,
        });
      }
      this.messageIds = messageIds;
      this.advance();
    } catch (cause) {
      this.fail(cause);
      throw cause;
    }
  }

  response(operation: string): Promise<unknown>;
  async response(operation: string) {
    while (true) {
      this.throwFailure();
      const entry = this.transcript.entries[this.cursor];
      if (entry?.type === "emit_inbound") {
        const frame = frameRecord(entry.frame);
        if (frame?.type === "sdk.response" && frame.operation === operation) {
          if (entry.afterMs !== undefined && entry.afterMs > 0) {
            await Effect.runPromise(Effect.sleep(Duration.millis(entry.afterMs)));
          }
          const data = materializeMessageIds(frame.data, this.messageIds);
          this.advance();
          return data satisfies unknown;
        }
      }
      if (entry?.type === "runtime_exit") {
        const mismatch = new OpenCodeReplayMismatchError({
          scenario: this.transcript.scenario,
          cursor: this.cursor,
          expected: { type: "sdk.response", operation },
          actual: entry,
        });
        this.fail(mismatch);
        throw mismatch;
      }
      await this.changed();
    }
  }

  /** Waits for events and responses to be consumed so concurrent HTTP requests cannot match earlier answers. */
  async untilInboundDelivered() {
    while (true) {
      this.throwFailure();
      if (this.transcript.entries[this.cursor]?.type !== "emit_inbound") return;
      await this.changed();
    }
  }

  async *events(signal?: AbortSignal, beforeEmit?: (label: string | undefined) => Promise<void>) {
    while (true) {
      if (signal?.aborted === true) return;
      this.throwFailure();
      const entry = this.transcript.entries[this.cursor];
      if (entry?.type === "emit_inbound") {
        const frame = frameRecord(entry.frame);
        if (frame?.type === "sdk.event") {
          if (beforeEmit !== undefined) await beforeEmit(entry.label);
          if (entry.afterMs !== undefined && entry.afterMs > 0) {
            await Effect.runPromise(Effect.sleep(Duration.millis(entry.afterMs)));
          }
          const event = materializeMessageIds(frame.event, this.messageIds);
          this.advance();
          yield event;
          continue;
        }
      }
      if (entry?.type === "runtime_exit") {
        this.advance();
        if (entry.status === "success") {
          this.exited = true;
          return;
        }
        const mismatch = new OpenCodeReplayMismatchError({
          scenario: this.transcript.scenario,
          cursor: this.cursor - 1,
          expected: { status: "success" },
          actual: entry,
        });
        this.fail(mismatch);
        throw mismatch;
      }
      await this.changed(signal);
    }
  }

  assertComplete() {
    while (this.transcript.entries[this.cursor]?.type === "runtime_exit") {
      const exit = this.transcript.entries[this.cursor];
      if (exit?.type !== "runtime_exit" || exit.status !== "success") break;
      this.cursor += 1;
    }
    this.throwFailure();
    if (this.cursor !== this.transcript.entries.length) {
      throw new OpenCodeReplayIncompleteError({
        scenario: this.transcript.scenario,
        cursor: this.cursor,
        remaining: this.transcript.entries.length - this.cursor,
      });
    }
  }

  private advance() {
    this.cursor += 1;
    for (const waiter of this.waiters) waiter();
    this.waiters.clear();
  }

  private fail(cause: unknown) {
    this.failure = cause;
    for (const waiter of this.waiters) waiter();
    this.waiters.clear();
  }

  private throwFailure() {
    if (this.failure !== null) throw this.failure;
  }

  private changed(signal?: AbortSignal) {
    return new Promise((resolve) => {
      let settled = false;
      const done = () => {
        if (settled) return;
        settled = true;
        signal?.removeEventListener("abort", done);
        this.waiters.delete(done);
        resolve();
      };
      this.waiters.add(done);
      signal?.addEventListener("abort", done, { once: true });
      if (signal?.aborted === true) done();
    }) satisfies Promise<void>;
  }
}
