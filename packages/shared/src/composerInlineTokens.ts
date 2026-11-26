import { collectComposerMentionTokens } from "./composerMentionTokens.ts";
import { markdownMathRanges } from "./markdownMath.ts";

export type ComposerInlineToken =
  | {
      readonly type: "mention";
      readonly value: string;
      readonly source: string;
      readonly start: number;
      readonly end: number;
    }
  | {
      readonly type: "skill";
      readonly value: string;
      readonly source: string;
      readonly start: number;
      readonly end: number;
    };

export interface CollectComposerInlineTokensOptions {
  readonly preserveTrailingFrom?: ReadonlyArray<ComposerInlineToken>;
}

const SKILL_MENTION_SOURCE =
  /(^|\s)\p{Sc}(?![0-9][0-9_]*(?:[kKmMbBtT]|[eE][0-9]+)?(?:\s|$))(?=[a-zA-Z0-9:_-]*[a-zA-Z])([a-zA-Z0-9][a-zA-Z0-9:_-]*)/u
    .source;
const SKILL_TOKEN_REGEX = new RegExp(`${SKILL_MENTION_SOURCE}(?=\\s)`, "gu");
export const SKILL_MENTION_PATTERN = new RegExp(`${SKILL_MENTION_SOURCE}(?=\\s|$)`, "gu");

/**
 * Formulas in composer text, ignoring `$` and `\[` inside file links such as `posts.$postId.tsx`.
 * Links are masked with letters, not spaces, so a leading link cannot become an indented code
 * block. Bare `@path` mentions stay unmasked so `@README.md$` can still close a formula.
 */
export function composerMathRanges(
  text: string,
  mentions: ReadonlyArray<ComposerInlineToken> = collectComposerMentionTokens(text),
) {
  let masked = text;
  for (const mention of mentions) {
    if (mention.type !== "mention" || !mention.source.startsWith("[")) continue;
    masked =
      masked.slice(0, mention.start) +
      "x".repeat(mention.end - mention.start) +
      masked.slice(mention.end);
  }
  return markdownMathRanges(masked).map(({ start, end }) => ({
    start,
    end,
    source: text.slice(start, end),
  }));
}

export function collectComposerInlineTokens(
  text: string,
  options: CollectComposerInlineTokensOptions = {},
): ReadonlyArray<ComposerInlineToken> {
  const matches = collectComposerMentionTokens(text);

  for (const match of text.matchAll(SKILL_TOKEN_REGEX)) {
    const fullMatch = match[0];
    const prefix = match[1] ?? "";
    const value = match[2] ?? "";
    if (!value) {
      continue;
    }
    const start = (match.index ?? 0) + prefix.length;
    const end = start + fullMatch.length - prefix.length;
    matches.push({
      type: "skill",
      value,
      source: text.slice(start, end),
      start,
      end,
    });
  }

  for (const token of options.preserveTrailingFrom ?? []) {
    if (
      token.end === text.length &&
      text.slice(token.start, token.end) === token.source &&
      !matches.some(
        (match) =>
          match.type === token.type && match.start === token.start && match.end === token.end,
      )
    ) {
      matches.push(token);
    }
  }

  // TeX can contain literal skill and file tokens, especially inside \text{}.
  // They remain formula source rather than becoming composer context chips.
  // Confirmed trailing file links are masked too, so a kept chip is not read as TeX.
  const math = matches.length > 0 ? composerMathRanges(text, matches) : [];
  return matches
    .filter(
      (match) => !math.some((formula) => match.start < formula.end && match.end > formula.start),
    )
    .sort((left, right) => left.start - right.start);
}
