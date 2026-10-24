// @effect-diagnostics-next-line nodeBuiltinImport:off -- A plain test writes the shared fixture that Swift and Go also read.
import * as NodeFS from "node:fs";

import { ed25519, x25519 } from "@noble/curves/ed25519.js";
import { PushContent, PushEnvelope, PushPreviewLevel } from "@supaterm/contracts/push";
import * as Schema from "effect/Schema";
import { describe, expect, it } from "vite-plus/test";

import { decodeBase64, encodeBase64 } from "../relay/protocol.ts";
import {
  openPushEnvelope,
  PUSH_HPKE_INFO,
  pushEnvelopeAad,
  pushEnvelopeSignatureData,
  pushHpkeSuite,
  sealPushEnvelope,
} from "./envelope.ts";
import { buildPushContent, buildPushTestContent, type PushContentSource } from "./plaintext.ts";
import { pushRequestSigningString, signPushRequest } from "./request.ts";
import storedVectors from "./vectors.json" with { type: "json" };

const VECTORS_URL = new URL("vectors.json", import.meta.url);
const encoder = new TextEncoder();
const decoder = new TextDecoder();
const hex = (value: string) => new Uint8Array(Buffer.from(value, "hex"));
const bytes = (start: number) => Uint8Array.from({ length: 32 }, (_, i) => (start + i) % 256);

const hostSecretKey = bytes(1);
const recipientPrivateKey = bytes(101);
const registrationId = "6f1c2b9e-3a4d-4e5f-8a6b-7c8d9e0f1a2b";
const keyId = "0b9f8e7d-6c5b-4a39-8281-7f6e5d4c3b2a";
const createdAt = 1_791_840_000_000;
const environmentId = "environment-7f3a";
const threadId = "thread-41c2";

const cases: ReadonlyArray<{
  name: string;
  notificationId: string;
  preview: PushPreviewLevel;
  lifetimeMs: number;
  source: PushContentSource | null;
}> = [
  {
    name: "hidden-approval",
    notificationId: "11111111-1111-4111-8111-111111111111",
    preview: "hidden",
    lifetimeMs: 86_400_000,
    source: {
      environmentId,
      threadId,
      kind: "approval",
      threadTitle: "Deploy the reviewed change",
      projectTitle: "supaterm",
      detail: "rm -rf build && vp run deploy",
    },
  },
  {
    name: "titles-input",
    notificationId: "22222222-2222-4222-9222-222222222222",
    preview: "titles",
    lifetimeMs: 86_400_000,
    source: {
      environmentId,
      threadId,
      kind: "input",
      threadTitle: "Private thread 🔐 — résumé",
      projectTitle: "supaterm",
      detail: "Which database should the migration target?",
    },
  },
  {
    name: "full-completion",
    notificationId: "33333333-3333-4333-a333-333333333333",
    preview: "full",
    lifetimeMs: 600_000,
    source: {
      environmentId,
      threadId,
      kind: "completion",
      threadTitle: 'Refactor the "push" pipeline',
      projectTitle: "supaterm",
      detail: `Done.\nThe reactor now reads "events" from the cursor\u202E and \\ escapes. ${"✓ ".repeat(200)}`,
    },
  },
  {
    name: "titles-failure",
    notificationId: "66666666-6666-4666-8666-666666666666",
    preview: "titles",
    lifetimeMs: 600_000,
    source: {
      environmentId,
      threadId,
      kind: "failure",
      threadTitle: `Investigate the flaky checkout tests ${"and retries ".repeat(12)}`,
      projectTitle: `A project with a fairly long display name ${"x".repeat(60)}`,
      detail: "Provider exited with status 1",
    },
  },
  {
    name: "full-usage-limit",
    notificationId: "44444444-4444-4444-b444-444444444444",
    preview: "full",
    lifetimeMs: 600_000,
    source: {
      environmentId,
      threadId,
      kind: "usage-limit",
      threadTitle: "Nightly triage",
      detail: "You've hit your usage limit. Try again at 4:00 PM.",
    },
  },
  {
    name: "test-notification",
    notificationId: "55555555-5555-4555-8555-555555555555",
    preview: "full",
    lifetimeMs: 600_000,
    source: null,
  },
];

