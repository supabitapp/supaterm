// @effect-diagnostics-next-line nodeBuiltinImport:off -- Effect's Crypto cannot verify Ed25519 signatures.
import * as NodeCrypto from "node:crypto";

import { assert, describe, it } from "@effect/vitest";
import { buildPushTestContent } from "@supaterm/shared/push/plaintext";
import { pushRequestSigningString } from "@supaterm/shared/push/request";
import { decodeBase64 } from "@supaterm/shared/relay/protocol";
import * as Effect from "effect/Effect";
import * as Queue from "effect/Queue";
import * as Ref from "effect/Ref";
import { TestClock } from "effect/testing";

import * as PushGatewayClient from "./PushGatewayClient.ts";
import * as PushIdentity from "./PushIdentity.ts";
import {
  ENVIRONMENT_ID,
  GATEWAY_ORIGIN,
  type GatewayCall,
  layerPushServices,
  recipientKeyPair,
  withPushWorld,
} from "./testkit/pushWorld.ts";

const HANDLE = "aGFuZGxlLWhhbmRsZS0xMg";
const ED25519_SPKI_PREFIX = Uint8Array.from([
  0x30, 0x2a, 0x30, 0x05, 0x06, 0x03, 0x2b, 0x65, 0x70, 0x03, 0x21, 0x00,
]);

function verifiesHostSignature(call: GatewayCall): boolean {
  const key = NodeCrypto.createPublicKey({
    key: Buffer.concat([
      ED25519_SPKI_PREFIX,
      decodeBase64(call.headers["supaterm-push-key"] ?? ""),
    ]),
    format: "der",
    type: "spki",
  });
  const signed = pushRequestSigningString({
    method: call.method,
    path: call.url.pathname,
    body: call.body,
    timestamp: Number(call.headers["supaterm-push-timestamp"]),
  });
  return NodeCrypto.verify(
    null,
    Buffer.from(signed),
    key,
    decodeBase64(call.headers["supaterm-push-signature"] ?? ""),
  );
}

const sendTo = (origin: string) =>
  Effect.gen(function* () {
    const identity = yield* PushIdentity.PushIdentity;
    const gateway = yield* PushGatewayClient.PushGatewayClient;
    const { publicKey } = yield* recipientKeyPair;
    const payload = yield* identity.seal({
      recipientPublicKey: publicKey,
      metadata: {
        registrationId: "6f1c2b9e-3a4d-4e5f-8a6b-7c8d9e0f1a2b",
        keyId: "0b9f8e7d-6c5b-4a39-8281-7f6e5d4c3b2a",
        notificationId: "1c2d3e4f-5a6b-4c7d-8e9f-0a1b2c3d4e5f",
        createdAt: 1_000,
        expiresAt: 601_000,
      },
      content: buildPushTestContent(ENVIRONMENT_ID),
    });
    return yield* gateway.send({
      origin,
      handle: HANDLE,
      payload,
      expiration: 601,
      priority: 10,
      collapseId: "collapse",
    });
  });

describe("PushGatewayClient", () => {
  it.effect("signs sends and handle deletions with the host push identity", () =>
    withPushWorld((world) =>
      Effect.gen(function* () {
        yield* TestClock.setTime(1_791_840_000_000);
        const gateway = yield* PushGatewayClient.PushGatewayClient;
        const identity = yield* PushIdentity.PushIdentity;

        assert.deepStrictEqual(yield* sendTo(GATEWAY_ORIGIN), { type: "accepted" });
        const send = yield* Queue.take(world.gatewayCalls);
        assert.strictEqual(send.method, "POST");
        assert.strictEqual(send.url.href, `${GATEWAY_ORIGIN}/v1/send`);
        assert.strictEqual(send.headers["content-type"], "application/json");
        assert.strictEqual(send.headers["supaterm-push-key"], yield* identity.publicKey);
        assert.strictEqual(send.headers["supaterm-push-timestamp"], "1791840000000");
        assert.isUndefined(send.headers["traceparent"]);
        assert.isTrue(verifiesHostSignature(send));
        assert.deepInclude(JSON.parse(send.body), {
          handle: HANDLE,
          expiration: 601,
          priority: 10,
          collapseId: "collapse",
        });

        yield* gateway.deleteHandle({ origin: GATEWAY_ORIGIN, handle: HANDLE });
        const deletion = yield* Queue.take(world.gatewayCalls);
        assert.strictEqual(deletion.method, "DELETE");
        assert.strictEqual(deletion.url.pathname, `/v1/handles/${HANDLE}`);
        assert.strictEqual(deletion.body, "");
        assert.isTrue(verifiesHostSignature(deletion));
      }).pipe(Effect.provide(layerPushServices)),
    ),
  );

  it.effect("maps gateway answers to delivery outcomes", () =>
    withPushWorld((world) =>
      Effect.gen(function* () {
        const outcomes = [];
        for (const reply of [
          { status: 410 },
          { status: 429, headers: { "retry-after": "30" } },
          { status: 503 },
          { status: 302, headers: { location: "http://169.254.169.254/" } },
          { status: 400 },
        ]) {
          yield* Ref.set(world.gatewayReply, () => reply);
          outcomes.push(yield* sendTo(GATEWAY_ORIGIN));
        }
        assert.deepStrictEqual(outcomes, [
          { type: "gone" },
          { type: "retry", retryAfterMs: 30_000 },
          { type: "retry", retryAfterMs: null },
          { type: "rejected", status: 302 },
          { type: "rejected", status: 400 },
        ]);
      }).pipe(Effect.provide(layerPushServices)),
    ),
  );

  it.effect("never contacts gateways that are not allowed, insecure, or private", () =>
    withPushWorld(
      (world) =>
        Effect.gen(function* () {
          const reasons = [];
          for (const origin of [
            "https://push.example.com",
            "http://push.internal.test",
            "https://10.0.0.8",
            "https://169.254.169.254",
            "https://[::1]",
          ]) {
            const error = yield* Effect.flip(sendTo(origin));
            reasons.push(error._tag === "PushGatewayOriginError" ? error.reason : error._tag);
          }
          assert.deepStrictEqual(reasons, [
            "not_allowed",
            "insecure",
            "private_address",
            "private_address",
            "private_address",
          ]);
          assert.strictEqual(yield* Queue.size(world.gatewayCalls), 0);
        }).pipe(Effect.provide(layerPushServices)),
      {
        pushGatewayOrigins: [
          GATEWAY_ORIGIN,
          "https://10.0.0.8",
          "https://169.254.169.254",
          "https://[::1]",
        ],
      },
    ),
  );
});
