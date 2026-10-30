import * as Schema from "effect/Schema";

import { RelayServerUrl } from "./relay.ts";
import { ChatAttachment } from "./chatAttachment.ts";
import { IsoDateTime, ThreadId, TrimmedNonEmptyString, TrimmedString } from "./baseSchemas.ts";

export const GuestShareId = TrimmedNonEmptyString.pipe(Schema.brand("GuestShareId"));
export type GuestShareId = typeof GuestShareId.Type;
export const GuestMessageId = TrimmedNonEmptyString.pipe(Schema.brand("GuestMessageId"));
export type GuestMessageId = typeof GuestMessageId.Type;

export const GUEST_SHARE_TTL_MS = 24 * 60 * 60 * 1000;
export const GUEST_MESSAGE_MAX_LENGTH = 4_000;
export const GUEST_NAME_MAX_LENGTH = 40;
export const GUEST_PENDING_MESSAGE_LIMIT = 3;
export const GUEST_RESOLVED_MESSAGE_LIMIT = 20;
export const GUEST_MESSAGE_MAX_ATTACHMENTS = 4;
export const GUEST_MESSAGE_MAX_ATTACHMENT_BYTES = 10 * 1024 * 1024;
export const GUEST_PENDING_ATTACHMENT_BYTES_LIMIT = 20 * 1024 * 1024;

export const ThreadGuestMessageStatus = Schema.Literals(["pending", "sent", "dismissed"]);
export type ThreadGuestMessageStatus = typeof ThreadGuestMessageStatus.Type;

export const ThreadGuestMessage = Schema.Struct({
  id: GuestMessageId,
  text: Schema.String,
  status: ThreadGuestMessageStatus,
  submittedAt: IsoDateTime,
  attachments: Schema.optional(Schema.Array(ChatAttachment)),
});
export type ThreadGuestMessage = typeof ThreadGuestMessage.Type;

export const ThreadGuestShare = Schema.Struct({
  id: GuestShareId,
  host: TrimmedNonEmptyString,
  createdAt: IsoDateTime,
  expiresAt: IsoDateTime,
  guestName: Schema.NullOr(TrimmedNonEmptyString),
  messages: Schema.Array(ThreadGuestMessage),
});
export type ThreadGuestShare = typeof ThreadGuestShare.Type;

export const pendingGuestMessageCount = (share: ThreadGuestShare | null | undefined): number =>
  share?.messages.filter((message) => message.status === "pending").length ?? 0;

const GuestPageUrl = Schema.String.check(
  Schema.isMaxLength(2048),
  Schema.makeFilter(
    (value) => {
      try {
        const url = new URL(value);
        return (
          ["http:", "https:"].includes(url.protocol) &&
          url.pathname === "/guest" &&
          !url.username &&
          !url.password &&
          !url.search &&
          !url.hash
        );
      } catch {
        return false;
      }
    },
    { expected: "an HTTP(S) guest page URL without credentials, query, or fragment" },
  ),
);
export const GuestShareCreateInput = Schema.Struct({
  threadId: ThreadId,
  guestPageUrl: GuestPageUrl,
});
export type GuestShareCreateInput = typeof GuestShareCreateInput.Type;

export const GuestShareCreateResult = Schema.Struct({
  url: TrimmedNonEmptyString,
  share: ThreadGuestShare,
});
export type GuestShareCreateResult = typeof GuestShareCreateResult.Type;

const GUEST_SHARE_CREATE_MESSAGES = {
  disabled: "Guest links are off. Turn them on in Settings > Labs.",
  relay_unavailable: "Guest links need a running encrypted relay.",
  thread_unavailable: "This thread cannot be shared.",
  read_failed: "Failed to read the shared thread.",
  changed: "The guest link changed while it was being created.",
} as const;

export class GuestShareCreateError extends Schema.TaggedError<GuestShareCreateError>()(
  "GuestShareCreateError",
  {
    reason: Schema.Literals([
      "disabled",
      "relay_unavailable",
      "thread_unavailable",
      "read_failed",
      "changed",
    ]),
  },
) {
  override get message(): string {
    return GUEST_SHARE_CREATE_MESSAGES[this.reason];
  }
}
const NAME_BREAKING_CHARACTER = /[\p{Cc}\p{Zl}\p{Zp}\u061C\u200E\u200F\u202A-\u202E\u2066-\u2069]/u;

export const GuestRedeemRequest = Schema.Struct({
  credential: TrimmedNonEmptyString,
  name: TrimmedNonEmptyString.check(
    Schema.isMaxLength(GUEST_NAME_MAX_LENGTH),
    Schema.makeFilter((name) => !NAME_BREAKING_CHARACTER.test(name), {
      description: "a single line of text",
    }),
  ),
});
export type GuestRedeemRequest = typeof GuestRedeemRequest.Type;

export const GuestSubmitRequest = Schema.Struct({
  shareId: GuestShareId,
  text: TrimmedString.check(Schema.isMaxLength(GUEST_MESSAGE_MAX_LENGTH)),
});
export type GuestSubmitRequest = typeof GuestSubmitRequest.Type;

export const GuestLinkPayload = Schema.Struct({
  version: Schema.Literal(1),
  address: TrimmedNonEmptyString.check(Schema.isMaxLength(256)),
  relayUrl: RelayServerUrl,
  credential: TrimmedNonEmptyString.check(Schema.isMaxLength(256)),
});
export type GuestLinkPayload = typeof GuestLinkPayload.Type;

export const GUEST_ROUTE_PREFIX = "/api/guest";
export const GUEST_SHARE_PARAM = "share";

export const GUEST_RENDER_ROUTE = `${GUEST_ROUTE_PREFIX}/render`;
export const GUEST_ITEM_ROUTE = `${GUEST_ROUTE_PREFIX}/item`;
export const GUEST_COMMAND_OUTPUT_ROUTE = `${GUEST_ROUTE_PREFIX}/command-output`;
export const GUEST_ATTACHMENT_ROUTE = `${GUEST_ROUTE_PREFIX}/attachment`;
export const GUEST_MEDIA_ROUTE = `${GUEST_ROUTE_PREFIX}/media`;
