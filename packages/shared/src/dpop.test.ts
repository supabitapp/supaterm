// @effect-diagnostics-next-line nodeBuiltinImport:off -- Effect's Crypto has no KeyObject, generateKeyPairSync, or sign.
import * as NodeCrypto from "node:crypto";

import { assert, describe, it } from "@effect/vitest";
import { vi } from "vite-plus/test";

import {
  computeDpopAccessTokenHash,
  computeDpopJwkThumbprint,
  normalizeDpopHtu,
  type DpopPublicJwk,
  verifyDpopProof,
} from "./dpop.ts";

function signDpopProof(input: {
  readonly method: string;
  readonly url: string;
  readonly iat: number;
  readonly privateKey: NodeCrypto.KeyObject;
  readonly publicJwk: DpopPublicJwk | (DpopPublicJwk & { readonly d: string });
  readonly accessToken?: string;
}) {
  const header = Buffer.from(
    JSON.stringify({
      typ: "dpop+jwt",
      alg: "ES256",
      jwk: input.publicJwk,
    }),
  ).toString("base64url");
  const payload = Buffer.from(
    JSON.stringify({
      htm: input.method,
      htu: input.url,
      jti: "proof-1",
      iat: input.iat,
      ...(input.accessToken ? { ath: computeDpopAccessTokenHash(input.accessToken) } : {}),
    }),
  ).toString("base64url");
  const signature = NodeCrypto.sign("sha256", Buffer.from(`${header}.${payload}`), {
    key: input.privateKey,
    dsaEncoding: "ieee-p1363",
  }).toString("base64url");
  return `${header}.${payload}.${signature}`;
}

