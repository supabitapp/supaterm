import { assert, describe, it } from "@effect/vitest";
import {
  AuthSessionId,
  type ClientActivityLease,
  ClientActivityClientId,
  MessageId,
  type OrchestrationV2ConversationMessage,
  RpcClientId,
  RunId,
  RuntimeRequestId,
  ThreadId,
} from "@supaterm/contracts";
import { PushEnvelope, type PushPreviewLevel } from "@supaterm/contracts/push";
import { openPushEnvelope } from "@supaterm/shared/push/envelope";
import { decodeBase64 } from "@supaterm/shared/relay/protocol";
import * as DateTime from "effect/DateTime";
import * as Effect from "effect/Effect";
import * as Queue from "effect/Queue";
import * as Ref from "effect/Ref";
import * as Schema from "effect/Schema";
import * as SqlClient from "effect/sql/SqlClient";
import { TestClock } from "effect/testing";

import * as PushCandidateReactor from "./PushCandidateReactor.ts";
import * as PushDeliveryWorker from "./PushDeliveryWorker.ts";
import * as PushNotifications from "./PushNotifications.ts";
import {
  ENVIRONMENT_ID,
  type GatewayCall,
  insertSession,
  layerPushServices,
  PROJECT_TITLE,
  type PushWorld,
  recipientKeyPair,
  registerInput,
  threadShell,
  withPushWorld,
} from "./testkit/pushWorld.ts";

const SESSION = AuthSessionId.make("session-a");
const THREAD = ThreadId.make("thread");
const RUN = RunId.make("thread-run-1");
const REGISTRATION_IDS: Record<PushPreviewLevel, string> = {
  hidden: "6f1c2b9e-3a4d-4e5f-8a6b-7c8d9e0f1a2b",
  titles: "7a2d3c0f-4b5e-4f60-9b7c-8d9e0f1a2b3c",
  full: "8b3e4d1a-5c6f-4a71-8c8d-9e0f1a2b3c4d",
};
const HANDLES: Record<PushPreviewLevel, string> = {
  hidden: "aGFuZGxlLWhpZGRlbi0xMg",
  titles: "aGFuZGxlLXRpdGxlcy0xMg",
  full: "aGFuZGxlLWZ1bGwtLS0xMg",
};

const decodeSendBody = Schema.decodeUnknownSync(
  Schema.fromJsonString(
    Schema.Struct({
      handle: Schema.String,
      payload: PushEnvelope,
      expiration: Schema.Number,
      priority: Schema.Number,
      collapseId: Schema.String,
    }),
  ),
);

const register = (preview: PushPreviewLevel) =>
  Effect.gen(function* () {
    const recipient = yield* recipientKeyPair;
    yield* (yield* PushNotifications.PushNotifications).register(
      SESSION,
      registerInput(REGISTRATION_IDS[preview], recipient.publicKey, {
        preview,
        handle: HANDLES[preview],
      }),
    );
    return recipient;
  });

const drainReactor = Effect.flatMap(
  PushCandidateReactor.PushCandidateReactor,
  (reactor) => reactor.drain,
);
const drainWorker = Effect.flatMap(PushDeliveryWorker.PushDeliveryWorker, (worker) => worker.drain);

const deliveryRows = Effect.gen(function* () {
  const sql = yield* SqlClient.SqlClient;
  return yield* sql<{
    readonly status: string;
    readonly attempts: number;
    readonly next_attempt_at: number;
    readonly expires_at: number;
  }>`SELECT status, attempts, next_attempt_at, expires_at FROM push_deliveries ORDER BY delivery_id`;
});

const takeCalls = (world: PushWorld) =>
  Queue.clear(world.gatewayCalls).pipe(Effect.map((calls): ReadonlyArray<GatewayCall> => calls));

