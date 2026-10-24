import { type ClientActivityLease, ThreadId } from "@supaterm/contracts";
import {
  PushEnvelope,
  PushNotificationError,
  PushNotificationKind,
} from "@supaterm/contracts/push";
import { makeDrainableWorker } from "@supaterm/shared/DrainableWorker";
import { PUSH_MAX_LIFETIME_MS } from "@supaterm/shared/push/envelope";
import { buildPushContent } from "@supaterm/shared/push/plaintext";
import * as Context from "effect/Context";
import * as DateTime from "effect/DateTime";
import * as Effect from "effect/Effect";
import * as FiberHandle from "effect/FiberHandle";
import * as Layer from "effect/Layer";
import * as Option from "effect/Option";
import * as Random from "effect/Random";
import * as Schema from "effect/Schema";
import type * as Scope from "effect/Scope";
import * as Semaphore from "effect/Semaphore";
import * as Stream from "effect/Stream";
import * as SqlClient from "effect/sql/SqlClient";

import * as BackgroundPolicy from "../background/BackgroundPolicy.ts";
import * as ServerEnvironment from "../environment/ServerEnvironment.ts";
import * as ProjectStore from "../orchestration-v2/ProjectStore.ts";
import { forkParked } from "../serverActivation.ts";
import * as ServerSettings from "../serverSettings.ts";
import * as PushAttention from "./PushAttention.ts";
import * as PushGatewayClient from "./PushGatewayClient.ts";
import * as PushIdentity from "./PushIdentity.ts";
import * as PushRegistrations from "./PushRegistrations.ts";

const LEASE_MS = 60_000;
/** Lets a client that is watching the thread report the interaction that makes the alert moot. */
export const COMPLETION_GRACE_MS = 2_000;
const BACKOFF_MS = [2_000, 5_000, 15_000, 60_000, 300_000] as const;
/** How long after a client's last input it still counts as watching the thread. */
const RECENT_INTERACTION_MS = 45_000;
/** Input this close before a completion, reported after it, means the user saw it land. */
const SEEN_INPUT_WINDOW_MS = 10_000;
const SETTLED_RETENTION_MS = 7 * 24 * 60 * 60_000;

const DeliveryRow = Schema.Struct({
  deliveryId: Schema.Number,
  registrationId: Schema.String,
  threadId: ThreadId,
  attentionKey: Schema.String,
  kind: PushNotificationKind,
  occurredAt: Schema.Number,
  expiresAt: Schema.Number,
  attempts: Schema.Number,
  envelope: Schema.NullOr(Schema.fromJsonString(PushEnvelope)),
  envelopeExpiresAt: Schema.NullOr(Schema.Number),
  envelopeRevision: Schema.NullOr(Schema.Number),
  notificationId: Schema.String,
});
type DeliveryRow = typeof DeliveryRow.Type;
const decodeDeliveryRows = Schema.decodeUnknownEffect(Schema.Array(DeliveryRow));
const encodeEnvelope = Schema.encodeEffect(Schema.fromJsonString(PushEnvelope));

const storageError = (cause: unknown) => new PushNotificationError({ reason: "storage", cause });

const watchesThread = (lease: ClientActivityLease, threadId: ThreadId, now: number) =>
  lease.visible &&
  DateTime.toEpochMillis(lease.expiresAt) > now &&
  lease.scopes.some((scope) => scope.type === "thread" && scope.threadId === threadId);

export class PushDeliveryWorker extends Context.Service<
  PushDeliveryWorker,
  {
    readonly start: () => Effect.Effect<void, never, Scope.Scope>;
    /** Asks the worker to attempt whatever is due. */
    readonly wake: Effect.Effect<void>;
    /** Wakes the worker and waits until every due delivery was attempted. */
    readonly drain: Effect.Effect<void>;
  }
>()("supaterm/notifications/PushDeliveryWorker") {}

