import { TextGenerationError } from "@supaterm/contracts";
import * as Option from "effect/Option";
import * as Schema from "effect/Schema";

const isTextGenerationError = Schema.is(TextGenerationError);
const decodeJsonThreadTitle = Schema.decodeOption(
  Schema.fromJsonString(Schema.Struct({ title: Schema.String })),
);

export function toJsonSchemaObject(schema: Schema.Top): unknown {
  const document = Schema.toJsonSchemaDocument(Schema.toType(schema), {
    onExcessProperty: "error",
  });
  if (document.definitions && Object.keys(document.definitions).length > 0) {
    return { ...document.schema, $defs: document.definitions };
  }
  return document.schema;
}

export function limitSection(value: string, maxChars: number): string {
  if (value.length <= maxChars) return value;
  const truncated = value.slice(0, maxChars);
  return `${truncated}\n\n[truncated]`;
}

export function sanitizeCommitSubject(raw: string): string {
  const singleLine = raw.trim().split(/\r?\n/g)[0]?.trim() ?? "";
  const withoutTrailingPeriod = singleLine.replace(/[.]+$/g, "").trim();
  if (withoutTrailingPeriod.length === 0) {
    return "Update project files";
  }

  if (withoutTrailingPeriod.length <= 72) {
    return withoutTrailingPeriod;
  }
  const segments = new Intl.Segmenter(undefined, { granularity: "grapheme" }).segment(
    withoutTrailingPeriod,
  );
  let subject = "";
  for (const { segment } of segments) {
    if (subject.length + segment.length > 72) break;
    subject += segment;
  }
  return subject.trimEnd() || "Update project files";
}

export function sanitizePrTitle(raw: string): string {
  const singleLine = raw.trim().split(/\r?\n/g)[0]?.trim() ?? "";
  if (singleLine.length > 0) {
    return singleLine;
  }
  return "Update project changes";
}

const MAX_THREAD_TITLE_CHARS = 120;

export function sanitizeThreadTitle(raw: string): string {
  // Unwrap a JSON-formatted title before truncation can cut off the closing brace.
  const decoded = decodeJsonThreadTitle(raw);
  const title = Option.isSome(decoded) ? decoded.value.title : raw;
  const normalized = title
    .trim()
    .split(/\r?\n/g)[0]
    ?.trim()
    .replace(/^['"`]+|['"`]+$/g, "")
    .trim()
    .replace(/\s+/g, " ");

  if (!normalized || normalized.trim().length === 0) {
    return "New thread";
  }

  if (normalized.length <= MAX_THREAD_TITLE_CHARS) {
    return normalized;
  }

  return `${normalized.slice(0, MAX_THREAD_TITLE_CHARS - 3).trimEnd()}...`;
}

const NEXT_PROMPT_MAX_WORDS = 12;
const NEXT_PROMPT_WRAPPER = /^<(suggestion|response|output|answer|result)>([\s\S]*)<\/\1>$/i;
const NEXT_PROMPT_LABEL =
  /^\s*(suggested\s+(response|reply|input|prompt)|suggestion|response|reply|answer|output|result)\s*[:：]\s*/i;
const ONE_WORD_NEXT_PROMPTS: ReadonlySet<string> = new Set([
  "yes",
  "yeah",
  "yep",
  "yup",
  "sure",
  "ok",
  "okay",
]);

// Each names a kind of text that is not a message the user would type next.
const NOT_A_NEXT_PROMPT: Record<string, (text: string, words: ReadonlyArray<string>) => boolean> = {
  declined: (text) =>
    /^(done|nothing found|nothing to suggest|no suggestion)\W*$/i.test(text) ||
    /\bstay(s|ing)? silent\b|^\W*silence\W*$/i.test(text),
  bracketed: (text) => /^(\(.*\)|\[.*\])$/.test(text),
  labelOrError: (text) => /^\w+:\s/.test(text) || /^(api )?error\b/i.test(text),
  tooFewWords: (_, words) =>
    words.length < 2 && !ONE_WORD_NEXT_PROMPTS.has(words.join("").toLowerCase().replace(/\W/g, "")),
  tooManyWords: (_, words) => words.length > NEXT_PROMPT_MAX_WORDS,
  severalSentences: (text) => /[.!?]\s+\p{Lu}/u.test(text),
  formatted: (text) => /[*`#]/.test(text),
  question: (text) => text.endsWith("?"),
  evaluative: (text) =>
    /\b(thanks|thank you|looks good|sounds good|that works|that worked|that's all|nice|great|perfect|makes sense|awesome|excellent)\b/i.test(
      text,
    ),
  agentVoice: (text) =>
    /^(let me|i'll|i've|i'm|i can|i would|i think|i notice|here's|here is|here are|that's|this is|this will|you can|you should|you could|sure,|of course|certainly)\b/i.test(
      text,
    ),
};

export function sanitizeNextPrompt(raw: string): string | null {
  const unwrapped = raw
    .trim()
    .replace(NEXT_PROMPT_WRAPPER, "$2")
    .trim()
    .replace(/^['"`“]+|['"`”]+$/g, "")
    .replace(NEXT_PROMPT_LABEL, "")
    .trim();
  if (unwrapped.includes("\n")) return null;
  const text = unwrapped.replace(/\s+/g, " ");
  const words = text.split(" ").filter(Boolean);
  if (words.length === 0) return null;
  return Object.values(NOT_A_NEXT_PROMPT).some((rejects) => rejects(text, words)) ? null : text;
}

function cliLabel(cliName: string): string {
  const capitalized = cliName.charAt(0).toUpperCase() + cliName.slice(1);
  return `${capitalized} CLI (\`${cliName}\`)`;
}

export function normalizeCliError(
  cliName: string,
  operation: string,
  error: unknown,
  fallback: string,
): TextGenerationError {
  if (isTextGenerationError(error)) {
    return error;
  }

  if (error instanceof Error) {
    const lower = error.message.toLowerCase();
    if (
      error.message.includes(`Command not found: ${cliName}`) ||
      lower.includes(`spawn ${cliName}`) ||
      lower.includes("enoent")
    ) {
      return new TextGenerationError({
        operation,
        detail: `${cliLabel(cliName)} is required but not available on PATH.`,
        cause: error,
      });
    }
    return new TextGenerationError({
      operation,
      detail: fallback,
      cause: error,
    });
  }

  return new TextGenerationError({
    operation,
    detail: fallback,
    cause: error,
  });
}