/** A run that just finished, after the reactor saw it running. */
const finishRun = (
  world: PushWorld,
  overrides: Parameters<typeof threadShell>[1] = {},
  status: "completed" | "failed" = "completed",
) =>
  Effect.gen(function* () {
    yield* world.putShell(threadShell(THREAD));
    yield* world.appendEvent({
      type: "run.created",
      threadId: THREAD,
      occurredAt: yield* DateTime.now,
      payload: { id: RUN, status: "running" },
    });
    yield* drainReactor;
    yield* world.putShell(threadShell(THREAD, { status, activityRunStatus: null, ...overrides }));
    yield* world.appendEvent({
      type: "run.updated",
      threadId: THREAD,
      occurredAt: yield* DateTime.now,
      payload: { id: RUN, status },
    });
    yield* drainReactor;
  });

/** An approval the agent is waiting on, after the reactor saw the run start. */
const requestApproval = (world: PushWorld) =>
  Effect.gen(function* () {
    const requestId = RuntimeRequestId.make("approval-1");
    yield* world.putShell(threadShell(THREAD));
    yield* world.appendEvent({
      type: "run.created",
      threadId: THREAD,
      occurredAt: yield* DateTime.now,
      payload: { id: RUN, status: "running" },
    });
    yield* drainReactor;
    yield* world.putShell(
      threadShell(THREAD, {
        status: "waiting",
        activityRunStatus: "waiting",
        pendingRuntimeRequest: { id: requestId, kind: "command", createdAt: yield* DateTime.now },
      }),
    );
    yield* world.appendEvent({
      type: "runtime-request.updated",
      threadId: THREAD,
      occurredAt: yield* DateTime.now,
      payload: { id: requestId, kind: "command", status: "pending" },
    });
    yield* drainReactor;
  });

const assistantMessage = (text: string, updatedAt: DateTime.Utc) =>
  ({
    id: MessageId.make(`message-${text.length}`),
    threadId: THREAD,
    runId: RUN,
    role: "assistant",
    text,
    updatedAt,
    createdAt: updatedAt,
  }) as unknown as OrchestrationV2ConversationMessage;

const openSent = (call: GatewayCall | undefined, privateKey: Uint8Array) =>
  Effect.promise(() => {
    const body = decodeSendBody(call?.body ?? "");
    return openPushEnvelope({
      envelope: body.payload,
      recipientPrivateKey: privateKey,
      hostPublicKey: decodeBase64(call?.headers["supaterm-push-key"] ?? ""),
    });
  });

const watchingLease = (input: {
  readonly lastInteractionAt: DateTime.Utc;
  readonly expiresAt: DateTime.Utc;
  readonly updatedAt?: DateTime.Utc;
}): ClientActivityLease => ({
  sessionId: AuthSessionId.make("desktop"),
  rpcClientId: RpcClientId.make(1),
  clientId: ClientActivityClientId.make("desktop-window"),
  clientKind: "desktop-renderer",
  visible: true,
  focused: true,
  recentlyInteracted: true,
  scopes: [{ type: "thread", threadId: THREAD }],
  lastInteractionAt: input.lastInteractionAt,
  updatedAt: input.updatedAt ?? input.lastInteractionAt,
  expiresAt: input.expiresAt,
});

const withWorker = <A, E, R>(body: (world: PushWorld) => Effect.Effect<A, E, R>) =>
  withPushWorld((world) =>
    Effect.gen(function* () {
      yield* TestClock.setTime(1_791_840_000_000);
      yield* insertSession(SESSION);
      return yield* body(world);
    }).pipe(Effect.provide(layerPushServices)),
  );