describe("verifyDpopProof", () => {
  const { privateKey, publicKey } = NodeCrypto.generateKeyPairSync("ec", {
    namedCurve: "P-256",
  });
  const publicJwk = publicKey.export({ format: "jwk" }) as DpopPublicJwk;
  const proof = signDpopProof({
    method: "POST",
    url: "https://example.com/oauth/token",
    iat: 100,
    privateKey,
    publicJwk,
  });

  it.each([undefined, null, "", " "])("reports a missing proof for %s", (missing) => {
    assert.deepEqual(
      verifyDpopProof({
        proof: missing,
        method: "POST",
        url: "https://example.com/oauth/token",
        nowEpochSeconds: 101,
      }),
      { ok: false, code: "missing_proof", reason: "Missing DPoP proof." },
    );
  });

  it.each(["header.payload", "header.payload.signature.extra", ".."])(
    "rejects a malformed compact proof: %s",
    (malformed) => {
      assert.deepEqual(
        verifyDpopProof({
          proof: malformed,
          method: "POST",
          url: "https://example.com/oauth/token",
          nowEpochSeconds: 101,
        }),
        { ok: false, code: "malformed_proof", reason: "Invalid DPoP compact JWT." },
      );
    },
  );

  it("accepts both valid ES256 signature forms produced by independent clients", () => {
    const [header, payload, signature] = proof.split(".");
    assert.isDefined(signature);
    const bytes = Buffer.from(signature, "base64url");
    const order = BigInt("0xffffffff00000000ffffffffffffffffbce6faada7179e84f3b9cac2fc632551");
    const s = BigInt(`0x${bytes.subarray(32).toString("hex")}`);
    for (const scalar of [s > order / 2n ? order - s : s, s > order / 2n ? s : order - s]) {
      Buffer.from(scalar.toString(16).padStart(64, "0"), "hex").copy(bytes, 32);
      assert.deepEqual(
        verifyDpopProof({
          proof: `${header}.${payload}.${bytes.toString("base64url")}`,
          method: "POST",
          url: "https://example.com/oauth/token",
          nowEpochSeconds: 101,
        }),
        { ok: true, thumbprint: computeDpopJwkThumbprint(publicJwk), jti: "proof-1", iat: 100 },
      );
    }
  });

  it.each([
    { typ: "JWT", alg: "ES256", jwk: publicJwk },
    { typ: "dpop+jwt", alg: "HS256", jwk: publicJwk },
    { typ: "dpop+jwt", alg: "ES256", jwk: { ...publicJwk, crv: "P-384" } },
  ])("rejects unsupported JWT headers: %j", (header) => {
    const [, payload, signature] = proof.split(".");
    assert.deepEqual(
      verifyDpopProof({
        proof: `${Buffer.from(JSON.stringify(header)).toString("base64url")}.${payload}.${signature}`,
        method: "POST",
        url: "https://example.com/oauth/token",
        nowEpochSeconds: 101,
      }),
      { ok: false, code: "malformed_proof", reason: "Invalid DPoP JWT header." },
    );
  });

  it.each([
    { jti: "", iat: 100 },
    { jti: "proof-1", iat: 100.5 },
    { jti: "proof-1", iat: "100" },
  ])("rejects invalid proof claims: %j", (claims) => {
    const [header, , signature] = proof.split(".");
    const payload = Buffer.from(
      JSON.stringify({ htm: "POST", htu: "https://example.com/oauth/token", ...claims }),
    ).toString("base64url");
    assert.deepEqual(
      verifyDpopProof({
        proof: `${header}.${payload}.${signature}`,
        method: "POST",
        url: "https://example.com/oauth/token",
        nowEpochSeconds: 101,
      }),
      { ok: false, code: "malformed_proof", reason: "Invalid DPoP JWT payload." },
    );
  });

  it("computes the RFC 7638 thumbprint whatever the host locale", () => {
    const latvian = new Intl.Collator("lv");
    const localeCompare = vi.spyOn(String.prototype, "localeCompare").mockImplementation(function (
      this: string,
      that: string,
    ) {
      return latvian.compare(this, that);
    });
    try {
      const rfc7638Input = JSON.stringify({
        crv: publicJwk.crv,
        kty: publicJwk.kty,
        x: publicJwk.x,
        y: publicJwk.y,
      });
      assert.equal(
        computeDpopJwkThumbprint(publicJwk),
        NodeCrypto.createHash("sha256").update(rfc7638Input).digest("base64url"),
      );
    } finally {
      localeCompare.mockRestore();
    }
  });

  it("hashes the exact access token bytes", () => {
    const accessToken = "token:with-utf8-\u00e9";
    assert.equal(
      computeDpopAccessTokenHash(accessToken),
      NodeCrypto.createHash("sha256").update(accessToken).digest("base64url"),
    );
  });

  it.each([
    ["not a URL", null],
    ["https://EXAMPLE.com:443/path%20name?query=yes#fragment", "https://example.com/path%20name"],
  ])("normalizes the target URI %s", (url, normalized) => {
    assert.equal(normalizeDpopHtu(url), normalized);
  });

  it.each([
    {
      jwk: { ...publicJwk, x: Buffer.alloc(31).toString("base64url") },
      code: "invalid_proof",
      reason: "Invalid DPoP proof.",
    },
    {
      jwk: {
        ...publicJwk,
        x: Buffer.alloc(32).toString("base64url"),
        y: Buffer.alloc(32).toString("base64url"),
      },
      code: "invalid_signature",
      reason: "Invalid DPoP signature.",
    },
  ] as const)(
    "rejects invalid public key coordinates without throwing",
    ({ jwk, code, reason }) => {
      const invalidProof = signDpopProof({
        method: "POST",
        url: "https://example.com/oauth/token",
        iat: 100,
        privateKey,
        publicJwk: jwk,
      });
      assert.deepEqual(
        verifyDpopProof({
          proof: invalidProof,
          method: "POST",
          url: "https://example.com/oauth/token",
          nowEpochSeconds: 101,
        }),
        { ok: false, code, reason },
      );
    },
  );

  it("verifies an ES256 DPoP proof and returns the RFC 7638 thumbprint", () => {
    const thumbprint = computeDpopJwkThumbprint(publicJwk);
    const result = verifyDpopProof({
      proof,
      method: "POST",
      url: "https://example.com/oauth/token",
      nowEpochSeconds: 101,
      expectedThumbprint: thumbprint,
    });

    if (!result.ok) {
      assert.fail(result.reason);
    }
    assert.equal(result.thumbprint, thumbprint);
    assert.equal(result.jti, "proof-1");
  });

  it("rejects malformed DPoP header and payload JSON", () => {
    const [header, payload, signature] = proof.split(".");
    if (!header || !payload || !signature) {
      assert.fail("Expected the test DPoP proof to use compact JWT format.");
    }
    const malformedJson = Buffer.from("{").toString("base64url");

    const malformedHeader = verifyDpopProof({
      proof: `${malformedJson}.${payload}.${signature}`,
      method: "POST",
      url: "https://example.com/oauth/token",
      nowEpochSeconds: 101,
    });
    if (malformedHeader.ok) {
      assert.fail("Expected malformed DPoP header JSON to fail.");
    }
    assert.equal(malformedHeader.reason, "Invalid DPoP JWT header.");

    const malformedPayload = verifyDpopProof({
      proof: `${header}.${malformedJson}.${signature}`,
      method: "POST",
      url: "https://example.com/oauth/token",
      nowEpochSeconds: 101,
    });
    if (malformedPayload.ok) {
      assert.fail("Expected malformed DPoP payload JSON to fail.");
    }
    assert.equal(malformedPayload.reason, "Invalid DPoP JWT payload.");
  });

  it("rejects method, URL, thumbprint, and time-window mismatches", () => {
    const thumbprint = computeDpopJwkThumbprint(publicJwk);
    assert.equal(
      verifyDpopProof({
        proof,
        method: "GET",
        url: "https://example.com/oauth/token",
        nowEpochSeconds: 101,
        expectedThumbprint: thumbprint,
      }).ok,
      false,
    );
    assert.equal(
      verifyDpopProof({
        proof,
        method: "POST",
        url: "https://example.com/other",
        nowEpochSeconds: 101,
        expectedThumbprint: thumbprint,
      }).ok,
      false,
    );
    assert.equal(
      verifyDpopProof({
        proof,
        method: "POST",
        url: "https://example.com/oauth/token",
        nowEpochSeconds: 101,
        expectedThumbprint: "other-thumbprint",
      }).ok,
      false,
    );
    assert.equal(
      verifyDpopProof({
        proof,
        method: "POST",
        url: "https://example.com/oauth/token",
        nowEpochSeconds: 1_000,
        expectedThumbprint: thumbprint,
      }).ok,
      false,
    );
  });

  it("reports a time-window failure only after the proof signature is valid", () => {
    const thumbprint = computeDpopJwkThumbprint(publicJwk);
    const outsideWindow = verifyDpopProof({
      proof,
      method: "POST",
      url: "https://example.com/oauth/token",
      nowEpochSeconds: 1_000,
      expectedThumbprint: thumbprint,
    });
    if (outsideWindow.ok) {
      assert.fail("Expected an old DPoP proof to fail.");
    }
    assert.equal(outsideWindow.code, "time_window");

    const { privateKey: otherPrivateKey } = NodeCrypto.generateKeyPairSync("ec", {
      namedCurve: "P-256",
    });
    const invalidSignatureProof = signDpopProof({
      method: "POST",
      url: "https://example.com/oauth/token",
      iat: 100,
      privateKey: otherPrivateKey,
      publicJwk,
    });
    const invalidSignature = verifyDpopProof({
      proof: invalidSignatureProof,
      method: "POST",
      url: "https://example.com/oauth/token",
      nowEpochSeconds: 1_000,
      expectedThumbprint: thumbprint,
    });
    if (invalidSignature.ok) {
      assert.fail("Expected a proof signed by a different key to fail.");
    }
    assert.equal(invalidSignature.code, "invalid_signature");
  });

  it("accepts clock offsets through 300 seconds in either direction", () => {
    for (const { offset, accepted } of [
      { offset: -300, accepted: true },
      { offset: 300, accepted: true },
      { offset: -301, accepted: false },
      { offset: 301, accepted: false },
    ]) {
      const result = verifyDpopProof({
        proof,
        method: "POST",
        url: "https://example.com/oauth/token",
        nowEpochSeconds: 100 + offset,
      });

      assert.equal(result.ok, accepted, `Clock offset: ${offset}s`);
      if (!result.ok) {
        assert.equal(result.code, "time_window");
      }
    }
  });

  it("requires the RFC 9449 access token hash when an access token is expected", () => {
    const thumbprint = computeDpopJwkThumbprint(publicJwk);
    const accessTokenProof = signDpopProof({
      method: "POST",
      url: "https://example.com/v1/environments/env/connect",
      iat: 100,
      privateKey,
      publicJwk,
      accessToken: "expected-access-token",
    });

    assert.equal(
      verifyDpopProof({
        proof: accessTokenProof,
        method: "POST",
        url: "https://example.com/v1/environments/env/connect",
        nowEpochSeconds: 101,
        expectedThumbprint: thumbprint,
        expectedAccessToken: "expected-access-token",
      }).ok,
      true,
    );

    const missingHash = verifyDpopProof({
      proof,
      method: "POST",
      url: "https://example.com/oauth/token",
      nowEpochSeconds: 101,
      expectedThumbprint: thumbprint,
      expectedAccessToken: "expected-access-token",
    });
    if (missingHash.ok) {
      assert.fail("Expected DPoP proof without an access token hash to fail.");
    }
    assert.equal(missingHash.reason, "DPoP access token hash mismatch.");

    const mismatchedHash = verifyDpopProof({
      proof: accessTokenProof,
      method: "POST",
      url: "https://example.com/v1/environments/env/connect",
      nowEpochSeconds: 101,
      expectedThumbprint: thumbprint,
      expectedAccessToken: "other-access-token",
    });
    if (mismatchedHash.ok) {
      assert.fail("Expected DPoP proof with a mismatched access token hash to fail.");
    }
    assert.equal(mismatchedHash.reason, "DPoP access token hash mismatch.");
  });

  it("normalizes htu by excluding query and fragment components per RFC 9449", () => {
    assert.equal(
      normalizeDpopHtu("https://example.com/v1/environments/env/connect?foo=bar#frag"),
      "https://example.com/v1/environments/env/connect",
    );

    const thumbprint = computeDpopJwkThumbprint(publicJwk);
    const queryProof = signDpopProof({
      method: "POST",
      url: "https://example.com/v1/environments/env/connect",
      iat: 100,
      privateKey,
      publicJwk,
    });

    assert.equal(
      verifyDpopProof({
        proof: queryProof,
        method: "POST",
        url: "https://example.com/v1/environments/env/connect?foo=bar#frag",
        nowEpochSeconds: 101,
        expectedThumbprint: thumbprint,
      }).ok,
      true,
    );
  });

  it("rejects DPoP public JWK headers that expose private key material", () => {
    const thumbprint = computeDpopJwkThumbprint(publicJwk);
    const privateJwk = privateKey.export({ format: "jwk" }) as DpopPublicJwk & {
      readonly d: string;
    };
    const proofWithPrivateJwk = signDpopProof({
      method: "POST",
      url: "https://example.com/oauth/token",
      iat: 100,
      privateKey,
      publicJwk: privateJwk,
    });

    const result = verifyDpopProof({
      proof: proofWithPrivateJwk,
      method: "POST",
      url: "https://example.com/oauth/token",
      nowEpochSeconds: 101,
      expectedThumbprint: thumbprint,
    });

    if (result.ok) {
      assert.fail("Expected DPoP proof with private JWK material to fail.");
    }
    assert.equal(result.reason, "Invalid DPoP JWT header.");
  });
});
