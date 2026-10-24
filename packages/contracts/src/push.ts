import * as Schema from "effect/Schema";

import { AuthSessionId, NonNegativeInt, TrimmedString } from "./baseSchemas.ts";

export const DEFAULT_PUSH_GATEWAY_ORIGIN = "https://push.supaterm.com";
export const MAX_PUSH_GATEWAY_ORIGINS = 32;

const LOCAL_PUSH_GATEWAY_HOSTS = new Set(["localhost", "127.0.0.1"]);

/** Plain http is only accepted for gateways on the host's own loopback, for development. */
export function normalizePushGatewayOrigin(input: string): string | null {
  let url: URL;
  try {
    url = new URL(input.trim());
  } catch {
    return null;
  }
  const local = LOCAL_PUSH_GATEWAY_HOSTS.has(url.hostname);
  if (url.protocol !== "https:" && !(local && url.protocol === "http:")) return null;
  if (url.username || url.password || url.search || url.hash || url.pathname !== "/") return null;
  return url.origin;
}

export const PushGatewayOrigin = Schema.String.check(
  Schema.isMaxLength(2048),
  Schema.makeFilter((value: string) => normalizePushGatewayOrigin(value) === value, {
    expected: "an https origin, or an http origin on localhost or 127.0.0.1",
  }),
);
export type PushGatewayOrigin = typeof PushGatewayOrigin.Type;

/** Lowercase UUID v4. IDs are bound into the envelope AAD, so one spelling is required. */
export const PushId = Schema.String.check(
  Schema.isPattern(/^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/),
);
export type PushId = typeof PushId.Type;

const base64Url = (length: number) =>
  Schema.String.check(Schema.isPattern(new RegExp(`^[A-Za-z0-9_-]{${length}}$`)));

/** 32 bytes, base64url without padding. */
export const PushKey32 = base64Url(43);
/** Gateway handle: 16 bytes, base64url without padding. */
export const PushHandle = base64Url(22);
export type PushHandle = typeof PushHandle.Type;

export const PushNotificationKind = Schema.Literals([
  "approval",
  "input",
  "completion",
  "failure",
  "usage-limit",
]);
export type PushNotificationKind = typeof PushNotificationKind.Type;

export const PushPreviewLevel = Schema.Literals(["hidden", "titles", "full"]);
export type PushPreviewLevel = typeof PushPreviewLevel.Type;

export const PushKinds = Schema.Struct({
  approval: Schema.Boolean,
  input: Schema.Boolean,
  completion: Schema.Boolean,
  failure: Schema.Boolean,
  "usage-limit": Schema.Boolean,
});
export type PushKinds = typeof PushKinds.Type;

export const DEFAULT_PUSH_KINDS: PushKinds = {
  approval: true,
  input: true,
  completion: true,
  failure: true,
  "usage-limit": true,
};

const encoder = new TextEncoder();
const maxUtf8Bytes = (max: number) =>
  Schema.makeFilter((value: string) => encoder.encode(value).byteLength <= max, {
    expected: `at most ${max} UTF-8 bytes`,
  });

export const PUSH_TITLE_MAX_BYTES = 120;
export const PUSH_SUBTITLE_MAX_BYTES = 80;
export const PUSH_BODY_MAX_BYTES = 400;

/** Decrypted notification content. `threadId` is empty for notifications without a thread. */
export const PushContent = Schema.Struct({
  environmentId: Schema.String.check(Schema.isMaxLength(256)),
  threadId: Schema.String.check(Schema.isMaxLength(256)),
  kind: PushNotificationKind,
  title: Schema.String.check(maxUtf8Bytes(PUSH_TITLE_MAX_BYTES)),
  subtitle: Schema.optionalKey(Schema.String.check(maxUtf8Bytes(PUSH_SUBTITLE_MAX_BYTES))),
  body: Schema.String.check(maxUtf8Bytes(PUSH_BODY_MAX_BYTES)),
});
export type PushContent = typeof PushContent.Type;

