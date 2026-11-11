import {
  secretRequestPageUrl,
  type OrchestrationV2TurnItem,
  type SecretRequestAnswerInput,
} from "@supaterm/contracts";

export type SecretRequestItem = Extract<
  OrchestrationV2TurnItem,
  { readonly type: "secret_request" }
>;

/** The agent's commands read the value from a file, so the card must not promise more. */
export const SECRET_REQUEST_PRIVACY_NOTE =
  "Secrets are kept out of chat history and automatically deleted";
const SECRET_REQUEST_DEFAULT_PLACEHOLDER = "Paste the secret";

export interface SecretRequestInput {
  /** Key in the card's values: the field name, or "" for a request without fields. */
  readonly key: string;
  readonly label: string;
  readonly placeholder: string;
  readonly masked: boolean;
}

export function secretRequestInputs(
  item: Pick<SecretRequestItem, "label" | "placeholder" | "fields">,
): ReadonlyArray<SecretRequestInput> {
  if (item.fields === undefined) {
    return [
      {
        key: "",
        label: item.label,
        placeholder: item.placeholder ?? SECRET_REQUEST_DEFAULT_PLACEHOLDER,
        masked: true,
      },
    ];
  }
  return item.fields.map((field) => ({
    key: field.name,
    label: field.label,
    placeholder: "",
    masked: field.secret !== false,
  }));
}

/** A card value by input key. Own keys only: a field may be named `constructor`. */
export const secretRequestValue = (values: Readonly<Record<string, string>>, key: string) =>
  Object.hasOwn(values, key) ? (values[key] ?? "") : "";

// Backticks, <angle brackets> and markdown link targets (balanced parentheses allowed) keep their
// exact text; a bare link drops trailing sentence punctuation.
const REASON_LINK =
  /`(https?:\/\/[^`\s]+)`|<(https?:\/\/[^>\s]+)>|\]\((https?:\/\/(?:[^()\s]|\([^()\s]*\))+)\)|(https?:\/\/[^\s<>"'`[\]]+)/giu;
/** Drops trailing sentence punctuation; a `)` stays when the link opened a matching `(`. */
function trimPunctuation(link: string): string {
  let end = link.length;
  while (end > 0 && ".,;:!?)".includes(link[end - 1]!)) {
    const kept = link.slice(0, end);
    if (link[end - 1] === ")" && kept.split("(").length > kept.split(")").length - 1) break;
    end -= 1;
  }
  return link.slice(0, end);
}

/** Drops a closing `*` or `_` run only when the same run opened emphasis before the link and is still open. */
function trimEmphasis(link: string, before: string) {
  const run = /(\*{1,3}|_{1,3})$/u.exec(link)?.[1];
  if (run === undefined) return link;
  const escaped = run.replaceAll("*", "\\*");
  // Nested emphasis (`**_url_**`) opens one run right after another.
  const opener = [...before.matchAll(new RegExp(`(?:^|[\\s(*_])${escaped}(?=\\S|$)`, "gu"))].at(-1);
  if (opener === undefined) return link;
  const closed = new RegExp(`\\S${escaped}(?:[\\s.,;:!?)]|$)`, "u").test(
    before.slice(opener.index + opener[0].length),
  );
  return closed ? link : trimPunctuation(link.slice(0, -run.length));
}

/** The one distinct http(s) link in `reason`, for agents that put it there instead of in `url`. */
function reasonLink(reason: string): string | undefined {
  const raw = Array.from(reason.matchAll(REASON_LINK), (match) => {
    const [, ticked, angled, target, bare] = match;
    if (bare === undefined) return ticked ?? angled ?? target ?? "";
    const before = reason.slice(0, match.index);
    let link = trimPunctuation(bare);
    for (let next = trimEmphasis(link, before); next !== link; next = trimEmphasis(link, before)) {
      link = next;
    }
    return link;
  });
  // Two spellings of one page (`https://a.dev` and `https://a.dev/`) count once.
  const links = new Set(raw.map((link) => secretRequestPageUrl(link)?.href ?? link));
  return links.size === 1 ? [...links][0] : undefined;
}

/** Only http(s), so an agent cannot make the card open another scheme. */
export function secretRequestLink(item: Pick<SecretRequestItem, "url" | "reason">) {
  const raw = item.url ?? reasonLink(item.reason);
  const url = raw === undefined ? null : secretRequestPageUrl(raw);
  return url === null ? null : { href: url.href, host: url.host };
}

export type SecretRequestDisplay =
  | { readonly kind: "pending" }
  | { readonly kind: "pending-elsewhere"; readonly label: string }
  | {
      readonly kind: "answered";
      readonly outcome: "saved" | "declined" | "ended";
      readonly label: string;
    }
  /** Shown as a card, not a work-log row: the user has to ask the agent again. */
  | { readonly kind: "expired"; readonly label: string; readonly hint: string };

const SAVED_DISPLAY: SecretRequestDisplay = {
  kind: "answered",
  outcome: "saved",
  label: "Sent",
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
const EXPIRED_DISPLAY: SecretRequestDisplay = {
  kind: "expired",
  label: "Expired",
  hint: "The agent stopped waiting for an answer. Tell it to ask again when you are ready.",
};
const PENDING_DISPLAY: SecretRequestDisplay = { kind: "pending" };
const PENDING_ELSEWHERE_DISPLAY: SecretRequestDisplay = {
  kind: "pending-elsewhere",
  label: "Waiting for an answer in the original thread",
};

/**
 * `visibility` is the projected row's: a request inherited from another
 * thread (a fork) can only be answered where it was asked.
 */
export function secretRequestDisplay(
  item: Pick<SecretRequestItem, "secretStatus" | "timedOut">,
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
      return item.timedOut === true ? EXPIRED_DISPLAY : ENDED_DISPLAY;
  }
}

export type SecretRequestReply =
  /** Keyed by `SecretRequestInput.key`. */
  | { readonly type: "save"; readonly values: Readonly<Record<string, string>> }
  | { readonly type: "decline" };

/** Null until every input has a value. */
export function secretRequestAnswerInput(
  item: Pick<SecretRequestItem, "id" | "threadId" | "label" | "placeholder" | "fields">,
  answer: SecretRequestReply,
): SecretRequestAnswerInput | null {
  const base = { threadId: item.threadId, turnItemId: item.id };
  if (answer.type === "decline") return { ...base, answer: { type: "decline" } };
  const entries = secretRequestInputs(item).map(
    (input) => [input.key, secretRequestValue(answer.values, input.key)] as const,
  );
  if (entries.some(([, value]) => value.trim().length === 0)) return null;
  if (item.fields === undefined) {
    return { ...base, answer: { type: "save", secret: entries[0]?.[1] ?? "" } };
  }
  return { ...base, answer: { type: "save", values: Object.fromEntries(entries) } };
}

const USER_FACING_FAILURE_TAGS = new Set(["SecretRequestError", "EnvironmentAuthorizationError"]);

/**
 * Only known server errors pass their message through: anything else (transport or encoding
 * failures) gets the generic copy, so the typed value can never surface in the UI.
 */
export function secretRequestFailureMessage(failure: unknown): string {
  if (
    typeof failure === "object" &&
    failure !== null &&
    "_tag" in failure &&
    typeof failure._tag === "string" &&
    USER_FACING_FAILURE_TAGS.has(failure._tag) &&
    "message" in failure &&
    typeof failure.message === "string" &&
    failure.message.trim().length > 0
  ) {
    return failure.message;
  }
  return "Could not answer the request. Try again.";
}