const RFC9180 = {
  source:
    "https://www.rfc-editor.org/rfc/rfc9180#appendix-A.2.1 (DHKEM(X25519, HKDF-SHA256), HKDF-SHA256, ChaCha20Poly1305, base mode)",
  info: "4f6465206f6e2061204772656369616e2055726e",
  ikmE: "909a9b35d3dc4713a5e72a4da274b55d3d3821a37e5d099e74a647db583a904b",
  skRm: "8057991eef8f1f1af18f4a9491d16a1ce333f695d4db8e38da75975c4478e0fb",
  pkRm: "4310ee97d88cc1f088a5576c77ab0cf5c3ac797f3d95139c6c84b5429c59662a",
  enc: "1afa08d3dec047a643885163f1180476fa7ddb54c6a8029ea33f95796bf2ac4a",
  encryptions: [
    {
      aad: "436f756e742d30",
      pt: "4265617574792069732074727574682c20747275746820626561757479",
      ct: "1c5250d8034ec2b784ba2cfd69dbdb8af406cfe3ff938e131f0def8c8b60b4db21993c62ce81883d2dd1b51a28",
    },
    {
      aad: "436f756e742d31",
      pt: "4265617574792069732074727574682c20747275746820626561757479",
      ct: "6b53c051e4199c518de79594e1c4ab18b96f081549d45ce015be002090bb119e85285337cc95ba5f59992dc98c",
    },
  ],
};

async function buildVectors() {
  const recipientPublicKey = encodeBase64(x25519.getPublicKey(recipientPrivateKey));
  const envelopes = [];
  for (const [index, entry] of cases.entries()) {
    const content =
      entry.source === null
        ? buildPushTestContent(environmentId)
        : buildPushContent(entry.source, entry.preview);
    const ephemeralKeyMaterial = bytes(201 + index);
    const metadata = {
      registrationId,
      keyId,
      notificationId: entry.notificationId,
      createdAt,
      expiresAt: createdAt + entry.lifetimeMs,
    };
    const envelope = await sealPushEnvelope({
      hostSecretKey,
      recipientPublicKey,
      metadata,
      content,
      ephemeralKeyMaterial,
    });
    const recipient = await pushHpkeSuite.createRecipientContext({
      recipientKey: await pushHpkeSuite.kem.deserializePrivateKey(recipientPrivateKey),
      enc: decodeBase64(envelope.enc),
      info: encoder.encode(PUSH_HPKE_INFO),
    });
    const plaintext = decoder.decode(
      await recipient.open(
        decodeBase64(envelope.ciphertext),
        encoder.encode(pushEnvelopeAad(envelope)),
      ),
    );
    envelopes.push({
      name: entry.name,
      preview: entry.preview,
      source: entry.source,
      ephemeralKeyMaterial: encodeBase64(ephemeralKeyMaterial),
      content,
      aad: pushEnvelopeAad(envelope),
      signatureData: pushEnvelopeSignatureData(envelope),
      plaintext,
      envelope,
    });
  }
  const handle = encodeBase64(Uint8Array.from({ length: 16 }, (_, i) => i + 1));
  const first = envelopes[0]!.envelope;
  const requests = [
    {
      method: "POST",
      path: "/v1/send",
      timestamp: createdAt + 1_000,
      body: JSON.stringify({
        handle,
        payload: first,
        expiration: Math.floor(first.expiresAt / 1000),
        priority: 10,
        collapseId: "Zm9vYmFyYmF6cXV4cXV1eGNvcmdl",
      }),
    },
    { method: "DELETE", path: `/v1/handles/${handle}`, timestamp: createdAt + 2_000, body: "" },
  ].map((request) => ({
    ...request,
    signingString: pushRequestSigningString(request),
    headers: signPushRequest(hostSecretKey, request),
  }));
  return {
    version: 1,
    hpkeInfo: PUSH_HPKE_INFO,
    host: {
      secretKey: encodeBase64(hostSecretKey),
      publicKey: encodeBase64(ed25519.getPublicKey(hostSecretKey)),
    },
    recipient: {
      registrationId,
      keyId,
      privateKey: encodeBase64(recipientPrivateKey),
      publicKey: recipientPublicKey,
    },
    envelopes,
    requests,
    rfc9180: RFC9180,
  };
}

const Vectors = Schema.Struct({
  host: Schema.Struct({ secretKey: Schema.String, publicKey: Schema.String }),
  recipient: Schema.Struct({ privateKey: Schema.String, publicKey: Schema.String }),
  envelopes: Schema.Array(
    Schema.Struct({
      name: Schema.String,
      content: PushContent,
      aad: Schema.String,
      signatureData: Schema.String,
      plaintext: Schema.String,
      envelope: PushEnvelope,
    }),
  ),
});
const vectors = Schema.decodeUnknownSync(Vectors)(storedVectors);

