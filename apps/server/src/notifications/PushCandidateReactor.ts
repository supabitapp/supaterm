import type {
  OrchestrationV2DomainEvent,
  OrchestrationV2StoredEvent,
  RunId,
  RuntimeRequestId,
  ThreadId,
} from "@supaterm/contracts";
import { PushNotificationError } from "@supaterm/contracts/push";
import { makeDrainableWorker } from "@supaterm/shared/DrainableWorker";
import { turnItemUpdateCanEndBackgroundWork } from "@supaterm/shared/orchestrationV2PendingBackgroundWork";
import {
  requestAttention,
  runAttention,
  runtimeRequestAttentionKind,
  type ThreadNotificationAttention,
  type ThreadNotificationRequestAttention,
} from "@supaterm/shared/threadNotificationAttention";
import * as Context from "effect/Context";
import * as Crypto from "effect/Crypto";
import * as DateTime from "effect/DateTime";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";
import * as Ref from "effect/Ref";
import type * as Scope from "effect/Scope";
import * as Semaphore from "effect/Semaphore";
import * as Stream from "effect/Stream";
import * as SqlClient from "effect/sql/SqlClient";
import type * as SqlError from "effect/sql/SqlError";

import * as EventStore from "../orchestration-v2/EventStore.ts";
import * as Orchestrator from "../orchestration-v2/Orchestrator.ts";
import { forkParked } from "../serverActivation.ts";
import * as ServerSettings from "../serverSettings.ts";
import * as PushAttention from "./PushAttention.ts";
import * as PushDeliveryWorker from "./PushDeliveryWorker.ts";
import * as PushRegistrations from "./PushRegistrations.ts";

const CURSOR_NAME = "push-candidates";
const PAGE_SIZE = 256;
const COMPLETION_FRESHNESS_MS = 10 * 60_000;
/** Approvals and questions stay eligible until answered; each envelope still expires in 24 h. */
const UNTIL_RESOLVED = Number.MAX_SAFE_INTEGER;
const RECONCILE_COMMAND_PREFIX = "command:runtime-reconcile:";

const CHANGE_EVENT_TYPES: ReadonlySet<OrchestrationV2DomainEvent["type"]> = new Set([
  "thread.provider-switched",
  "thread.pull-request-link-updated",
  "thread.pull-request-synced",
  "thread.workflow-run-watch-synced",
  "run.created",
  "run.updated",
  "run.background-work-cancelled",
  "run-attempt.created",
  "run-attempt.updated",
  "subagent.updated",
  "provider-session.detached",
  "provider-thread.updated",
  "runtime-request.updated",
]);

/** Whether an event can change what a thread needs from the user; streamed text never does. */
const affectsAttention = (event: OrchestrationV2DomainEvent) =>
  CHANGE_EVENT_TYPES.has(event.type) ||
  event.type === "thread.archived" ||
  event.type === "thread.deleted" ||
  // Commands never hold a completion back, and they finish far more often than work that does.
  (event.type === "turn-item.updated" &&
    event.payload.type !== "command_execution" &&
    turnItemUpdateCanEndBackgroundWork(event.payload));

/** Something that needs the user, as the event that raised it describes it. */
type Occurrence =
  | { readonly type: "run"; readonly runId: RunId; readonly failed: boolean }
  | {
      readonly type: "request";
      readonly kind: ThreadNotificationRequestAttention["kind"];
      readonly requestId: RuntimeRequestId;
    };

const occurrenceOf = (event: OrchestrationV2DomainEvent): Occurrence | null => {
  switch (event.type) {
    case "run.created":
    case "run.updated":
      return event.payload.status === "completed" || event.payload.status === "failed"
        ? { type: "run", runId: event.payload.id, failed: event.payload.status === "failed" }
        : null;
    case "runtime-request.updated": {
      if (event.payload.status !== "pending" || event.payload.autoDismissPaused === true) {
        return null;
      }
      const kind = runtimeRequestAttentionKind(event.payload.kind);
      return kind === null ? null : { type: "request", kind, requestId: event.payload.id };
    }
    default:
      return null;
  }
};

interface ThreadEvents {
  /** When the latest user-driven event that could change this thread's attention happened. */
  changedAt: number | null;
  /** Server restart reconciliation touched the thread; it settles work nobody is waiting on. */
  reconciled: boolean;
  occurrences: Array<{ readonly occurrence: Occurrence; readonly occurredAt: number }>;
}