describe("PushDeliveryWorker", () => {
  it.effect("seals each delivery at its registration's preview level", () =>
    withWorker((world) =>
      Effect.gen(function* () {
        const recipients = {
          hidden: yield* register("hidden"),
          titles: yield* register("titles"),
          full: yield* register("full"),
        };
        const occurredAt = DateTime.toEpochMillis(yield* DateTime.now);
        const now = yield* DateTime.now;
        yield* Ref.set(
          world.messages,
          new Map([
            [
              THREAD,
              [
                assistantMessage("Running the tests", DateTime.subtract(now, { seconds: 5 })),
                assistantMessage("All\ntests pass", now),
                assistantMessage("  ", DateTime.add(now, { seconds: 1 })),
              ],
            ],
          ]),
        );
        yield* finishRun(world);

        yield* drainWorker;
        assert.deepStrictEqual(yield* takeCalls(world), [], "completions wait out the grace");
        yield* TestClock.adjust("2 seconds");
        yield* drainWorker;

        const calls = yield* takeCalls(world);
        assert.lengthOf(calls, 3);
        const contents: Record<string, unknown> = {};
        for (const call of calls) {
          const body = decodeSendBody(call.body);
          const preview = (Object.keys(REGISTRATION_IDS) as Array<PushPreviewLevel>).find(
            (level) => REGISTRATION_IDS[level] === body.payload.registrationId,
          )!;
          assert.strictEqual(body.handle, HANDLES[preview]);
          assert.strictEqual(body.priority, 5);
          assert.strictEqual(body.payload.expiresAt, occurredAt + 10 * 60_000);
          assert.strictEqual(body.expiration, Math.floor(body.payload.expiresAt / 1000));
          assert.match(body.collapseId, /^[A-Za-z0-9_-]{32}$/);
          contents[preview] = yield* Effect.promise(() =>
            openPushEnvelope({
              envelope: body.payload,
              recipientPrivateKey: recipients[preview].privateKey,
              hostPublicKey: decodeBase64(call.headers["supaterm-push-key"] ?? ""),
            }),
          );
        }
        const base = { environmentId: ENVIRONMENT_ID, threadId: THREAD, kind: "completion" };
        assert.deepStrictEqual(contents, {
          hidden: { ...base, title: "Supaterm", body: "Finished" },
          titles: { ...base, title: "Thread thread", subtitle: PROJECT_TITLE, body: "Finished" },
          full: {
            ...base,
            title: "Thread thread",
            subtitle: PROJECT_TITLE,
            body: "Finished: All tests pass",
          },
        });
        assert.deepStrictEqual(
          (yield* deliveryRows).map((row) => row.status),
          ["sent", "sent", "sent"],
        );
        const listed = yield* (yield* PushNotifications.PushNotifications).list(SESSION);
        assert.isTrue(listed.registrations.every((entry) => entry.lastDeliveryAt !== undefined));
      }),
    ),
  );

  it.effect("retires a registration the gateway no longer knows", () =>
    withWorker((world) =>
      Effect.gen(function* () {
        yield* register("titles");
        yield* Ref.set(world.gatewayReply, () => ({ status: 410 }));
        yield* finishRun(world);
        yield* TestClock.adjust("2 seconds");
        yield* drainWorker;

        assert.lengthOf(yield* takeCalls(world), 1);
        assert.deepStrictEqual(
          (yield* deliveryRows).map((row) => row.status),
          ["failed"],
        );
        const listed = yield* (yield* PushNotifications.PushNotifications).list(SESSION);
        assert.strictEqual(listed.registrations[0]?.status, "gone");
      }),
    ),
  );

  it.effect("backs off between retries and stops at the freshness deadline", () =>
    withWorker((world) =>
      Effect.gen(function* () {
        yield* register("titles");
        yield* Ref.set(world.gatewayReply, () => ({ status: 503 }));
        yield* finishRun(world);
        yield* TestClock.adjust("2 seconds");
        yield* drainWorker;

        const gaps: Array<number> = [];
        let attemptedAt = DateTime.toEpochMillis(yield* DateTime.now);
        for (;;) {
          const [row] = yield* deliveryRows;
          if (row?.status !== "pending") break;
          assert.isBelow(row.next_attempt_at, row.expires_at);
          gaps.push(row.next_attempt_at - attemptedAt);
          attemptedAt = row.next_attempt_at;
          yield* TestClock.setTime(row.next_attempt_at);
          yield* drainWorker;
        }

        const [row] = yield* deliveryRows;
        assert.strictEqual(row?.status, "expired");
        assert.strictEqual((yield* takeCalls(world)).length, row?.attempts);
        const expected = [2_000, 5_000, 15_000, 60_000, 300_000];
        gaps.forEach((gap, index) => {
          const base = expected[Math.min(index, expected.length - 1)]!;
          assert.isAtLeast(gap, base * 0.8);
          assert.isAtMost(gap, base * 1.2);
        });
        assert.isAtLeast(gaps.length, 5);
      }),
    ),
  );

  it.effect("previews a failed run with its error", () =>
    withWorker((world) =>
      Effect.gen(function* () {
        const recipient = yield* register("full");
        yield* finishRun(world, { lastError: "Rate limited by provider" }, "failed");
        yield* TestClock.adjust("2 seconds");
        yield* drainWorker;

        const [call] = yield* takeCalls(world);
        assert.deepInclude(yield* openSent(call, recipient.privateKey), {
          kind: "failure",
          body: "Failed: Rate limited by provider",
        });
      }),
    ),
  );

  it.effect("sets aside a delivery whose request was answered before it went out", () =>
    withWorker((world) =>
      Effect.gen(function* () {
        yield* register("titles");
        yield* requestApproval(world);
        yield* world.putShell(threadShell(THREAD));

        yield* drainWorker;
        assert.deepStrictEqual(yield* takeCalls(world), []);
        assert.deepStrictEqual(
          (yield* deliveryRows).map((row) => row.status),
          ["superseded"],
        );
      }),
    ),
  );

  it.effect("keeps an unanswered approval eligible past a day and reseals its envelope", () =>
    withWorker((world) =>
      Effect.gen(function* () {
        yield* register("titles");
        yield* Ref.set(world.gatewayReply, () => ({
          status: 429,
          headers: { "retry-after": String(25 * 60 * 60) },
        }));
        yield* requestApproval(world);
        yield* drainWorker;
        const firstSentAt = DateTime.toEpochMillis(yield* DateTime.now);

        yield* Ref.set(world.gatewayReply, () => ({ status: 200 }));
        yield* TestClock.adjust("25 hours");
        yield* drainWorker;

        const [first, second] = (yield* takeCalls(world)).map(
          (call) => decodeSendBody(call.body).payload,
        );
        assert.strictEqual(first?.expiresAt, firstSentAt + 24 * 60 * 60_000);
        const resealedAt = DateTime.toEpochMillis(yield* DateTime.now);
        assert.deepStrictEqual(
          { createdAt: second?.createdAt, expiresAt: second?.expiresAt },
          { createdAt: resealedAt, expiresAt: resealedAt + 24 * 60 * 60_000 },
        );
        assert.strictEqual(second?.notificationId, first?.notificationId);
        assert.deepStrictEqual(
          (yield* deliveryRows).map((row) => row.status),
          ["sent"],
        );
      }),
    ),
  );

  it.effect("never resends an envelope sealed before the registration changed", () =>
    withWorker((world) =>
      Effect.gen(function* () {
        yield* register("titles");
        yield* Ref.set(world.gatewayReply, () => ({ status: 503 }));
        yield* requestApproval(world);
        yield* drainWorker;
        const sql = yield* SqlClient.SqlClient;
        const [stale] = yield* sql<{
          readonly envelope_json: string;
          readonly envelope_expires_at: number;
          readonly envelope_revision: number;
        }>`SELECT envelope_json, envelope_expires_at, envelope_revision FROM push_deliveries`;

        const rekeyed = yield* register("titles");
        // An attempt that sealed under the old key can still write its envelope after the change.
        yield* sql`
          UPDATE push_deliveries SET envelope_json = ${stale?.envelope_json ?? null},
            envelope_expires_at = ${stale?.envelope_expires_at ?? null},
            envelope_revision = ${stale?.envelope_revision ?? null}
        `;
        yield* Ref.set(world.gatewayReply, () => ({ status: 200 }));
        yield* TestClock.adjust("3 seconds");
        yield* drainWorker;

        const calls = yield* takeCalls(world);
        assert.lengthOf(calls, 2);
        assert.deepInclude(yield* openSent(calls[1], rekeyed.privateKey), { kind: "approval" });
      }),
    ),
  );

  it.effect("drops a completion the user saw on another client", () =>
    withWorker((world) =>
      Effect.gen(function* () {
        yield* register("titles");
        yield* finishRun(world);
        const now = yield* DateTime.now;
        yield* Ref.set(world.leases, [
          watchingLease({
            lastInteractionAt: DateTime.add(now, { seconds: 1 }),
            expiresAt: DateTime.add(now, { seconds: 45 }),
          }),
        ]);
        yield* TestClock.adjust("2 seconds");
        yield* drainWorker;

        assert.deepStrictEqual(yield* takeCalls(world), []);
        assert.deepStrictEqual(
          (yield* deliveryRows).map((row) => row.status),
          ["cancelled"],
        );
      }),
    ),
  );

  it.effect("drops a completion when a client reports it landed just after input", () =>
    withWorker((world) =>
      Effect.gen(function* () {
        yield* register("titles");
        yield* finishRun(world);
        const now = yield* DateTime.now;
        yield* Ref.set(world.leases, [
          watchingLease({
            lastInteractionAt: DateTime.subtract(now, { seconds: 5 }),
            updatedAt: DateTime.add(now, { seconds: 1 }),
            expiresAt: DateTime.add(now, { seconds: 45 }),
          }),
        ]);
        yield* TestClock.adjust("2 seconds");
        yield* drainWorker;

        assert.deepStrictEqual(yield* takeCalls(world), []);
      }),
    ),
  );

  it.effect("sends a completion when the watching client went quiet before it", () =>
    withWorker((world) =>
      Effect.gen(function* () {
        yield* register("titles");
        yield* finishRun(world);
        const now = yield* DateTime.now;
        yield* Ref.set(world.leases, [
          watchingLease({
            lastInteractionAt: DateTime.subtract(now, { seconds: 20 }),
            updatedAt: DateTime.add(now, { seconds: 1 }),
            expiresAt: DateTime.add(now, { seconds: 45 }),
          }),
        ]);
        yield* TestClock.adjust("2 seconds");
        yield* drainWorker;

        assert.strictEqual((yield* takeCalls(world)).length, 1);
      }),
    ),
  );

  it.effect("holds an approval while a client watches and sends it once the client leaves", () =>
    withWorker((world) =>
      Effect.gen(function* () {
        yield* register("titles");
        const now = yield* DateTime.now;
        yield* Ref.set(world.leases, [
          watchingLease({ lastInteractionAt: now, expiresAt: DateTime.add(now, { seconds: 30 }) }),
        ]);
        yield* requestApproval(world);
        yield* drainWorker;

        assert.deepStrictEqual(yield* takeCalls(world), []);
        const [held] = yield* deliveryRows;
        assert.deepStrictEqual(
          { status: held?.status, attempts: held?.attempts, nextAttemptAt: held?.next_attempt_at },
          { status: "pending", attempts: 0, nextAttemptAt: DateTime.toEpochMillis(now) + 30_000 },
        );

        yield* TestClock.adjust("30 seconds");
        yield* drainWorker;
        const [call] = yield* takeCalls(world);
        assert.strictEqual(decodeSendBody(call?.body ?? "").priority, 10);
        assert.deepStrictEqual(
          (yield* deliveryRows).map((row) => row.status),
          ["sent"],
        );
      }),
    ),
  );
});
