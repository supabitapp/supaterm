import type { AuthSessionId } from "@supaterm/contracts";
import {
  normalizePushGatewayOrigin,
  PushNotificationError,
  type PushDescribeResult,
  type PushListResult,
  type PushRegisterInput,
  type PushRegisterResult,
  type PushRegistrationInput,
  type PushTestResult,
} from "@supaterm/contracts/push";
import { buildPushTestContent } from "@supaterm/shared/push/plaintext";
import * as Context from "effect/Context";
import * as Crypto from "effect/Crypto";
import * as DateTime from "effect/DateTime";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";
import * as Option from "effect/Option";
import type * as Scope from "effect/Scope";
import * as Stream from "effect/Stream";

import * as SessionStore from "../auth/SessionStore.ts";
import * as ServerEnvironment from "../environment/ServerEnvironment.ts";
import { forkParked } from "../serverActivation.ts";
import * as ServerSettings from "../serverSettings.ts";
import * as PushGatewayClient from "./PushGatewayClient.ts";
import * as PushIdentity from "./PushIdentity.ts";
import * as PushRegistrations from "./PushRegistrations.ts";

const TEST_LIFETIME_MS = 10 * 60_000;

export class PushNotifications extends Context.Service<
  PushNotifications,
  {
    readonly describe: Effect.Effect<PushDescribeResult, PushNotificationError>;
    /** Upserts a registration owned by `sessionId`; another session's id is a conflict. */
    readonly register: (
      sessionId: AuthSessionId,
      input: PushRegisterInput,
    ) => Effect.Effect<PushRegisterResult, PushNotificationError>;
    /** Removes one of the caller's own registrations. Already removed counts as done. */
    readonly unregister: (
      sessionId: AuthSessionId,
      input: PushRegistrationInput,
    ) => Effect.Effect<void, PushNotificationError>;
    readonly list: (
      sessionId: AuthSessionId,
    ) => Effect.Effect<PushListResult, PushNotificationError>;
    /** The owner's removal of any registration. */
    readonly revoke: (input: PushRegistrationInput) => Effect.Effect<void, PushNotificationError>;
    readonly test: (
      input: PushRegistrationInput,
    ) => Effect.Effect<PushTestResult, PushNotificationError>;
    /** Retires registrations of ended sessions now and whenever a session is revoked. */
    readonly start: () => Effect.Effect<void, never, Scope.Scope>;
  }
>()("supaterm/notifications/PushNotifications") {}