const make = Effect.gen(function* () {
  const sql = yield* SqlClient.SqlClient;
  const settings = yield* ServerSettings.ServerSettingsService;
  const environment = yield* ServerEnvironment.ServerEnvironment;
  const projects = yield* ProjectStore.ProjectStoreV2;
  const backgroundPolicy = yield* BackgroundPolicy.BackgroundPolicy;
  const attention = yield* PushAttention.PushAttention;
  const registrations = yield* PushRegistrations.PushRegistrations;
  const identity = yield* PushIdentity.PushIdentity;
  const gateway = yield* PushGatewayClient.PushGatewayClient;
  const lane = yield* Semaphore.make(1);
  const timer = yield* FiberHandle.make<void, never>();
  const nowMillis = DateTime.now.pipe(Effect.map(DateTime.toEpochMillis));

  const columns = sql`
    delivery_id AS "deliveryId",
    registration_id AS "registrationId",
    thread_id AS "threadId",
    attention_key AS "attentionKey",
    kind,
    occurred_at AS "occurredAt",
    expires_at AS "expiresAt",
    attempts,
    envelope_json AS "envelope",
    envelope_expires_at AS "envelopeExpiresAt",
    envelope_revision AS "envelopeRevision",
    notification_id AS "notificationId"
  `;

  const claim = Effect.fnUntraced(function* (now: number) {
    const rows = yield* sql`
      UPDATE push_deliveries SET status = 'leased', lease_until = ${now + LEASE_MS}
      WHERE delivery_id = (
        SELECT delivery_id FROM push_deliveries
        WHERE (status = 'pending' AND next_attempt_at <= ${now})
          OR (status = 'leased' AND lease_until <= ${now})
        ORDER BY next_attempt_at, delivery_id
        LIMIT 1
      )
      RETURNING ${columns}
    `;
    return (yield* decodeDeliveryRows(rows))[0];
  });

  const finish = (
    row: DeliveryRow,
    status: "sent" | "superseded" | "cancelled" | "expired" | "failed",
    attempted = status === "sent" || status === "failed",
  ) =>
    sql`
      UPDATE push_deliveries
      SET status = ${status}, lease_until = NULL, attempts = attempts + ${attempted ? 1 : 0}
      WHERE delivery_id = ${row.deliveryId} AND status = 'leased'
    `.pipe(Effect.asVoid);

  const reschedule = (row: DeliveryRow, nextAttemptAt: number, attempted: boolean) =>
    sql`
      UPDATE push_deliveries
      SET status = 'pending', lease_until = NULL, next_attempt_at = ${nextAttemptAt},
        attempts = attempts + ${attempted ? 1 : 0}
      WHERE delivery_id = ${row.deliveryId} AND status = 'leased'
    `.pipe(Effect.asVoid);

  const retryLater = Effect.fnUntraced(function* (
    row: DeliveryRow,
    now: number,
    retryAfterMs: number | null,
  ) {
    const base = BACKOFF_MS[Math.min(row.attempts, BACKOFF_MS.length - 1)]!;
    const jittered = Math.round(base * (0.8 + 0.4 * (yield* Random.next)));
    const next = now + Math.max(jittered, retryAfterMs ?? 0);
    yield* next >= row.expiresAt ? finish(row, "expired", true) : reschedule(row, next, true);
  });

  /** When a client still watching the thread should hold the alert back, or null to send now. */
  const suppression = Effect.fnUntraced(function* (row: DeliveryRow, now: number) {
    const { leases } = yield* backgroundPolicy.snapshot;
    const watching = leases.filter((lease) => watchesThread(lease, row.threadId, now));
    if (!PushAttention.isRequestKind(row.kind)) {
      const seenAfterEvent = watching.some(
        (lease) =>
          lease.lastInteractionAt !== undefined &&
          DateTime.toEpochMillis(lease.updatedAt) >= row.occurredAt &&
          DateTime.toEpochMillis(lease.lastInteractionAt) >= row.occurredAt - SEEN_INPUT_WINDOW_MS,
      );
      return seenAfterEvent ? ("drop" as const) : null;
    }
    let deferUntil: number | null = null;
    for (const lease of watching) {
      if (lease.lastInteractionAt === undefined) continue;
      const recentUntil = DateTime.toEpochMillis(lease.lastInteractionAt) + RECENT_INTERACTION_MS;
      if (recentUntil <= now) continue;
      const until = Math.min(recentUntil, DateTime.toEpochMillis(lease.expiresAt));
      deferUntil = deferUntil === null ? until : Math.min(deferUntil, until);
    }
    return deferUntil;
  });

  const sealFor = Effect.fnUntraced(function* (
    row: DeliveryRow,
    registration: PushRegistrations.PushRegistrationRecord,
    state: PushAttention.PushThreadAttentionState,
    now: number,
  ) {
    if (
      row.envelope !== null &&
      row.envelopeRevision === registration.revision &&
      (row.envelopeExpiresAt ?? 0) > now
    ) {
      return row.envelope;
    }
    const project = yield* projects.getShell(state.thread.projectId);
    const detail = registration.preview === "full" ? yield* attention.detail(state) : null;
    const content = buildPushContent(
      {
        environmentId: yield* environment.getEnvironmentId,
        threadId: row.threadId,
        kind: row.kind,
        threadTitle: state.thread.title,
        projectTitle: Option.getOrNull(project)?.title ?? null,
        detail,
      },
      registration.preview,
    );
    const expiresAt = Math.min(row.expiresAt, now + PUSH_MAX_LIFETIME_MS);
    const envelope = yield* identity.seal({
      recipientPublicKey: registration.recipientPublicKey,
      metadata: {
        registrationId: registration.registrationId,
        keyId: registration.keyId,
        notificationId: row.notificationId,
        createdAt: now,
        expiresAt,
      },
      content,
    });
    const encoded = yield* encodeEnvelope(envelope);
    yield* sql`
      UPDATE push_deliveries
      SET envelope_json = ${encoded}, envelope_expires_at = ${expiresAt},
        envelope_revision = ${registration.revision}
      WHERE delivery_id = ${row.deliveryId} AND status = 'leased'
    `;
    return envelope;
  });

  const retireHandle = (registration: PushRegistrations.PushRegistrationRecord) =>
    gateway
      .deleteHandle({ origin: registration.gatewayOrigin, handle: registration.handle })
      .pipe(Effect.ignore);

  const attempt = Effect.fn("PushDeliveryWorker.attempt")(function* (row: DeliveryRow) {
    const now = yield* nowMillis;
    if (row.expiresAt <= now) return yield* finish(row, "expired");
    const registration = Option.getOrUndefined(yield* registrations.get(row.registrationId));
    const { pushNotificationsEnabled } = yield* settings.getSettings;
    if (
      registration === undefined ||
      registration.status !== "active" ||
      !pushNotificationsEnabled ||
      !registration.kinds[row.kind]
    ) {
      return yield* finish(row, "cancelled");
    }
    if (!(yield* registrations.isSessionValid(registration.sessionId))) {
      yield* finish(row, "cancelled");
      const retired = yield* registrations.retireSessions(registration.sessionId);
      return yield* Effect.forEach(retired, retireHandle, { discard: true });
    }
    const state = yield* attention.forThread(row.threadId);
    if (state === null) return yield* finish(row, "cancelled");
    // The candidate reactor rearms it if this attention becomes current again.
    if (state.attention?.key !== row.attentionKey) return yield* finish(row, "superseded");
    if (!PushAttention.isRequestKind(row.kind) && now < row.occurredAt + COMPLETION_GRACE_MS) {
      return yield* reschedule(row, row.occurredAt + COMPLETION_GRACE_MS, false);
    }
    const held = yield* suppression(row, now);
    if (held === "drop") return yield* finish(row, "cancelled");
    if (held !== null) return yield* reschedule(row, Math.min(held, row.expiresAt), false);

    const sent = yield* Effect.gen(function* () {
      const envelope = yield* sealFor(row, registration, state, now);
      return yield* gateway.send({
        origin: registration.gatewayOrigin,
        handle: registration.handle,
        payload: envelope,
        expiration: Math.floor(envelope.expiresAt / 1000),
        priority: PushAttention.isRequestKind(row.kind) ? 10 : 5,
        collapseId: yield* identity.collapseId({
          registrationId: registration.registrationId,
          threadId: row.threadId,
        }),
      });
    }).pipe(
      Effect.catchTags({
        PushGatewayUnavailableError: () =>
          Effect.succeed({ type: "retry", retryAfterMs: null } as const),
        PushIdentityError: () => Effect.succeed({ type: "retry", retryAfterMs: null } as const),
        PushGatewayOriginError: () => Effect.succeed({ type: "rejected", status: 0 } as const),
        PushSealError: () => Effect.succeed({ type: "rejected", status: 0 } as const),
      }),
    );
    switch (sent.type) {
      case "accepted":
        yield* finish(row, "sent");
        return yield* registrations.recordDelivery(registration.registrationId);
      case "gone":
        yield* finish(row, "failed");
        return yield* registrations.markGone(registration.registrationId);
      case "retry":
        return yield* retryLater(row, now, sent.retryAfterMs);
      case "rejected":
        return yield* finish(row, "failed");
    }
  });

  const scheduleNextWake = Effect.fnUntraced(function* () {
    const rows = yield* sql<{ readonly due: number | null }>`
      SELECT MIN(CASE WHEN status = 'leased' THEN lease_until ELSE next_attempt_at END) AS due
      FROM push_deliveries WHERE status IN ('pending', 'leased')
    `;
    const due = rows[0]?.due ?? null;
    if (due === null) return yield* FiberHandle.clear(timer);
    const delay = Math.max(0, due - (yield* nowMillis));
    yield* FiberHandle.run(timer, Effect.sleep(delay).pipe(Effect.andThen(wake)));
  });

  const processDue = lane
    .withPermit(
      Effect.gen(function* () {
        const now = yield* nowMillis;
        yield* sql`
        UPDATE push_deliveries SET status = 'expired', lease_until = NULL
        WHERE status IN ('pending', 'leased') AND expires_at <= ${now}
      `;
        for (;;) {
          const row = yield* claim(yield* nowMillis);
          if (row === undefined) break;
          yield* attempt(row).pipe(
            Effect.catchCause((cause) =>
              Effect.logWarning("push delivery attempt failed", { cause }).pipe(
                Effect.andThen(retryLater(row, now, null)),
              ),
            ),
          );
        }
        yield* scheduleNextWake();
      }),
    )
    .pipe(Effect.mapError(storageError));

  const worker = yield* makeDrainableWorker(() => processDue);
  const wake: PushDeliveryWorker["Service"]["wake"] = worker.enqueue(undefined);

  // A request held back for a watching client is re-checked as soon as client activity changes.
  const hastenDeferredRequests = Effect.gen(function* () {
    const now = yield* nowMillis;
    const hastened = yield* sql`
      UPDATE push_deliveries SET next_attempt_at = ${now}
      WHERE status = 'pending' AND attempts = 0 AND kind IN ('approval', 'input')
        AND next_attempt_at > ${now}
      RETURNING delivery_id
    `;
    if (hastened.length > 0) yield* wake;
  });

  const start: PushDeliveryWorker["Service"]["start"] = Effect.fn("PushDeliveryWorker.start")(
    function* () {
      yield* forkParked(
        Effect.gen(function* () {
          const now = yield* nowMillis;
          yield* sql`
            DELETE FROM push_deliveries
            WHERE status IN ('sent', 'superseded', 'cancelled', 'expired', 'failed')
              AND occurred_at < ${now - SETTLED_RETENTION_MS}
          `;
          yield* wake;
          yield* Stream.runForEach(backgroundPolicy.streamChanges, () => hastenDeferredRequests);
        }).pipe(
          Effect.catchCause((cause) =>
            Effect.logWarning("push delivery worker stopped", { cause }),
          ),
        ),
      );
    },
  );

  return PushDeliveryWorker.of({
    start,
    wake,
    drain: wake.pipe(Effect.andThen(worker.drain)),
  });
});

export const layer = Layer.effect(PushDeliveryWorker, make);