describe("push vectors", () => {
  it("match what the implementation produces (UPDATE_PUSH_VECTORS=1 rewrites them)", async () => {
    const built = await buildVectors();
    if (process.env.UPDATE_PUSH_VECTORS === "1") {
      NodeFS.writeFileSync(VECTORS_URL, `${JSON.stringify(built, null, 2)}\n`);
    }
    expect(JSON.parse(NodeFS.readFileSync(VECTORS_URL, "utf8"))).toEqual(
      JSON.parse(JSON.stringify(built)),
    );
  });

  it.each(vectors.envelopes.map((entry) => [entry.name, entry] as const))(
    "opens %s with the recorded AAD, signature data and padded plaintext",
    async (_name, entry) => {
      const { envelope } = entry;
      expect(pushEnvelopeAad(envelope)).toBe(
        [
          "supaterm-push-v1",
          "1",
          envelope.registrationId,
          envelope.keyId,
          envelope.notificationId,
          String(envelope.createdAt),
          String(envelope.expiresAt),
        ].join("\n"),
      );
      expect(pushEnvelopeAad(envelope)).toBe(entry.aad);
      expect(pushEnvelopeSignatureData(envelope)).toBe(
        `supaterm-push-signature-v1\n${entry.aad}\n${envelope.enc}\n${envelope.ciphertext}`,
      );
      expect(pushEnvelopeSignatureData(envelope)).toBe(entry.signatureData);
      expect([256, 512, 1024]).toContain(encoder.encode(entry.plaintext).byteLength);
      expect(
        ed25519.verify(
          decodeBase64(envelope.signature),
          encoder.encode(entry.signatureData),
          decodeBase64(vectors.host.publicKey),
        ),
      ).toBe(true);
      await expect(
        openPushEnvelope({
          envelope,
          recipientPrivateKey: decodeBase64(vectors.recipient.privateKey),
          hostPublicKey: decodeBase64(vectors.host.publicKey),
        }),
      ).resolves.toEqual(entry.content);
    },
  );

  it("rejects a changed field, another host, or another recipient", async () => {
    const { envelope } = vectors.envelopes[1]!;
    const open = (
      changed: PushEnvelope,
      recipientPrivateKey = decodeBase64(vectors.recipient.privateKey),
      hostPublicKey = decodeBase64(vectors.host.publicKey),
    ) => openPushEnvelope({ envelope: changed, recipientPrivateKey, hostPublicKey });
    await expect(open({ ...envelope, expiresAt: envelope.expiresAt + 1 })).rejects.toThrow(
      "signature",
    );
    await expect(open(envelope, undefined, ed25519.getPublicKey(bytes(2)))).rejects.toThrow(
      "signature",
    );
    await expect(open(envelope, bytes(102))).rejects.toThrow();

    const resigned = {
      ...envelope,
      registrationId: "6f1c2b9e-3a4d-4e5f-8a6b-7c8d9e0f1a2c",
    };
    await expect(
      open({
        ...resigned,
        signature: encodeBase64(
          ed25519.sign(encoder.encode(pushEnvelopeSignatureData(resigned)), hostSecretKey),
        ),
      }),
    ).rejects.toThrow();
  });

  it("reproduces the request signatures the gateway verifies", () => {
    for (const request of storedVectors.requests) {
      expect(pushRequestSigningString(request)).toBe(request.signingString);
      expect(signPushRequest(hostSecretKey, request)).toEqual(request.headers);
      expect(
        ed25519.verify(
          decodeBase64(request.headers["supaterm-push-signature"]),
          encoder.encode(request.signingString),
          decodeBase64(request.headers["supaterm-push-key"]),
        ),
      ).toBe(true);
    }
  });
});

describe("RFC 9180 A.2.1", () => {
  it("opens the published messages in sequence", async () => {
    const recipient = await pushHpkeSuite.createRecipientContext({
      recipientKey: await pushHpkeSuite.kem.deserializePrivateKey(hex(RFC9180.skRm)),
      enc: hex(RFC9180.enc),
      info: hex(RFC9180.info),
    });
    for (const entry of RFC9180.encryptions) {
      expect(new Uint8Array(await recipient.open(hex(entry.ct), hex(entry.aad)))).toEqual(
        hex(entry.pt),
      );
    }
  });

  it("seals the published messages from the published ephemeral key material", async () => {
    const sender = await pushHpkeSuite.createSenderContext({
      recipientPublicKey: await pushHpkeSuite.kem.deserializePublicKey(hex(RFC9180.pkRm)),
      info: hex(RFC9180.info),
      ekm: hex(RFC9180.ikmE),
    });
    expect(new Uint8Array(sender.enc)).toEqual(hex(RFC9180.enc));
    for (const entry of RFC9180.encryptions) {
      expect(new Uint8Array(await sender.seal(hex(entry.pt), hex(entry.aad)))).toEqual(
        hex(entry.ct),
      );
    }
  });
});
