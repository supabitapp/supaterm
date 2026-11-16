import { collectAssistantCitations } from "./assistantCitations.ts";
import { collectComposerContextReferences } from "./composerContextReferences.ts";
import type { ComposerInlineToken } from "./composerInlineTokens.ts";

/**
 * Adds the prompt's quote and context links to its inline tokens. A link wins over a token it
 * overlaps: an unfinished @ mention can otherwise consume the start of a link label.
 */
export function withComposerLinkTokens(text: string, tokens: ReadonlyArray<ComposerInlineToken>) {
  const citations = collectAssistantCitations(text);
  const references = collectComposerContextReferences(text);
  if (citations.length === 0 && references.length === 0) return tokens;

  const links = [
    ...citations.map((match) => ({ ...match, type: "citation" as const })),
    ...references.map((match) => ({ ...match, type: "context-reference" as const })),
  ];
  return [
    ...tokens.filter(
      (token) => !links.some((link) => token.start < link.end && token.end > link.start),
    ),
    ...links,
  ].sort((left, right) => left.start - right.start);
}
