// @effect-diagnostics-next-line nodeBuiltinImport:off - Effect Crypto does not expose ES256 signing keys.
import * as NodeCrypto from "node:crypto";
import * as NodeServices from "@effect/platform-node/NodeServices";
import { expect, it } from "@effect/vitest";
import {
  computeDpopAccessTokenHash,
  computeDpopJwkThumbprint,
  type DpopPublicJwk,
} from "@supaterm/shared/dpop";
import * as DateTime from "effect/DateTime";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";
import * as HttpServerRequest from "effect/http/HttpServerRequest";
import * as PlatformError from "effect/PlatformError";
import * as ServerConfig from "../config.ts";
import * as ServerSecretStore from "./ServerSecretStore.ts";
import { mapDpopReplayStoreError, verifyRequestDpopProof } from "./dpop.ts";

const keys = NodeCrypto.generateKeyPairSync("ec", { namedCurve: "P-256" });
const jwk = keys.publicKey.export({ format: "jwk" }) as DpopPublicJwk;
const url = "https://environment.example/api/auth/websocket-ticket/rpc";
const proof = (iat: number, jti: string) => {
  const header = Buffer.from(JSON.stringify({ typ: "dpop+jwt", alg: "ES256", jwk })).toString(
    "base64url",
  );
  const payload = Buffer.from(
    JSON.stringify({ htm: "POST", htu: url, iat, jti, ath: computeDpopAccessTokenHash("ticket") }),
  ).toString("base64url");
  const signature = NodeCrypto.sign("sha256", Buffer.from(`${header}.${payload}`), {
    key: keys.privateKey,
    dsaEncoding: "ieee-p1363",
  }).toString("base64url");
  return `${header}.${payload}.${signature}`;
};

const layer = ServerSecretStore.layer.pipe(
  Layer.provideMerge(ServerConfig.layerTest(process.cwd(), { prefix: "supaterm-dpop-" })),
  Layer.provideMerge(NodeServices.layer),
);

it.effect("accepts each proof once while allowing a fresh proof from the same key", () =>
  Effect.gen(function* () {
    const iat = Math.floor(DateTime.toEpochMillis(yield* DateTime.now) / 1000);
    const verify = (token: string) =>
      verifyRequestDpopProof({
        request: HttpServerRequest.fromWeb(
          new Request(url, {
            method: "POST",
            headers: { dpop: token, host: "environment.example", "x-forwarded-proto": "https" },
          }),
        ),
        expectedThumbprint: computeDpopJwkThumbprint(jwk),
        expectedAccessToken: "ticket",
      });
    const token = proof(iat, "first");
    expect(yield* verify(token)).toBe(computeDpopJwkThumbprint(jwk));
    expect(yield* Effect.flip(verify(token))).toMatchObject({
      _tag: "ServerAuthInvalidCredentialError",
      dpopFailureReason: "replay",
    });
    expect(yield* verify(proof(iat, "second"))).toBe(computeDpopJwkThumbprint(jwk));
  }).pipe(Effect.provide(layer)),
);

it.effect("rejects a proof for a different ticket before consuming its replay marker", () =>
  Effect.gen(function* () {
    const iat = Math.floor(DateTime.toEpochMillis(yield* DateTime.now) / 1000);
    const request = HttpServerRequest.fromWeb(
      new Request(url, {
        method: "POST",
        headers: {
          dpop: proof(iat, "wrong-ticket"),
          host: "environment.example",
          "x-forwarded-proto": "https",
        },
      }),
    );
    expect(
      yield* Effect.flip(verifyRequestDpopProof({ request, expectedAccessToken: "other-ticket" })),
    ).toMatchObject({ dpopFailureReason: "token_mismatch" });
    expect(yield* verifyRequestDpopProof({ request, expectedAccessToken: "ticket" })).toBe(
      computeDpopJwkThumbprint(jwk),
    );
  }).pipe(Effect.provide(layer)),
);

it("keeps replay conflicts distinct from replay-store failures", () => {
  const error = (tag: "AlreadyExists" | "PermissionDenied") =>
    new ServerSecretStore.SecretStorePersistError({
      resource: "DPoP proof",
      cause: PlatformError.systemError({
        _tag: tag,
        module: "FileSystem",
        method: "open",
        pathOrDescriptor: "proof.bin",
      }),
    });
  expect(mapDpopReplayStoreError(error("AlreadyExists"))).toMatchObject({
    _tag: "ServerAuthInvalidCredentialError",
    dpopFailureReason: "replay",
  });
  expect(mapDpopReplayStoreError(error("PermissionDenied"))).toMatchObject({
    _tag: "ServerAuthDpopReplayStateRecordError",
  });
});
