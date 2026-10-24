import {
  PUSH_BODY_MAX_BYTES,
  PUSH_SUBTITLE_MAX_BYTES,
  PUSH_TITLE_MAX_BYTES,
  PushContent,
  type PushNotificationKind,
  type PushPreviewLevel,
} from "@supaterm/contracts/push";
import * as Schema from "effect/Schema";

export const PUSH_PLAINTEXT_SIZES = [256, 512, 1024] as const;
export const PUSH_PLAINTEXT_MAX_BYTES = 1024;
export const PUSH_FALLBACK_TITLE = "Supaterm";

export const PUSH_KIND_LABELS: Record<PushNotificationKind, string> = {
  approval: "Approval needed",
  input: "Input needed",
  completion: "Finished",
  failure: "Failed",
  "usage-limit": "Usage limit reached",
};

const encoder = new TextEncoder();
const decoder = new TextDecoder("utf-8", { fatal: true });
const decodePushContent = Schema.decodeUnknownSync(Schema.fromJsonString(PushContent));

const utf8Length = (value: string) => encoder.encode(value).byteLength;

// Bidi overrides and isolates can make lock-screen text read differently from what the agent wrote.
const UNSAFE_CHARACTERS = /[\p{Cc}\u061C\u200E\u200F\u202A-\u202E\u2066-\u2069]/gu;

export function sanitizePushText(input: string): string {
  return input.slice(0, 8192).replace(/\s+/gu, " ").replace(UNSAFE_CHARACTERS, "").trim();
}

/** Cuts on code point boundaries and marks the cut with an ellipsis inside the budget. */
export function truncateUtf8(input: string, maxBytes: number): string {
  if (utf8Length(input) <= maxBytes) return input;
  const budget = maxBytes - utf8Length("…");
  let result = "";
  let bytes = 0;
  for (const character of input) {
    const size = utf8Length(character);
    if (bytes + size > budget) break;
    bytes += size;
    result += character;
  }
  return `${result.trimEnd()}…`;
}

const boundedText = (input: string, maxBytes: number) =>
  truncateUtf8(sanitizePushText(input), maxBytes);

function serializeContent(content: PushContent, padding: number): string {
  return JSON.stringify({
    environmentId: content.environmentId,
    threadId: content.threadId,
    kind: content.kind,
    title: content.title,
    ...(content.subtitle === undefined ? {} : { subtitle: content.subtitle }),
    body: content.body,
    p: " ".repeat(padding),
  });
}

function unpaddedLength(content: PushContent): number {
  return utf8Length(serializeContent(content, 0));
}

/** Pads with spaces in `p` so the ciphertext only reveals one of three size classes. */
export function padPushPlaintext(content: PushContent): Uint8Array {
  const length = unpaddedLength(content);
  const size = PUSH_PLAINTEXT_SIZES.find((candidate) => candidate >= length);
  if (size === undefined) {
    throw new Error(`Push plaintext is ${length} bytes, over ${PUSH_PLAINTEXT_MAX_BYTES}.`);
  }
  return encoder.encode(serializeContent(content, size - length));
}

export function unpadPushPlaintext(plaintext: Uint8Array): PushContent {
  if (!PUSH_PLAINTEXT_SIZES.some((size) => size === plaintext.byteLength)) {
    throw new Error(`Push plaintext has an unexpected size of ${plaintext.byteLength} bytes.`);
  }
  return decodePushContent(decoder.decode(plaintext));
}

export interface PushContentSource {
  readonly environmentId: string;
  readonly threadId: string;
  readonly kind: PushNotificationKind;
  readonly threadTitle: string;
  readonly projectTitle?: string | null;
  /** The approval summary, question, last assistant message, or error. Only `full` shows it. */
  readonly detail?: string | null;
}

/** Applies a registration's preview level and keeps the padded plaintext within 1024 bytes. */
export function buildPushContent(
  source: PushContentSource,
  preview: PushPreviewLevel,
): PushContent {
  const label = PUSH_KIND_LABELS[source.kind];
  const base = {
    environmentId: source.environmentId,
    threadId: source.threadId,
    kind: source.kind,
  };
  if (preview === "hidden") return { ...base, title: PUSH_FALLBACK_TITLE, body: label };
  const title = boundedText(source.threadTitle, PUSH_TITLE_MAX_BYTES) || PUSH_FALLBACK_TITLE;
  const subtitle = boundedText(source.projectTitle ?? "", PUSH_SUBTITLE_MAX_BYTES);
  const detail = preview === "full" ? sanitizePushText(source.detail ?? "") : "";
  const content = { ...base, title, ...(subtitle === "" ? {} : { subtitle }) };
  let body = truncateUtf8(detail === "" ? label : `${label}: ${detail}`, PUSH_BODY_MAX_BYTES);
  // JSON escaping can double quotes and backslashes, so the byte budgets alone do not bound it.
  while (
    body.length > label.length &&
    unpaddedLength({ ...content, body }) > PUSH_PLAINTEXT_MAX_BYTES
  ) {
    body = truncateUtf8(body, utf8Length(body) - 16);
  }
  return { ...content, body };
}

export function buildPushTestContent(environmentId: string): PushContent {
  return {
    environmentId,
    threadId: "",
    kind: "completion",
    title: PUSH_FALLBACK_TITLE,
    body: "Test notification",
  };
}