interface RootEvents {
  readonly state: PushAttention.PushThreadAttentionState;
  changedAt: number | null;
  reconciled: boolean;
  readonly occurrences: Map<
    string,
    { readonly attention: ThreadNotificationAttention; readonly occurredAt: number }
  >;
}

interface DeliverySchedule {
  readonly occurredAt: number;
  readonly expiresAt: number;
  readonly nextAttemptAt: number;
}

const collectEvents = (page: ReadonlyArray<OrchestrationV2StoredEvent>) => {
  const threads = new Map<ThreadId, ThreadEvents>();
  const dismissedThreadIds = new Set<ThreadId>();
  // Pausing a question's auto-dismiss shows the user saw it.
  const seenRequests: Array<{ readonly threadId: ThreadId; readonly requestId: RuntimeRequestId }> =
    [];
  for (const stored of page) {
    const event = stored.event;
    if (!affectsAttention(event)) continue;
    const entry = threads.get(event.threadId) ?? {
      changedAt: null,
      reconciled: false,
      occurrences: [],
    };
    threads.set(event.threadId, entry);
    if (event.type === "thread.archived" || event.type === "thread.deleted") {
      dismissedThreadIds.add(event.threadId);
      entry.occurrences = [];
      continue;
    }
    if (String(stored.commandId).startsWith(RECONCILE_COMMAND_PREFIX)) {
      entry.reconciled = true;
      continue;
    }
    const occurredAt = DateTime.toEpochMillis(event.occurredAt);
    entry.changedAt = Math.max(entry.changedAt ?? occurredAt, occurredAt);
    if (
      event.type === "runtime-request.updated" &&
      event.payload.status === "pending" &&
      event.payload.autoDismissPaused === true
    ) {
      seenRequests.push({ threadId: event.threadId, requestId: event.payload.id });
    }
    const occurrence = occurrenceOf(event);
    if (occurrence !== null) entry.occurrences.push({ occurrence, occurredAt });
  }
  return { threads, dismissedThreadIds, seenRequests };
};

const occurrenceAttention = (
  rootId: ThreadId,
  threadId: ThreadId,
  occurrence: Occurrence,
  current: ThreadNotificationAttention | null,
): ThreadNotificationAttention | null => {
  if (occurrence.type === "request") {
    return requestAttention(occurrence.kind, rootId, threadId, occurrence.requestId);
  }
  if (threadId !== rootId) return null;
  if (!occurrence.failed) return runAttention("completion", rootId, occurrence.runId);
  // Only the projection tells a usage limit from another failure.
  return current?.kind === "usage-limit" && current.runId === occurrence.runId
    ? current
    : runAttention("failure", rootId, occurrence.runId);
};

const storageError = (cause: unknown) => new PushNotificationError({ reason: "storage", cause });

export class PushCandidateReactor extends Context.Service<
  PushCandidateReactor,
  {
    readonly start: () => Effect.Effect<void, never, Scope.Scope>;
    /** Processes every stored event after the cursor. */
    readonly drain: Effect.Effect<void, PushNotificationError>;
  }
>()("supaterm/notifications/PushCandidateReactor") {}

