import { AuthSessionId } from "@supaterm/contracts";
import {
  PushKinds,
  PushNotificationError,
  PushPreviewLevel,
  PushRegistrationStatus,
} from "@supaterm/contracts/push";
import * as Context from "effect/Context";
import * as DateTime from "effect/DateTime";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";
import * as Option from "effect/Option";
import * as Schema from "effect/Schema";
import * as SqlClient from "effect/sql/SqlClient";
import * as SqlSchema from "effect/sql/SqlSchema";

export const PushRegistrationRecord = Schema.Struct({
  registrationId: Schema.String,
  sessionId: AuthSessionId,
  gatewayOrigin: Schema.String,
  handle: Schema.String,
  keyId: Schema.String,
  recipientPublicKey: Schema.String,
  preview: PushPreviewLevel,
  kinds: Schema.fromJsonString(PushKinds),
  deviceName: Schema.NullOr(Schema.String),
  status: PushRegistrationStatus,
  createdAt: Schema.DateTimeUtcFromString,
  lastDeliveryAt: Schema.NullOr(Schema.DateTimeUtcFromString),
  /** Bumped by every registration write, so an envelope sealed before it is never reused. */
  revision: Schema.Number,
});
export type PushRegistrationRecord = typeof PushRegistrationRecord.Type;

const ListedRegistration = Schema.Struct({
  ...PushRegistrationRecord.fields,
  sessionLabel: Schema.NullOr(Schema.String),
});

export type PushRegistrationWrite = Omit<
  PushRegistrationRecord,
  "status" | "createdAt" | "lastDeliveryAt" | "revision"
>;

const encodeKinds = Schema.encodeEffect(Schema.fromJsonString(PushKinds));

const storageError = (cause: unknown) => new PushNotificationError({ reason: "storage", cause });

export class PushRegistrations extends Context.Service<
  PushRegistrations,
  {
    readonly get: (
      registrationId: string,
    ) => Effect.Effect<Option.Option<PushRegistrationRecord>, PushNotificationError>;
    /**
     * Inserts or replaces the registration and reactivates it, failing with `conflict` when
     * another session owns the id. Returns what it replaced.
     */
    readonly register: (
      input: PushRegistrationWrite,
    ) => Effect.Effect<Option.Option<PushRegistrationRecord>, PushNotificationError>;
    readonly remove: (
      registrationId: string,
    ) => Effect.Effect<Option.Option<PushRegistrationRecord>, PushNotificationError>;
    readonly list: Effect.Effect<
      ReadonlyArray<typeof ListedRegistration.Type>,
      PushNotificationError
    >;
    /** Active registrations whose session is still valid. */
    readonly listDeliverable: Effect.Effect<
      ReadonlyArray<PushRegistrationRecord>,
      PushNotificationError
    >;
    readonly isSessionValid: (
      sessionId: AuthSessionId,
    ) => Effect.Effect<boolean, PushNotificationError>;
    readonly markGone: (registrationId: string) => Effect.Effect<void, PushNotificationError>;
    /**
     * Marks active registrations gone when their session is `sessionId`, or, without one,
     * when their session is revoked, expired, or missing. Returns what changed.
     */
    readonly retireSessions: (
      sessionId?: AuthSessionId,
    ) => Effect.Effect<ReadonlyArray<PushRegistrationRecord>, PushNotificationError>;
    readonly recordDelivery: (registrationId: string) => Effect.Effect<void, PushNotificationError>;
  }
>()("supaterm/notifications/PushRegistrations") {}

