import { assert, describe, it } from "@effect/vitest";
import { AuthSessionId } from "@supaterm/contracts";
import { PushEnvelope, type PushNotificationErrorReason } from "@supaterm/contracts/push";
import { openPushEnvelope } from "@supaterm/shared/push/envelope";
import { buildPushTestContent } from "@supaterm/shared/push/plaintext";
import { decodeBase64 } from "@supaterm/shared/relay/protocol";
import * as Effect from "effect/Effect";
import * as Queue from "effect/Queue";
import * as Ref from "effect/Ref";
import * as Schema from "effect/Schema";
import * as SqlClient from "effect/sql/SqlClient";

import * as PushNotifications from "./PushNotifications.ts";
import {
  ENVIRONMENT_ID,
  insertSession,
  layerPushServices,
  type PushWorld,
  recipientKeyPair,
  registerInput,
  withPushWorld,
} from "./testkit/pushWorld.ts";

const SESSION_A = AuthSessionId.make("session-a");
const SESSION_B = AuthSessionId.make("session-b");
const REGISTRATION_ID = "6f1c2b9e-3a4d-4e5f-8a6b-7c8d9e0f1a2b";
const OTHER_REGISTRATION_ID = "7a2d3c0f-4b5e-4f60-9b7c-8d9e0f1a2b3c";

const decodeSendBody = Schema.decodeUnknownSync(
  Schema.fromJsonString(Schema.Struct({ handle: Schema.String, payload: PushEnvelope })),
);

const failureReason = <A, R>(effect: Effect.Effect<A, { readonly reason: string }, R>) =>
  effect.pipe(
    Effect.flip,
    Effect.map((error) => error.reason as PushNotificationErrorReason),
  );

const withPush = <A, E, R>(
  body: (world: PushWorld) => Effect.Effect<A, E, R>,
  settings?: Parameters<typeof withPushWorld>[1],
) => withPushWorld((world) => body(world).pipe(Effect.provide(layerPushServices)), settings);