/** The `supaterm` key of the APNs payload, sealed by the host for one registration. */
export const PushEnvelope = Schema.Struct({
  v: Schema.Literal(1),
  registrationId: PushId,
  keyId: PushId,
  notificationId: PushId,
  createdAt: NonNegativeInt,
  expiresAt: NonNegativeInt,
  enc: PushKey32,
  ciphertext: Schema.String.check(Schema.isPattern(/^[A-Za-z0-9_-]{22,1387}$/)),
  signature: base64Url(86),
});
export type PushEnvelope = typeof PushEnvelope.Type;

export const PushRecipientKey = Schema.Struct({
  keyId: PushId,
  publicKey: PushKey32,
});
export type PushRecipientKey = typeof PushRecipientKey.Type;

export const PushDescribeResult = Schema.Struct({
  enabled: Schema.Boolean,
  hostKey: PushKey32,
  gatewayOrigins: Schema.Array(PushGatewayOrigin),
});
export type PushDescribeResult = typeof PushDescribeResult.Type;

export const PushRegisterInput = Schema.Struct({
  registrationId: PushId,
  gatewayOrigin: PushGatewayOrigin,
  handle: PushHandle,
  recipientKey: PushRecipientKey,
  preview: PushPreviewLevel,
  kinds: PushKinds,
  deviceName: Schema.optionalKey(TrimmedString.check(Schema.isMaxLength(64))),
});
export type PushRegisterInput = typeof PushRegisterInput.Type;

export const PushRegistrationInput = Schema.Struct({ registrationId: PushId });
export type PushRegistrationInput = typeof PushRegistrationInput.Type;

export const PushRegisterResult = PushRegistrationInput;
export type PushRegisterResult = typeof PushRegisterResult.Type;

export const PushRegistrationStatus = Schema.Literals(["active", "gone"]);
export type PushRegistrationStatus = typeof PushRegistrationStatus.Type;

export const PushRegistrationSummary = Schema.Struct({
  registrationId: PushId,
  sessionId: AuthSessionId,
  deviceName: Schema.NullOr(Schema.String),
  gatewayOrigin: Schema.String,
  preview: PushPreviewLevel,
  status: PushRegistrationStatus,
  createdAt: Schema.DateTimeUtc,
  lastDeliveryAt: Schema.optionalKey(Schema.DateTimeUtc),
  isCurrentSession: Schema.Boolean,
  sessionLabel: Schema.optionalKey(Schema.String),
});
export type PushRegistrationSummary = typeof PushRegistrationSummary.Type;

export const PushListResult = Schema.Struct({
  registrations: Schema.Array(PushRegistrationSummary),
});
export type PushListResult = typeof PushListResult.Type;

export const PushTestResult = Schema.Struct({
  status: Schema.Literals(["accepted", "gone", "failed"]),
});
export type PushTestResult = typeof PushTestResult.Type;

export const PushNotificationErrorReason = Schema.Literals([
  "disabled",
  "origin_not_allowed",
  "conflict",
  "not_found",
  "unavailable",
  "storage",
]);
export type PushNotificationErrorReason = typeof PushNotificationErrorReason.Type;

export class PushNotificationError extends Schema.TaggedError<PushNotificationError>()(
  "PushNotificationError",
  {
    reason: PushNotificationErrorReason,
    cause: Schema.optionalKey(Schema.Defect()),
  },
) {
  override get message(): string {
    switch (this.reason) {
      case "disabled":
        return "Push notifications are turned off on this host.";
      case "origin_not_allowed":
        return "This host does not allow the device's push gateway.";
      case "conflict":
        return "This push registration belongs to another session.";
      case "not_found":
        return "This push registration no longer exists.";
      case "unavailable":
        return "Push notifications are unavailable right now.";
      case "storage":
        return "Could not save push notification state.";
    }
  }
}
