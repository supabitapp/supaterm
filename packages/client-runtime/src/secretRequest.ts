import * as Schema from "effect/Schema";
import * as Option from "effect/Option";
import {
  SecretRequestError,
  type OrchestrationV2TurnItem,
  type SecretRequestAnswerInput,
} from "@supaterm/contracts";

export type SecretRequestItem = Extract<
  OrchestrationV2TurnItem,
  { readonly type: "secret_request" }
>;

export const secretRequestPrivacyNote = (_item: Pick<SecretRequestItem, "delivery">) =>
  "Kept out of chat in a permission-protected plaintext file. This agent’s commands can read or print it. Server cleanup removes it after 24 hours without file changes.";
export const SECRET_REQUEST_DEFAULT_PLACEHOLDER = "Paste the secret";

export type SecretRequestDisplay =
  | { readonly kind: "pending" }
  | { readonly kind: "pending-elsewhere"; readonly label: string }
  | {
      readonly kind: "answered";
      readonly outcome: "saved" | "declined" | "ended";
      readonly label: string;
    };

const SAVED_DISPLAY: SecretRequestDisplay = {
  kind: "answered",
  outcome: "saved",
  label: "Saved to a private file",
};
const DECLINED_DISPLAY: SecretRequestDisplay = {
  kind: "answered",
  outcome: "declined",
  label: "Declined",
};
const ENDED_DISPLAY: SecretRequestDisplay = {
  kind: "answered",
  outcome: "ended",
  label: "Request ended",
};
const PENDING_DISPLAY: SecretRequestDisplay = { kind: "pending" };
const PENDING_ELSEWHERE_DISPLAY: SecretRequestDisplay = {
  kind: "pending-elsewhere",
  label: "Waiting for an answer in the original thread",
};

export function secretRequestDisplay(
  item: Pick<SecretRequestItem, "secretStatus">,
  visibility: "local" | "inherited" | "synthetic",
): SecretRequestDisplay {
  switch (item.secretStatus) {
    case "pending":
      return visibility === "local" ? PENDING_DISPLAY : PENDING_ELSEWHERE_DISPLAY;
    case "saved":
      return SAVED_DISPLAY;
    case "declined":
      return DECLINED_DISPLAY;
    case "cancelled":
      return ENDED_DISPLAY;
  }
}

export function secretRequestAnswerInput(
  item: Pick<SecretRequestItem, "id" | "threadId">,
  answer: { readonly type: "save"; readonly secret: string } | { readonly type: "decline" },
): SecretRequestAnswerInput | null {
  if (answer.type === "decline") {
    return { threadId: item.threadId, turnItemId: item.id, answer: { type: "decline" } };
  }
  const secret = answer.secret.trim();
  if (secret.length === 0) return null;
  return { threadId: item.threadId, turnItemId: item.id, answer: { type: "save", secret } };
}

const decodeFailure = Schema.decodeUnknownOption(SecretRequestError);

export function secretRequestFailureMessage(failure: unknown): string {
  const decoded = decodeFailure(failure);
  if (Option.isSome(decoded)) return decoded.value.message;
  return "Could not answer the request. Try again.";
}
