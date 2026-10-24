import { assert, describe, it } from "@effect/vitest";
import {
  AuthSessionId,
  type OrchestrationV2RuntimeRequest,
  type OrchestrationV2Subagent,
  RunId,
  RuntimeRequestId,
  ThreadId,
} from "@supaterm/contracts";
import * as DateTime from "effect/DateTime";
import * as Effect from "effect/Effect";
import * as Queue from "effect/Queue";
import * as Ref from "effect/Ref";
import * as SqlClient from "effect/sql/SqlClient";
import { TestClock } from "effect/testing";

import * as PushCandidateReactor from "./PushCandidateReactor.ts";
import * as PushDeliveryWorker from "./PushDeliveryWorker.ts";
import * as PushNotifications from "./PushNotifications.ts";
import {
  insertSession,
  layerPushServices,
  type PushWorld,
  recipientKeyPair,
  registerInput,
  threadShell,
  withPushWorld,
} from "./testkit/pushWorld.ts";

const SESSION = AuthSessionId.make("session-a");
const REGISTRATION_ID = "6f1c2b9e-3a4d-4e5f-8a6b-7c8d9e0f1a2b";
const THREAD = ThreadId.make("thread");
const PARENT = ThreadId.make("parent");
const CHILD = ThreadId.make("child");

const deliveries = Effect.gen(function* () {
  const sql = yield* SqlClient.SqlClient;
  return yield* sql<{
    readonly thread_id: string;
    readonly attention_key: string;
    readonly kind: string;
    readonly status: string;
    readonly occurred_at: number;
    readonly expires_at: number;
    readonly next_attempt_at: number;
  }>`
    SELECT thread_id, attention_key, kind, status, occurred_at, expires_at, next_attempt_at
    FROM push_deliveries ORDER BY delivery_id
  `;
});

const statuses = Effect.map(deliveries, (rows) => rows.map((row) => row.status));

const cursor = Effect.gen(function* () {
  const sql = yield* SqlClient.SqlClient;
  const rows = yield* sql<{ readonly last_sequence: number }>`
    SELECT last_sequence FROM orchestration_v2_projection_metadata
    WHERE projection_name = 'push-candidates'
  `;
  return rows[0]?.last_sequence;
});

const register = Effect.gen(function* () {
  yield* insertSession(SESSION);
  const { publicKey } = yield* recipientKeyPair;
  yield* (yield* PushNotifications.PushNotifications).register(
    SESSION,
    registerInput(REGISTRATION_ID, publicKey),
  );
});

const drain = Effect.flatMap(PushCandidateReactor.PushCandidateReactor, (reactor) => reactor.drain);
const drainWorker = Effect.flatMap(PushDeliveryWorker.PushDeliveryWorker, (worker) => worker.drain);

const nowMillis = Effect.map(DateTime.now, DateTime.toEpochMillis);

const runEvent = (
  world: PushWorld,
  threadId: string,
  runId: string,
  status: string,
  commandId: string | null = null,
) =>
  Effect.flatMap(DateTime.now, (occurredAt) =>
    world.appendEvent(
      { type: "run.updated", threadId, occurredAt, payload: { id: RunId.make(runId), status } },
      commandId,
    ),
  );

const requestEvent = (
  world: PushWorld,
  threadId: string,
  payload: { readonly id: RuntimeRequestId; readonly kind: string; readonly status: string } & {
    readonly autoDismissPaused?: boolean;
  },
) =>
  Effect.flatMap(DateTime.now, (occurredAt) =>
    world.appendEvent({ type: "runtime-request.updated", threadId, occurredAt, payload }),
  );

function subagentRecord(childThreadId: ThreadId): OrchestrationV2Subagent {
  return {
    childThreadId,
    origin: "app_owned",
    status: "running",
  } as unknown as OrchestrationV2Subagent;
}

const completed = { status: "completed", activityRunStatus: null } as const;

const sentCount = (world: PushWorld) =>
  Queue.clear(world.gatewayCalls).pipe(
    Effect.map((calls) => calls.filter((call) => call.url.pathname === "/v1/send").length),
  );

