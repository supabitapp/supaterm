import * as Schema from "effect/Schema";

import { IsoDateTime, TrimmedNonEmptyString } from "./baseSchemas.ts";
import { GuestShareId, ThreadGuestMessage } from "./guestShare.ts";
import { OrchestrationV2ThreadStreamItem } from "./orchestrationV2.ts";
import { ProviderDriverKind } from "./providerInstance.ts";

export const GUEST_STREAM_MAX_EVENT_BYTES = 8 * 1024 * 1024;
export const GUEST_STREAM_ERROR_EVENT = "guest-error";
export const GuestStreamError = Schema.Struct({ reason: Schema.Literal("event_too_large") });
export type GuestStreamError = typeof GuestStreamError.Type;

export const GuestThreadModel = Schema.Struct({
  driver: Schema.NullOr(ProviderDriverKind),
  name: TrimmedNonEmptyString,
  shortName: Schema.optional(TrimmedNonEmptyString),
  subProvider: Schema.optional(TrimmedNonEmptyString),
});
export type GuestThreadModel = typeof GuestThreadModel.Type;

export const GuestShareView = Schema.Struct({
  shareId: GuestShareId,
  title: Schema.String,
  guestName: TrimmedNonEmptyString,
  expiresAt: IsoDateTime,
  messages: Schema.Array(ThreadGuestMessage),
  model: GuestThreadModel,
});
export type GuestShareView = typeof GuestShareView.Type;

export const GuestStreamEvent = Schema.Union([
  Schema.Struct({ type: Schema.Literal("view"), view: GuestShareView }),
  Schema.Struct({ type: Schema.Literal("thread"), item: OrchestrationV2ThreadStreamItem }),
  Schema.Struct({ type: Schema.Literal("ended") }),
]);
export type GuestStreamEvent = typeof GuestStreamEvent.Type;
