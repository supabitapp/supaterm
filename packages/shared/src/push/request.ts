import { ed25519 } from "@noble/curves/ed25519.js";
import { sha256 } from "@noble/hashes/sha2.js";
import { bytesToHex } from "@noble/hashes/utils.js";

import { encodeBase64 } from "../relay/protocol.ts";

export const PUSH_REQUEST_CONTEXT = "supaterm-push-request-v1";
export const PUSH_KEY_HEADER = "supaterm-push-key";
export const PUSH_TIMESTAMP_HEADER = "supaterm-push-timestamp";
export const PUSH_SIGNATURE_HEADER = "supaterm-push-signature";

export interface PushGatewayRequest {
  readonly method: string;
  /** Path only, such as `/v1/send`. */
  readonly path: string;
  /** Exact body bytes sent. DELETE requests send none. */
  readonly body: string | Uint8Array;
  /** Unix milliseconds. */
  readonly timestamp: number;
}

const encoder = new TextEncoder();

/** The host push identity's public key, base64url, as sent in `supaterm-push-key`. */
export function pushHostPublicKey(hostSecretKey: Uint8Array): string {
  return encodeBase64(ed25519.getPublicKey(hostSecretKey));
}

export function pushRequestSigningString(request: PushGatewayRequest): string {
  const body = typeof request.body === "string" ? encoder.encode(request.body) : request.body;
  return [
    PUSH_REQUEST_CONTEXT,
    request.method.toUpperCase(),
    request.path,
    request.timestamp,
    bytesToHex(sha256(body)),
  ].join("\n");
}

/** Host-auth headers for a gateway request, signed by the host push identity. */
export function signPushRequest(
  hostSecretKey: Uint8Array,
  request: PushGatewayRequest,
): Record<string, string> {
  return {
    [PUSH_KEY_HEADER]: pushHostPublicKey(hostSecretKey),
    [PUSH_TIMESTAMP_HEADER]: String(request.timestamp),
    [PUSH_SIGNATURE_HEADER]: encodeBase64(
      ed25519.sign(encoder.encode(pushRequestSigningString(request)), hostSecretKey),
    ),
  };
}
