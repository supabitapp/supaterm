import * as Schema from "effect/Schema";

import { ThreadId, TurnItemId } from "./baseSchemas.ts";

/** The http(s) page a secret card may open, or null for anything else. */
export function secretRequestPageUrl(value: string): URL | null {
  // React Native's URL has no `canParse`.
  try {
    const url = new URL(value);
    return (url.protocol === "https:" || url.protocol === "http:") && url.host !== "" ? url : null;
  } catch {
    return null;
  }
}

/** Server keeps the value until it moves to the agent's file; the thread learns only status. */
export const SecretRequestAnswerInput = Schema.Struct({
  threadId: ThreadId,
  turnItemId: TurnItemId,
  answer: Schema.Union([
    Schema.Struct({
      type: Schema.Literal("save"),
      secret: Schema.String.check(Schema.isPattern(/\S/)),
    }),
    /** A request with `fields`: one value per field name. */
    Schema.Struct({
      type: Schema.Literal("save"),
      values: Schema.Record(Schema.String, Schema.String.check(Schema.isPattern(/\S/))),
    }),
    Schema.Struct({ type: Schema.Literal("decline") }),
  ]),
});
export type SecretRequestAnswerInput = typeof SecretRequestAnswerInput.Type;

/** What the agent reads when its card ends without a secret. */
export const SECRET_REQUEST_UNSAVED_NOTE = {
  declined:
    "The user declined. Don't ask for it in chat or another way; say what's blocked and go on without it.",
  cancelled:
    "The card closed with the run. Ask again with a new clientRequestId only if the secret is still needed.",
  timed_out:
    "No answer in time. Don't ask in chat; ask again with a new clientRequestId only if it is still needed.",
} as const;

const SECRET_REQUEST_FAILURE_MESSAGES = {
  load_failed: "Could not load the secret request.",
  not_found: "This secret request no longer exists.",
  already_answered: "This secret request was already answered.",
  fields_mismatch: "This request asks for different values. Update the app and try again.",
  agent_stopped: "The agent that asked has stopped, so this secret can't be used.",
  store_failed: "Could not store the secret.",
  record_failed: "Saved the secret, but could not update the request.",
  read_failed: "Could not read the secret.",
  secret_unavailable:
    "The saved secret is no longer available. Ask the user again with request_secret.",
  secret_expired: "The saved secret expired. Ask the user again with request_secret.",
  delivery_failed: "Could not finish writing the secret file. Try again.",
} as const;

export const SecretRequestFailureReason = Schema.Literals(
  Object.keys(SECRET_REQUEST_FAILURE_MESSAGES) as Array<
    keyof typeof SECRET_REQUEST_FAILURE_MESSAGES
  >,
);
export type SecretRequestFailureReason = typeof SecretRequestFailureReason.Type;

export class SecretRequestError extends Schema.TaggedError<SecretRequestError>()(
  "SecretRequestError",
  {
    reason: SecretRequestFailureReason,
    cause: Schema.optionalKey(Schema.Defect()),
  },
) {
  override get message(): string {
    return SECRET_REQUEST_FAILURE_MESSAGES[this.reason];
  }
}
