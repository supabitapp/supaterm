import { CipherSuite, DhkemX25519HkdfSha256, HkdfSha256 } from "@hpke/core";
import { Chacha20Poly1305 } from "@hpke/chacha20poly1305";
import { ed25519 } from "@noble/curves/ed25519.js";
import type { PushContent, PushEnvelope } from "@supaterm/contracts/push";

import { decodeBase64, encodeBase64 } from "../relay/protocol.ts";
import { padPushPlaintext, unpadPushPlaintext } from "./plaintext.ts";

export const PUSH_ENVELOPE_VERSION = 1;
export const PUSH_HPKE_INFO = "supaterm-push-hpke-v1";
export const PUSH_AAD_CONTEXT = "supaterm-push-v1";
export const PUSH_SIGNATURE_CONTEXT = "supaterm-push-signature-v1";
/** How far ahead of the phone's clock `createdAt` may be. */
export const PUSH_MAX_CLOCK_SKEW_MS = 300_000;
export const PUSH_MAX_LIFETIME_MS = 86_400_000;

export type PushEnvelopeMetadata = Pick<
  PushEnvelope,
  "registrationId" | "keyId" | "notificationId" | "createdAt" | "expiresAt"
>;

const encoder = new TextEncoder();

export const pushHpkeSuite = new CipherSuite({
  kem: new DhkemX25519HkdfSha256(),
  kdf: new HkdfSha256(),
  aead: new Chacha20Poly1305(),
});

export function pushEnvelopeAad(metadata: PushEnvelopeMetadata): string {
  return [
    PUSH_AAD_CONTEXT,
    PUSH_ENVELOPE_VERSION,
    metadata.registrationId,
    metadata.keyId,
    metadata.notificationId,
    metadata.createdAt,
    metadata.expiresAt,
  ].join("\n");
}

export function pushEnvelopeSignatureData(
  envelope: PushEnvelopeMetadata & Pick<PushEnvelope, "enc" | "ciphertext">,
): string {
  return `${PUSH_SIGNATURE_CONTEXT}\n${pushEnvelopeAad(envelope)}\n${envelope.enc}\n${envelope.ciphertext}`;
}

export interface SealPushEnvelopeInput {
  /** The host push identity's 32-byte Ed25519 secret key. */
  readonly hostSecretKey: Uint8Array;
  /** The registration's X25519 public key, base64url. */
  readonly recipientPublicKey: string;
  readonly metadata: PushEnvelopeMetadata;
  readonly content: PushContent;
  /**
   * HPKE `ikmE`, only for generating fixed test vectors. Reusing it across messages
   * reuses the ephemeral key, so production sealing must leave it unset.
   */
  readonly ephemeralKeyMaterial?: Uint8Array;
}

export async function sealPushEnvelope(input: SealPushEnvelopeInput): Promise<PushEnvelope> {
  const recipientPublicKey = await pushHpkeSuite.kem.deserializePublicKey(
    decodeBase64(input.recipientPublicKey),
  );
  const sender = await pushHpkeSuite.createSenderContext({
    recipientPublicKey,
    info: encoder.encode(PUSH_HPKE_INFO),
    ...(input.ephemeralKeyMaterial === undefined ? {} : { ekm: input.ephemeralKeyMaterial }),
  });
  const ciphertext = await sender.seal(
    padPushPlaintext(input.content),
    encoder.encode(pushEnvelopeAad(input.metadata)),
  );
  const unsigned = {
    v: PUSH_ENVELOPE_VERSION,
    ...input.metadata,
    enc: encodeBase64(new Uint8Array(sender.enc)),
    ciphertext: encodeBase64(new Uint8Array(ciphertext)),
  } as const;
  return {
    ...unsigned,
    signature: encodeBase64(
      ed25519.sign(encoder.encode(pushEnvelopeSignatureData(unsigned)), input.hostSecretKey),
    ),
  };
}

export interface OpenPushEnvelopeInput {
  readonly envelope: PushEnvelope;
  /** The registration's 32-byte X25519 private key. */
  readonly recipientPrivateKey: Uint8Array;
  /** The pinned host push identity, a 32-byte Ed25519 public key. */
  readonly hostPublicKey: Uint8Array;
}

/**
 * Verifies the host signature, then decrypts. Freshness and replay are the receiver's
 * checks, since they depend on its clock and ledger.
 */
export async function openPushEnvelope(input: OpenPushEnvelopeInput): Promise<PushContent> {
  const { envelope } = input;
  const signed = ed25519.verify(
    decodeBase64(envelope.signature),
    encoder.encode(pushEnvelopeSignatureData(envelope)),
    input.hostPublicKey,
    { zip215: false },
  );
  if (!signed) throw new Error("Push envelope signature is invalid.");
  const recipient = await pushHpkeSuite.createRecipientContext({
    recipientKey: await pushHpkeSuite.kem.deserializePrivateKey(input.recipientPrivateKey),
    enc: decodeBase64(envelope.enc),
    info: encoder.encode(PUSH_HPKE_INFO),
  });
  const plaintext = await recipient.open(
    decodeBase64(envelope.ciphertext),
    encoder.encode(pushEnvelopeAad(envelope)),
  );
  return unpadPushPlaintext(new Uint8Array(plaintext));
}