const make = Effect.gen(function* () {
  const sql = yield* SqlClient.SqlClient;
  const nowIso = DateTime.now.pipe(Effect.map(DateTime.formatIso));

  const columns = sql`
    registration_id AS "registrationId",
    session_id AS "sessionId",
    gateway_origin AS "gatewayOrigin",
    handle,
    key_id AS "keyId",
    recipient_public_key AS "recipientPublicKey",
    preview,
    kinds_json AS "kinds",
    device_name AS "deviceName",
    status,
    created_at AS "createdAt",
    last_delivery_at AS "lastDeliveryAt",
    revision
  `;

  const findById = SqlSchema.findOneOption({
    Request: Schema.String,
    Result: PushRegistrationRecord,
    execute: (registrationId) =>
      sql`SELECT ${columns} FROM push_registrations WHERE registration_id = ${registrationId}`,
  });

  const get: PushRegistrations["Service"]["get"] = (registrationId) =>
    findById(registrationId).pipe(Effect.mapError(storageError));

  const register: PushRegistrations["Service"]["register"] = Effect.fn(
    "PushRegistrations.register",
  )(function* (input) {
    const now = yield* nowIso;
    const kinds = yield* encodeKinds(input.kinds).pipe(Effect.mapError(storageError));
    return yield* sql
      .withTransaction(
        Effect.gen(function* () {
          const existing = yield* findById(input.registrationId);
          if (Option.isSome(existing) && existing.value.sessionId !== input.sessionId) {
            return yield* new PushNotificationError({ reason: "conflict" });
          }
          yield* sql`
            INSERT INTO push_registrations (
              registration_id, session_id, gateway_origin, handle, key_id, recipient_public_key,
              preview, kinds_json, device_name, status, created_at, updated_at, last_delivery_at,
              revision
            )
            VALUES (
              ${input.registrationId}, ${input.sessionId}, ${input.gatewayOrigin}, ${input.handle},
              ${input.keyId}, ${input.recipientPublicKey}, ${input.preview}, ${kinds},
              ${input.deviceName}, 'active', ${now}, ${now}, NULL, 0
            )
            ON CONFLICT(registration_id) DO UPDATE SET
              gateway_origin = excluded.gateway_origin,
              handle = excluded.handle,
              key_id = excluded.key_id,
              recipient_public_key = excluded.recipient_public_key,
              preview = excluded.preview,
              kinds_json = excluded.kinds_json,
              device_name = excluded.device_name,
              status = 'active',
              updated_at = excluded.updated_at,
              revision = push_registrations.revision + 1
          `;
          yield* sql`
            UPDATE push_deliveries
            SET envelope_json = NULL, envelope_expires_at = NULL, envelope_revision = NULL
            WHERE registration_id = ${input.registrationId} AND status IN ('pending', 'leased')
          `;
          return existing;
        }),
      )
      .pipe(
        Effect.catchTags({
          SqlError: (cause) => Effect.fail(storageError(cause)),
          SchemaError: (cause) => Effect.fail(storageError(cause)),
        }),
      );
  });

  const remove: PushRegistrations["Service"]["remove"] = Effect.fn("PushRegistrations.remove")(
    function* (registrationId) {
      return yield* sql.withTransaction(
        Effect.gen(function* () {
          const existing = yield* findById(registrationId);
          yield* sql`DELETE FROM push_deliveries WHERE registration_id = ${registrationId}`;
          yield* sql`DELETE FROM push_registrations WHERE registration_id = ${registrationId}`;
          return existing;
        }),
      );
    },
    Effect.mapError(storageError),
  );

  const list: PushRegistrations["Service"]["list"] = SqlSchema.findAll({
    Request: Schema.Void,
    Result: ListedRegistration,
    execute: () => sql`
      SELECT ${columns}, auth_sessions.client_label AS "sessionLabel"
      FROM push_registrations
      LEFT JOIN auth_sessions USING (session_id)
      ORDER BY push_registrations.created_at, registration_id
    `,
  })(undefined).pipe(Effect.mapError(storageError));

  const listDeliverable: PushRegistrations["Service"]["listDeliverable"] = Effect.flatMap(
    nowIso,
    (now) =>
      SqlSchema.findAll({
        Request: Schema.Void,
        Result: PushRegistrationRecord,
        execute: () => sql`
          SELECT ${columns}
          FROM push_registrations
          JOIN auth_sessions USING (session_id)
          WHERE push_registrations.status = 'active'
            AND auth_sessions.revoked_at IS NULL
            AND auth_sessions.expires_at > ${now}
        `,
      })(undefined),
  ).pipe(Effect.mapError(storageError));

  const isSessionValid: PushRegistrations["Service"]["isSessionValid"] = Effect.fn(
    "PushRegistrations.isSessionValid",
  )(function* (sessionId) {
    const now = yield* nowIso;
    const rows = yield* sql`
      SELECT 1 FROM auth_sessions
      WHERE session_id = ${sessionId} AND revoked_at IS NULL AND expires_at > ${now}
    `;
    return rows.length > 0;
  }, Effect.mapError(storageError));

  const cancelOpenDeliveries = (registrationIds: ReadonlyArray<string>) =>
    registrationIds.length === 0
      ? Effect.void
      : sql`
          UPDATE push_deliveries SET status = 'cancelled', lease_until = NULL
          WHERE status IN ('pending', 'leased', 'superseded')
            AND ${sql.in("registration_id", registrationIds)}
        `.pipe(Effect.asVoid);

  const markGone: PushRegistrations["Service"]["markGone"] = Effect.fn(
    "PushRegistrations.markGone",
  )(function* (registrationId) {
    const now = yield* nowIso;
    yield* sql.withTransaction(
      sql`
        UPDATE push_registrations SET status = 'gone', updated_at = ${now}
        WHERE registration_id = ${registrationId}
      `.pipe(Effect.andThen(cancelOpenDeliveries([registrationId]))),
    );
  }, Effect.mapError(storageError));

  const retireSessions: PushRegistrations["Service"]["retireSessions"] = Effect.fn(
    "PushRegistrations.retireSessions",
  )(function* (sessionId) {
    const now = yield* nowIso;
    return yield* sql.withTransaction(
      Effect.gen(function* () {
        const retired = yield* SqlSchema.findAll({
          Request: Schema.Void,
          Result: PushRegistrationRecord,
          execute: () =>
            sessionId === undefined
              ? sql`
                  UPDATE push_registrations SET status = 'gone', updated_at = ${now}
                  WHERE status = 'active' AND NOT EXISTS (
                    SELECT 1 FROM auth_sessions
                    WHERE auth_sessions.session_id = push_registrations.session_id
                      AND auth_sessions.revoked_at IS NULL
                      AND auth_sessions.expires_at > ${now}
                  )
                  RETURNING ${columns}
                `
              : sql`
                  UPDATE push_registrations SET status = 'gone', updated_at = ${now}
                  WHERE status = 'active' AND session_id = ${sessionId}
                  RETURNING ${columns}
                `,
        })(undefined);
        yield* cancelOpenDeliveries(retired.map((registration) => registration.registrationId));
        return retired;
      }),
    );
  }, Effect.mapError(storageError));

  const recordDelivery: PushRegistrations["Service"]["recordDelivery"] = Effect.fn(
    "PushRegistrations.recordDelivery",
  )(function* (registrationId) {
    const now = yield* nowIso;
    yield* sql`
      UPDATE push_registrations SET last_delivery_at = ${now} WHERE registration_id = ${registrationId}
    `;
  }, Effect.mapError(storageError));

  return PushRegistrations.of({
    get,
    register,
    remove,
    list,
    listDeliverable,
    isSessionValid,
    markGone,
    retireSessions,
    recordDelivery,
  });
});

export const layer = Layer.effect(PushRegistrations, make);