describe("PushNotifications", () => {
  it.effect("binds a registration to the session that created it", () =>
    withPush((world) =>
      Effect.gen(function* () {
        const push = yield* PushNotifications.PushNotifications;
        yield* insertSession(SESSION_A, { label: "iPhone" });
        yield* insertSession(SESSION_B);
        const { publicKey } = yield* recipientKeyPair;

        yield* push.register(SESSION_A, registerInput(REGISTRATION_ID, publicKey));
        assert.strictEqual(
          yield* failureReason(push.register(SESSION_B, registerInput(REGISTRATION_ID, publicKey))),
          "conflict",
        );
        assert.strictEqual(
          yield* failureReason(push.unregister(SESSION_B, { registrationId: REGISTRATION_ID })),
          "conflict",
        );

        const fromA = yield* push.list(SESSION_A);
        const fromB = yield* push.list(SESSION_B);
        assert.deepStrictEqual(
          fromA.registrations.map((registration) => ({
            id: registration.registrationId,
            current: registration.isCurrentSession,
            label: registration.sessionLabel,
            status: registration.status,
          })),
          [{ id: REGISTRATION_ID, current: true, label: "iPhone", status: "active" }],
        );
        assert.isFalse(fromB.registrations[0]?.isCurrentSession);

        yield* push.unregister(SESSION_A, { registrationId: REGISTRATION_ID });
        const dropped = yield* Queue.take(world.gatewayCalls);
        assert.strictEqual(dropped.method, "DELETE");
        assert.strictEqual(dropped.url.pathname, "/v1/handles/aGFuZGxlLWhhbmRsZS0xMg");
        assert.deepStrictEqual((yield* push.list(SESSION_A)).registrations, []);
        yield* push.unregister(SESSION_A, { registrationId: REGISTRATION_ID });
      }),
    ),
  );

  it.effect("only accepts gateways on the host's allowlist", () =>
    withPush(() =>
      Effect.gen(function* () {
        const push = yield* PushNotifications.PushNotifications;
        const { publicKey } = yield* recipientKeyPair;
        assert.strictEqual(
          yield* failureReason(
            push.register(
              SESSION_A,
              registerInput(REGISTRATION_ID, publicKey, {
                gatewayOrigin: "https://push.example.com",
              }),
            ),
          ),
          "origin_not_allowed",
        );
        const description = yield* push.describe;
        assert.deepStrictEqual(description.gatewayOrigins, ["http://127.0.0.1:8787"]);
        assert.isTrue(description.enabled);
      }),
    ),
  );

  it.effect("refuses registrations and tests while push is turned off", () =>
    withPush(
      () =>
        Effect.gen(function* () {
          const push = yield* PushNotifications.PushNotifications;
          const { publicKey } = yield* recipientKeyPair;
          assert.strictEqual(
            yield* failureReason(
              push.register(SESSION_A, registerInput(REGISTRATION_ID, publicKey)),
            ),
            "disabled",
          );
          assert.strictEqual(
            yield* failureReason(push.test({ registrationId: REGISTRATION_ID })),
            "disabled",
          );
          assert.isFalse((yield* push.describe).enabled);
        }),
      { pushNotificationsEnabled: false },
    ),
  );

  it.effect("sends a sealed test notification and retires a registration the gateway lost", () =>
    withPush((world) =>
      Effect.gen(function* () {
        const push = yield* PushNotifications.PushNotifications;
        yield* insertSession(SESSION_A);
        const recipient = yield* recipientKeyPair;
        yield* push.register(SESSION_A, registerInput(REGISTRATION_ID, recipient.publicKey));

        assert.deepStrictEqual(yield* push.test({ registrationId: REGISTRATION_ID }), {
          status: "accepted",
        });
        const call = yield* Queue.take(world.gatewayCalls);
        assert.strictEqual(call.url.pathname, "/v1/send");
        const { payload } = decodeSendBody(call.body);
        const content = yield* Effect.promise(() =>
          openPushEnvelope({
            envelope: payload,
            recipientPrivateKey: recipient.privateKey,
            hostPublicKey: decodeBase64(call.headers["supaterm-push-key"] ?? ""),
          }),
        );
        assert.deepStrictEqual(content, buildPushTestContent(ENVIRONMENT_ID));
        assert.strictEqual(call.headers["supaterm-push-key"], (yield* push.describe).hostKey);

        yield* Ref.set(world.gatewayReply, () => ({ status: 410 }));
        assert.deepStrictEqual(yield* push.test({ registrationId: REGISTRATION_ID }), {
          status: "gone",
        });
        assert.strictEqual((yield* push.list(SESSION_A)).registrations[0]?.status, "gone");
        assert.deepStrictEqual(yield* push.test({ registrationId: REGISTRATION_ID }), {
          status: "gone",
        });
        assert.strictEqual(
          yield* failureReason(push.revoke({ registrationId: OTHER_REGISTRATION_ID })),
          "not_found",
        );
      }),
    ),
  );

  it.effect("retires registrations whose session ended or was revoked", () =>
    withPush((world) =>
      Effect.gen(function* () {
        const push = yield* PushNotifications.PushNotifications;
        yield* insertSession(SESSION_A);
        yield* insertSession(SESSION_B);
        const { publicKey } = yield* recipientKeyPair;
        yield* push.register(
          SESSION_A,
          registerInput(REGISTRATION_ID, publicKey, { handle: "aGFuZGxlLWZvci1zZXNzaW9uQQ" }),
        );
        yield* push.register(
          SESSION_B,
          registerInput(OTHER_REGISTRATION_ID, publicKey, { handle: "aGFuZGxlLWZvci1zZXNzaW9uQg" }),
        );
        const sql = yield* SqlClient.SqlClient;
        yield* sql`UPDATE auth_sessions SET revoked_at = '1970-01-01T00:00:00.000Z' WHERE session_id = ${SESSION_A}`;

        yield* push.start();
        assert.strictEqual(
          (yield* Queue.take(world.gatewayCalls)).url.pathname,
          "/v1/handles/aGFuZGxlLWZvci1zZXNzaW9uQQ",
        );
        yield* Queue.offer(world.sessionChanges, { type: "clientRemoved", sessionId: SESSION_B });
        assert.strictEqual(
          (yield* Queue.take(world.gatewayCalls)).url.pathname,
          "/v1/handles/aGFuZGxlLWZvci1zZXNzaW9uQg",
        );
        const statuses = (yield* push.list(SESSION_A)).registrations.map(
          (registration) => registration.status,
        );
        assert.deepStrictEqual(statuses, ["gone", "gone"]);
      }),
    ),
  );
});