const make = Effect.gen(function* () {
  const sql = yield* SqlClient.SqlClient;
  const crypto = yield* Crypto.Crypto;
  const eventStore = yield* EventStore.EventStoreV2;
  const engine = yield* Orchestrator.OrchestratorV2;
  const settings = yield* ServerSettings.ServerSettingsService;
  const attention = yield* PushAttention.PushAttention;
  const registrations = yield* PushRegistrations.PushRegistrations;
  const deliveries = yield* PushDeliveryWorker.PushDeliveryWorker;
  const lane = yield* Semaphore.make(1);

  // A first boot starts at the head so existing history never notifies.
  yield* Effect.gen(function* () {
    const latest = yield* eventStore.latestSequence();
    const now = DateTime.formatIso(yield* DateTime.now);
    yield* sql`
      INSERT INTO orchestration_v2_projection_metadata (
        projection_name, schema_version, last_sequence, updated_at
      )
      VALUES (${CURSOR_NAME}, 1, ${latest}, ${now})
      ON CONFLICT(projection_name) DO NOTHING
    `;
  }).pipe(Effect.mapError(storageError));

  const readCursor = sql<{ readonly last_sequence: number }>`
    SELECT last_sequence FROM orchestration_v2_projection_metadata
    WHERE projection_name = ${CURSOR_NAME}
  `.pipe(Effect.map((rows) => rows[0]?.last_sequence ?? 0));

  const scheduleFrom = Effect.fnUntraced(function* (
    value: ThreadNotificationAttention,
    occurredAt: number,
  ) {
    if (!PushAttention.isRequestAttention(value)) {
      return {
        occurredAt,
        expiresAt: occurredAt + COMPLETION_FRESHNESS_MS,
        nextAttemptAt: occurredAt + PushDeliveryWorker.COMPLETION_GRACE_MS,
      } satisfies DeliverySchedule;
    }
    const deadline = yield* attention.requestDeadline(value);
    return {
      occurredAt,
      expiresAt: deadline ?? UNTIL_RESOLVED,
      nextAttemptAt: occurredAt,
    } satisfies DeliverySchedule;
  });

  /** Records an occurrence; a dormant one waits as superseded until its attention is current. */
  const insertDelivery = (input: {
    readonly registrationId: string;
    readonly rootId: ThreadId;
    readonly attention: ThreadNotificationAttention;
    readonly schedule: DeliverySchedule;
    readonly current: boolean;
    readonly notificationId: string;
  }) => {
    const request = PushAttention.isRequestAttention(input.attention) ? input.attention : null;
    return sql`
      INSERT INTO push_deliveries (
        registration_id, thread_id, attention_key, kind, request_thread_id, request_id,
        occurred_at, expires_at, status, attempts, next_attempt_at, notification_id
      )
      VALUES (
        ${input.registrationId}, ${input.rootId}, ${input.attention.key}, ${input.attention.kind},
        ${request?.sourceThreadId ?? null}, ${request?.requestId ?? null},
        ${input.schedule.occurredAt}, ${input.schedule.expiresAt},
        ${input.current ? "pending" : "superseded"}, 0, ${input.schedule.nextAttemptAt},
        ${input.notificationId}
      )
      ON CONFLICT(registration_id, thread_id, attention_key) DO UPDATE SET
        status = 'pending',
        lease_until = NULL,
        occurred_at = excluded.occurred_at,
        expires_at = excluded.expires_at,
        next_attempt_at = excluded.next_attempt_at,
        envelope_json = NULL,
        envelope_expires_at = NULL,
        envelope_revision = NULL
      WHERE push_deliveries.status = 'superseded' AND excluded.status = 'pending'
    `;
  };

  const rearmDeliveries = (rootId: ThreadId, key: string, schedule: DeliverySchedule) => sql`
    UPDATE push_deliveries
    SET status = 'pending', lease_until = NULL, occurred_at = ${schedule.occurredAt},
      expires_at = ${schedule.expiresAt}, next_attempt_at = ${schedule.nextAttemptAt},
      envelope_json = NULL, envelope_expires_at = NULL, envelope_revision = NULL
    WHERE thread_id = ${rootId} AND attention_key = ${key} AND status = 'superseded'
    RETURNING delivery_id
  `;

  const retireDormant = (rootId: ThreadId, key: string) => sql`
    UPDATE push_deliveries SET status = 'expired'
    WHERE thread_id = ${rootId} AND attention_key = ${key} AND status = 'superseded'
  `;

  const processPage = Effect.fn("PushCandidateReactor.processPage")(function* (
    page: ReadonlyArray<OrchestrationV2StoredEvent>,
  ) {
    const throughSequence = page.at(-1)?.sequence ?? 0;
    const { threads, dismissedThreadIds, seenRequests } = collectEvents(page);

    // The projection may already be past this page, so it only decides which occurrence is current.
    const roots = new Map<ThreadId, RootEvents>();
    for (const [threadId, entry] of threads) {
      const state = yield* attention.forThread(threadId);
      if (state === null || state.thread.archivedAt !== null || state.thread.deletedAt !== null) {
        continue;
      }
      const rootId = state.thread.id;
      const root: RootEvents = roots.get(rootId) ?? {
        state,
        changedAt: null,
        reconciled: false,
        occurrences: new Map(),
      };
      roots.set(rootId, root);
      if (entry.changedAt !== null) {
        root.changedAt = Math.max(root.changedAt ?? entry.changedAt, entry.changedAt);
      }
      root.reconciled ||= entry.reconciled;
      for (const { occurrence, occurredAt } of entry.occurrences) {
        const value = occurrenceAttention(rootId, threadId, occurrence, state.attention);
        if (value === null) continue;
        const known = root.occurrences.get(value.key);
        if (known === undefined || known.occurredAt < occurredAt) {
          root.occurrences.set(value.key, { attention: value, occurredAt });
        }
      }
    }

    const enabled = yield* settings.getSettings.pipe(
      Effect.map((current) => current.pushNotificationsEnabled),
    );
    const recipients = enabled ? yield* registrations.listDeliverable : [];
    const now = DateTime.toEpochMillis(yield* DateTime.now);

    // Each write reports whether it left a delivery for the worker to send.
    const writes: Array<Effect.Effect<boolean, SqlError.SqlError>> = [];
    for (const threadId of dismissedThreadIds) {
      writes.push(
        Effect.as(
          sql`
            UPDATE push_deliveries SET status = 'cancelled', lease_until = NULL
            WHERE thread_id = ${threadId} AND status IN ('pending', 'leased', 'superseded')
          `,
          false,
        ),
      );
    }
    for (const [rootId, root] of roots) {
      const current = root.state.attention;
      for (const { attention: value, occurredAt } of root.occurrences.values()) {
        const isCurrent = value.key === current?.key;
        const schedule = yield* scheduleFrom(value, Math.min(occurredAt, now));
        if (isCurrent && schedule.expiresAt <= now) continue;
        for (const registration of recipients) {
          if (!registration.kinds[value.kind]) continue;
          const insert = insertDelivery({
            registrationId: registration.registrationId,
            rootId,
            attention: value,
            schedule,
            current: isCurrent,
            notificationId: yield* crypto.randomUUIDv4(),
          });
          writes.push(Effect.as(insert, isCurrent));
        }
      }
      // Attention returned to an earlier occurrence, such as a completion that background work
      // held back or an approval hidden behind another; the events that brought it back date it.
      if (current === null || root.occurrences.has(current.key)) continue;
      if (root.changedAt === null) {
        if (root.reconciled) writes.push(Effect.as(retireDormant(rootId, current.key), false));
        continue;
      }
      const schedule = yield* scheduleFrom(current, Math.min(root.changedAt, now));
      if (schedule.expiresAt <= now) continue;
      writes.push(
        rearmDeliveries(rootId, current.key, schedule).pipe(Effect.map((rows) => rows.length > 0)),
      );
    }
    for (const request of seenRequests) {
      writes.push(
        Effect.as(
          sql`
            UPDATE push_deliveries SET status = 'cancelled', lease_until = NULL
            WHERE request_thread_id = ${request.threadId} AND request_id = ${request.requestId}
              AND status IN ('pending', 'leased', 'superseded')
          `,
          false,
        ),
      );
    }

    const updatedAt = DateTime.formatIso(yield* DateTime.now);
    const armed = yield* sql.withTransaction(
      Effect.gen(function* () {
        let armed = false;
        for (const write of writes) armed = (yield* write) || armed;
        yield* sql`
          UPDATE orchestration_v2_projection_metadata
          SET last_sequence = ${throughSequence}, updated_at = ${updatedAt}
          WHERE projection_name = ${CURSOR_NAME}
        `;
        return armed;
      }),
    );
    if (armed) yield* deliveries.wake;
  }, Effect.mapError(storageError));

  const drain: PushCandidateReactor["Service"]["drain"] = lane.withPermit(
    Effect.gen(function* () {
      for (;;) {
        const cursor = yield* readCursor.pipe(Effect.mapError(storageError));
        const page = yield* eventStore
          .read({ afterSequence: cursor, limit: PAGE_SIZE })
          .pipe(Stream.runCollect, Effect.mapError(storageError));
        if (page.length === 0) return;
        yield* processPage(page);
        if (page.length < PAGE_SIZE) return;
      }
    }),
  );

  const start: PushCandidateReactor["Service"]["start"] = Effect.fn("PushCandidateReactor.start")(
    function* () {
      const scheduled = yield* Ref.make(false);
      const worker = yield* makeDrainableWorker(() =>
        Ref.set(scheduled, false).pipe(Effect.andThen(drain)),
      );
      const schedule = Ref.getAndSet(scheduled, true).pipe(
        Effect.flatMap((already) => (already ? Effect.void : worker.enqueue(undefined))),
      );
      yield* schedule;
      yield* forkParked(
        Stream.runForEach(engine.streamDomainEvents, (event) =>
          affectsAttention(event) ? schedule : Effect.void,
        ).pipe(
          Effect.catchCause((cause) =>
            Effect.logWarning("push candidate event stream failed", { cause }),
          ),
        ),
      );
    },
  );

  return PushCandidateReactor.of({ start, drain });
});

export const layer = Layer.effect(PushCandidateReactor, make);