const make = Effect.gen(function* () {
  const settings = yield* ServerSettings.ServerSettingsService;
  const sessions = yield* SessionStore.SessionStore;
  const environment = yield* ServerEnvironment.ServerEnvironment;
  const crypto = yield* Crypto.Crypto;
  const identity = yield* PushIdentity.PushIdentity;
  const gateway = yield* PushGatewayClient.PushGatewayClient;
  const registrations = yield* PushRegistrations.PushRegistrations;

  const currentSettings = settings.getSettings.pipe(
    Effect.mapError((cause) => new PushNotificationError({ reason: "storage", cause })),
  );

  const requireEnabled = Effect.gen(function* () {
    const current = yield* currentSettings;
    if (!current.pushNotificationsEnabled) {
      return yield* new PushNotificationError({ reason: "disabled" });
    }
    return current;
  });

  // Best effort: the phone can also drop its handle, and the gateway expires unused ones.
  const dropHandle = (registration: PushRegistrations.PushRegistrationRecord) =>
    gateway
      .deleteHandle({ origin: registration.gatewayOrigin, handle: registration.handle })
      .pipe(
        Effect.catchCause((cause) =>
          Effect.logDebug("could not drop a push gateway handle", { cause }),
        ),
      );

  const describe: PushNotifications["Service"]["describe"] = Effect.gen(function* () {
    const current = yield* currentSettings;
    const hostKey = yield* identity.publicKey.pipe(
      Effect.mapError((cause) => new PushNotificationError({ reason: "unavailable", cause })),
    );
    return {
      enabled: current.pushNotificationsEnabled,
      hostKey,
      gatewayOrigins: current.pushGatewayOrigins.flatMap(
        (origin) => normalizePushGatewayOrigin(origin) ?? [],
      ),
    };
  }).pipe(Effect.withSpan("PushNotifications.describe"));

  const register: PushNotifications["Service"]["register"] = Effect.fn(
    "PushNotifications.register",
  )(function* (sessionId, input) {
    const current = yield* requireEnabled;
    const origin = normalizePushGatewayOrigin(input.gatewayOrigin);
    if (
      origin === null ||
      !current.pushGatewayOrigins.some((entry) => normalizePushGatewayOrigin(entry) === origin)
    ) {
      return yield* new PushNotificationError({ reason: "origin_not_allowed" });
    }
    const existing = Option.getOrUndefined(
      yield* registrations.register({
        registrationId: input.registrationId,
        sessionId,
        gatewayOrigin: origin,
        handle: input.handle,
        keyId: input.recipientKey.keyId,
        recipientPublicKey: input.recipientKey.publicKey,
        preview: input.preview,
        kinds: input.kinds,
        deviceName: input.deviceName ?? null,
      }),
    );
    if (
      existing !== undefined &&
      (existing.handle !== input.handle || existing.gatewayOrigin !== origin)
    ) {
      yield* dropHandle(existing);
    }
    return { registrationId: input.registrationId };
  });

  const unregister: PushNotifications["Service"]["unregister"] = Effect.fn(
    "PushNotifications.unregister",
  )(function* (sessionId, input) {
    const existing = Option.getOrUndefined(yield* registrations.get(input.registrationId));
    if (existing === undefined) return;
    if (existing.sessionId !== sessionId) {
      return yield* new PushNotificationError({ reason: "conflict" });
    }
    yield* registrations.remove(input.registrationId);
    yield* dropHandle(existing);
  });

  const revoke: PushNotifications["Service"]["revoke"] = Effect.fn("PushNotifications.revoke")(
    function* (input) {
      const existing = yield* registrations.remove(input.registrationId);
      if (Option.isNone(existing)) {
        return yield* new PushNotificationError({ reason: "not_found" });
      }
      yield* dropHandle(existing.value);
    },
  );

  const list: PushNotifications["Service"]["list"] = Effect.fn("PushNotifications.list")(
    function* (sessionId) {
      const rows = yield* registrations.list;
      return {
        registrations: rows.map((row) => ({
          registrationId: row.registrationId,
          sessionId: row.sessionId,
          deviceName: row.deviceName,
          gatewayOrigin: row.gatewayOrigin,
          preview: row.preview,
          status: row.status,
          createdAt: row.createdAt,
          ...(row.lastDeliveryAt === null ? {} : { lastDeliveryAt: row.lastDeliveryAt }),
          isCurrentSession: row.sessionId === sessionId,
          ...(row.sessionLabel === null ? {} : { sessionLabel: row.sessionLabel }),
        })),
      };
    },
  );

  const test: PushNotifications["Service"]["test"] = Effect.fn("PushNotifications.test")(
    function* (input) {
      yield* requireEnabled;
      const registration = Option.getOrUndefined(yield* registrations.get(input.registrationId));
      if (registration === undefined) {
        return yield* new PushNotificationError({ reason: "not_found" });
      }
      if (registration.status !== "active") return { status: "gone" } as const;
      const now = DateTime.toEpochMillis(yield* DateTime.now);
      const notificationId = yield* crypto
        .randomUUIDv4()
        .pipe(
          Effect.mapError((cause) => new PushNotificationError({ reason: "unavailable", cause })),
        );
      const failed = () => Effect.succeed({ type: "failed" } as const);
      const outcome = yield* Effect.gen(function* () {
        const envelope = yield* identity.seal({
          recipientPublicKey: registration.recipientPublicKey,
          metadata: {
            registrationId: registration.registrationId,
            keyId: registration.keyId,
            notificationId,
            createdAt: now,
            expiresAt: now + TEST_LIFETIME_MS,
          },
          content: buildPushTestContent(yield* environment.getEnvironmentId),
        });
        return yield* gateway.send({
          origin: registration.gatewayOrigin,
          handle: registration.handle,
          payload: envelope,
          expiration: Math.floor(envelope.expiresAt / 1000),
          priority: 10,
          collapseId: yield* identity.collapseId({
            registrationId: registration.registrationId,
            threadId: "",
          }),
        });
      }).pipe(
        Effect.catchTags({
          PushGatewayOriginError: failed,
          PushGatewayUnavailableError: failed,
          PushIdentityError: failed,
          PushSealError: failed,
        }),
      );
      switch (outcome.type) {
        case "accepted":
          yield* registrations.recordDelivery(registration.registrationId);
          return { status: "accepted" } as const;
        case "gone":
          yield* registrations.markGone(registration.registrationId);
          return { status: "gone" } as const;
        default:
          return { status: "failed" } as const;
      }
    },
  );

  const retireSessions = (sessionId?: AuthSessionId) =>
    registrations.retireSessions(sessionId).pipe(
      Effect.flatMap((retired) => Effect.forEach(retired, dropHandle, { discard: true })),
      Effect.catchCause((cause) =>
        Effect.logWarning("could not retire push registrations of ended sessions", { cause }),
      ),
    );

  const start: PushNotifications["Service"]["start"] = () =>
    forkParked(
      retireSessions().pipe(
        Effect.andThen(
          Stream.runForEach(sessions.streamChanges, (change) =>
            change.type === "clientRemoved" ? retireSessions(change.sessionId) : Effect.void,
          ),
        ),
      ),
    );

  return PushNotifications.of({ describe, register, unregister, list, revoke, test, start });
});

export const layer = Layer.effect(PushNotifications, make);
