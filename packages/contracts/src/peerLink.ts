import * as Effect from "effect/Effect";
import * as Schema from "effect/Schema";

import { AuthMcpClientAccess } from "./auth.ts";
import { EnvironmentId, ThreadId, TrimmedNonEmptyString, TurnItemId } from "./baseSchemas.ts";
import { RelayConnectionInfo } from "./relay.ts";

export const PeerLink = Schema.Struct({
  environmentId: EnvironmentId,
  label: Schema.String,

  urls: Schema.Array(TrimmedNonEmptyString),
  relay: Schema.optionalKey(RelayConnectionInfo),
  access: AuthMcpClientAccess,
  linkedAt: Schema.DateTimeUtc,
  expiresAt: Schema.DateTimeUtc,
  lastReachedAt: Schema.NullOr(Schema.DateTimeUtc),
  lastError: Schema.NullOr(Schema.String),
});
export type PeerLink = typeof PeerLink.Type;

export const PeerLinkStatus = Schema.Literals(["reachable", "unreachable", "expired"]);
export type PeerLinkStatus = typeof PeerLinkStatus.Type;

export const PeerLinkSummary = Schema.Struct({
  ...PeerLink.fields,
  status: PeerLinkStatus,
});
export type PeerLinkSummary = typeof PeerLinkSummary.Type;

export const PeerLinkCreateInput = Schema.Struct({
  url: Schema.optional(TrimmedNonEmptyString),
  relay: Schema.optionalKey(RelayConnectionInfo),

  alternateUrls: Schema.optionalKey(Schema.Array(TrimmedNonEmptyString)),

  pairingCode: TrimmedNonEmptyString,
  access: AuthMcpClientAccess,

  expectedEnvironmentId: Schema.optionalKey(EnvironmentId),

  expectedLabel: Schema.optionalKey(TrimmedNonEmptyString),
}).check(
  Schema.makeFilter(
    (input) =>
      input.url !== undefined || input.relay !== undefined || "A URL or relay is required.",
  ),
);
export type PeerLinkCreateInput = typeof PeerLinkCreateInput.Type;

export const PeerLinkRemoveInput = Schema.Struct({ environmentId: EnvironmentId });
export type PeerLinkRemoveInput = typeof PeerLinkRemoveInput.Type;

export const PeerLinkRemoveResult = Schema.Struct({ removed: Schema.Boolean });
export type PeerLinkRemoveResult = typeof PeerLinkRemoveResult.Type;

export class PeerLinkError extends Schema.TaggedError<PeerLinkError>()("PeerLinkError", {
  reason: Schema.Literals([
    "unreachable",
    "not_a_supaterm_environment",
    "incompatible",
    "self",
    "pairing_rejected",
    "expired",
    "unknown_link",
    "storage",
    "disabled",
  ]),
  message: Schema.String,
  cause: Schema.optionalKey(Schema.Defect()),
}) {}

export const PeerLinkRequestAnswerInput = Schema.Struct({
  threadId: ThreadId,
  turnItemId: TurnItemId,
  answer: Schema.Union([
    Schema.Struct({
      type: Schema.Literal("link"),

      environmentId: Schema.optionalKey(EnvironmentId),

      label: Schema.optionalKey(TrimmedNonEmptyString),

      urls: Schema.Array(TrimmedNonEmptyString).pipe(
        Schema.withDecodingDefault(Effect.succeed([])),
      ),
      relay: Schema.optionalKey(RelayConnectionInfo),
      access: AuthMcpClientAccess,
      pairingCode: TrimmedNonEmptyString,
    }).check(
      Schema.makeFilter(
        (answer) =>
          answer.urls.length > 0 || answer.relay !== undefined || "A URL or relay is required.",
      ),
    ),

    Schema.Struct({ type: Schema.Literal("use-existing"), environmentId: EnvironmentId }),
    Schema.Struct({ type: Schema.Literal("decline") }),
  ]),
});
export type PeerLinkRequestAnswerInput = typeof PeerLinkRequestAnswerInput.Type;

const PEER_LINK_REQUEST_FAILURE_MESSAGES = {
  load_failed: "Could not load the link request.",
  not_found: "This link request no longer exists.",
  already_answered: "This link request was already answered.",
  record_failed: "Could not update the link request.",
} as const;

export const PeerLinkRequestFailureReason = Schema.Literals(
  Object.keys(PEER_LINK_REQUEST_FAILURE_MESSAGES) as Array<
    keyof typeof PEER_LINK_REQUEST_FAILURE_MESSAGES
  >,
);
export type PeerLinkRequestFailureReason = typeof PeerLinkRequestFailureReason.Type;

export class PeerLinkRequestError extends Schema.TaggedError<PeerLinkRequestError>()(
  "PeerLinkRequestError",
  {
    reason: PeerLinkRequestFailureReason,
    cause: Schema.optionalKey(Schema.Defect()),
  },
) {
  override get message(): string {
    return PEER_LINK_REQUEST_FAILURE_MESSAGES[this.reason];
  }
}