describe("PushCandidateReactor", () => {
  it.effect("starts at the head of the event log on first boot", () =>
    withPushWorld((world) =>
      Effect.gen(function* () {
        yield* world.putShell(threadShell("thread", completed));
        yield* runEvent(world, "thread", "thread-run-1", "completed");
        yield* Effect.gen(function* () {
          yield* register;
          yield* drain;
          assert.strictEqual(yield* cursor, 1);
          assert.deepStrictEqual(yield* deliveries, []);
        }).pipe(Effect.provide(layerPushServices));
      }),
    ),
  );

  it.effect("records a completion from its event and resumes from its cursor", () =>
    withPushWorld((world) =>
      Effect.gen(function* () {
        yield* register;
        yield* world.putShell(threadShell("thread"));
        yield* runEvent(world, "thread", "thread-run-1", "running");
        yield* drain;
        assert.deepStrictEqual(yield* deliveries, []);

        yield* world.putShell(threadShell("thread", completed));
        yield* runEvent(world, "thread", "thread-run-1", "completed");
        yield* drain;
        yield* drain;
        const now = yield* nowMillis;
        assert.deepStrictEqual(yield* deliveries, [
          {
            thread_id: "thread",
            attention_key: "completion:thread-run-1",
            kind: "completion",
            status: "pending",
            occurred_at: now,
            expires_at: now + 10 * 60_000,
            next_attempt_at: now + 2_000,
          },
        ]);

        yield* world.putShell(
          threadShell("thread", {
            latestRunId: RunId.make("thread-run-2"),
            status: "failed",
            activityRunStatus: null,
          }),
        );
        yield* runEvent(
          world,
          "thread",
          "thread-run-2",
          "failed",
          "command:runtime-reconcile:startup:thread:1970-01-01T00:00:00.000Z",
        );
        yield* drain;
        assert.lengthOf(yield* deliveries, 1, "a run settled by restart reconciliation is quiet");
        assert.strictEqual(yield* cursor, 3);
      }).pipe(Effect.provide(layerPushServices)),
    ),
  );

  it.effect("dates a completion by its own event when the projection is ahead of the page", () =>
    withPushWorld((world) =>
      Effect.gen(function* () {
        yield* register;
        yield* world.putShell(threadShell("thread"));
        yield* runEvent(world, "thread", "thread-run-1", "running");
        yield* TestClock.adjust("11 minutes");
        for (let index = 0; index < 255; index += 1) {
          yield* world.appendEvent({
            type: "message.updated",
            threadId: "thread",
            occurredAt: yield* DateTime.now,
            payload: {},
          });
        }
        yield* world.putShell(threadShell("thread", completed));
        yield* runEvent(world, "thread", "thread-run-1", "completed");

        yield* drain;
        const now = yield* nowMillis;
        assert.deepStrictEqual(yield* deliveries, [
          {
            thread_id: "thread",
            attention_key: "completion:thread-run-1",
            kind: "completion",
            status: "pending",
            occurred_at: now,
            expires_at: now + 10 * 60_000,
            next_attempt_at: now + 2_000,
          },
        ]);
        assert.strictEqual(yield* cursor, 257);
      }).pipe(Effect.provide(layerPushServices)),
    ),
  );

  it.effect("notifies a completion that background work held once that work ends", () =>
    withPushWorld((world) =>
      Effect.gen(function* () {
        yield* register;
        yield* world.putShell(threadShell("thread"));
        yield* runEvent(world, "thread", "thread-run-1", "running");
        yield* drain;
        yield* world.putShell(
          threadShell("thread", {
            ...completed,
            pendingBackgroundTasks: [{ taskId: "task", kind: "subagent" }],
          }),
        );
        yield* runEvent(world, "thread", "thread-run-1", "completed");
        yield* drain;
        assert.deepStrictEqual(yield* statuses, ["superseded"]);

        yield* TestClock.adjust("30 minutes");
        yield* world.putShell(threadShell("thread", completed));
        yield* world.appendEvent({
          type: "message.updated",
          threadId: "thread",
          occurredAt: yield* DateTime.now,
          payload: {},
        });
        yield* drain;
        assert.deepStrictEqual(yield* statuses, ["superseded"], "streamed text changes nothing");

        yield* world.appendEvent({
          type: "turn-item.updated",
          threadId: "thread",
          occurredAt: yield* DateTime.now,
          payload: { id: "task", type: "subagent", status: "completed" },
        });
        yield* drain;
        const now = yield* nowMillis;
        const [row] = yield* deliveries;
        assert.deepStrictEqual(
          {
            status: row?.status,
            occurredAt: row?.occurred_at,
            expiresAt: row?.expires_at,
            nextAttemptAt: row?.next_attempt_at,
          },
          {
            status: "pending",
            occurredAt: now,
            expiresAt: now + 10 * 60_000,
            nextAttemptAt: now + 2_000,
          },
        );
      }).pipe(Effect.provide(layerPushServices)),
    ),
  );

  it.effect("re-arms an approval another one hid once that one is answered", () =>
    withPushWorld((world) =>
      Effect.gen(function* () {
        yield* register;
        const first = RuntimeRequestId.make("approval-a");
        const second = RuntimeRequestId.make("approval-b");
        const pending = (id: RuntimeRequestId) =>
          Effect.map(DateTime.now, (createdAt) =>
            threadShell("thread", {
              status: "waiting",
              activityRunStatus: "waiting",
              pendingRuntimeRequest: { id, kind: "command", createdAt },
            }),
          );

        yield* world.putShell(yield* pending(first));
        yield* requestEvent(world, "thread", { id: first, kind: "command", status: "pending" });
        yield* drain;
        yield* world.putShell(yield* pending(second));
        yield* requestEvent(world, "thread", { id: second, kind: "command", status: "pending" });
        yield* drain;
        yield* drainWorker;
        assert.strictEqual(yield* sentCount(world), 1);
        assert.deepStrictEqual(yield* statuses, ["superseded", "sent"]);

        yield* world.putShell(yield* pending(first));
        yield* requestEvent(world, "thread", { id: second, kind: "command", status: "resolved" });
        yield* drain;
        yield* drainWorker;
        assert.strictEqual(yield* sentCount(world), 1);
        assert.deepStrictEqual(yield* statuses, ["sent", "sent"]);
      }).pipe(Effect.provide(layerPushServices)),
    ),
  );

  it.effect("drops a thread's alerts for good when it is archived", () =>
    withPushWorld((world) =>
      Effect.gen(function* () {
        yield* register;
        yield* world.putShell(threadShell("thread", completed));
        yield* runEvent(world, "thread", "thread-run-1", "completed");
        yield* drain;
        assert.deepStrictEqual(yield* statuses, ["pending"]);

        const archivedAt = yield* DateTime.now;
        yield* world.putShell(threadShell("thread", { ...completed, archivedAt }));
        yield* world.appendEvent({
          type: "thread.archived",
          threadId: "thread",
          occurredAt: archivedAt,
          payload: {},
        });
        yield* drain;
        yield* world.putShell(threadShell("thread", completed));
        yield* world.appendEvent({
          type: "thread.pull-request-synced",
          threadId: "thread",
          occurredAt: yield* DateTime.now,
          payload: {},
        });
        yield* drain;
        assert.deepStrictEqual(yield* statuses, ["cancelled"]);
      }).pipe(Effect.provide(layerPushServices)),
    ),
  );

  it.effect("lifts a subagent's question to its parent until the user pauses it", () =>
    withPushWorld((world) =>
      Effect.gen(function* () {
        yield* register;
        const requestId = RuntimeRequestId.make("question-1");
        const now = yield* DateTime.now;
        yield* world.putShell(threadShell(PARENT));
        yield* Ref.set(world.subagents, new Map([[PARENT, [subagentRecord(CHILD)]]]));
        yield* runEvent(world, PARENT, "parent-run-1", "running");
        yield* drain;

        yield* world.putShell(
          threadShell(CHILD, {
            lineage: {
              rootThreadId: PARENT,
              parentThreadId: PARENT,
              relationshipToParent: "subagent",
            },
            creationSource: "mcp",
            pendingRuntimeRequest: { id: requestId, kind: "user_input", createdAt: now },
          }),
        );
        yield* Ref.set(
          world.runtimeRequests,
          new Map([
            [
              requestId,
              {
                id: requestId,
                kind: "user_input",
                status: "pending",
                nativeRequestRef: { driver: "codex", nativeId: "native-1" },
                responseCapability: { type: "message" },
                createdAt: now,
              } as unknown as OrchestrationV2RuntimeRequest,
            ],
          ]),
        );
        yield* requestEvent(world, CHILD, { id: requestId, kind: "user_input", status: "pending" });
        yield* drain;

        const millis = DateTime.toEpochMillis(now);
        assert.deepStrictEqual(yield* deliveries, [
          {
            thread_id: "parent",
            attention_key: "input:child:question-1",
            kind: "input",
            status: "pending",
            occurred_at: millis,
            expires_at: millis + 120_000,
            next_attempt_at: millis,
          },
        ]);

        yield* requestEvent(world, CHILD, {
          id: requestId,
          kind: "user_input",
          status: "pending",
          autoDismissPaused: true,
        });
        yield* drain;
        assert.deepStrictEqual(yield* statuses, ["cancelled"]);
      }).pipe(Effect.provide(layerPushServices)),
    ),
  );

  it.effect("skips kinds a registration turned off", () =>
    withPushWorld((world) =>
      Effect.gen(function* () {
        yield* insertSession(SESSION);
        const { publicKey } = yield* recipientKeyPair;
        yield* (yield* PushNotifications.PushNotifications).register(
          SESSION,
          registerInput(REGISTRATION_ID, publicKey, {
            kinds: {
              approval: true,
              input: true,
              completion: false,
              failure: true,
              "usage-limit": true,
            },
          }),
        );
        yield* world.putShell(threadShell(THREAD));
        yield* runEvent(world, THREAD, "thread-run-1", "running");
        yield* drain;
        yield* world.putShell(threadShell(THREAD, completed));
        yield* runEvent(world, THREAD, "thread-run-1", "completed");
        yield* drain;
        assert.deepStrictEqual(yield* deliveries, []);
      }).pipe(Effect.provide(layerPushServices)),
    ),
  );
});
