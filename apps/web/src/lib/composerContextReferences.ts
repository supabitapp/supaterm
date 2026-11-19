import type { ComposerContextId, ComposerContextKind } from "@supaterm/contracts";
import {
  collectComposerContextReferences,
  formatComposerContextReference,
  replaceComposerContextReferences,
} from "@supaterm/shared/composerContextReferences";

export interface ComposerContextReference {
  kind: ComposerContextKind;
  contextId: string;
  label: string;
}

export function producerIdFromComposerContextId(kind: ComposerContextKind, contextId: string) {
  const prefix = `${kind}_`;
  return contextId.startsWith(prefix) ? contextId.slice(prefix.length) : contextId;
}

export function formatInlineContextReference(reference: ComposerContextReference) {
  return formatComposerContextReference({
    kind: reference.kind,
    contextId: reference.contextId as ComposerContextId,
    label: reference.label,
  });
}

export function collectInlineContextIds(prompt: string): string[];
export function collectInlineContextIds(prompt: string) {
  return Array.from(
    new Set(collectComposerContextReferences(prompt).map((occurrence) => occurrence.contextId)),
  ) satisfies string[];
}

export function stripInlineContextReferences(prompt: string) {
  return replaceComposerContextReferences(prompt, () => "");
}

function isBoundaryWhitespace(char: string | undefined) {
  return char === undefined || char === " " || char === "\n" || char === "\t" || char === "\r";
}

export function inlineContextReferenceReplacement(
  prompt: string,
  selection: { start: number; end: number },
  references: ReadonlyArray<ComposerContextReference>,
) {
  const start = Math.max(0, Math.min(prompt.length, Math.floor(selection.start)));
  const end = Math.max(start, Math.min(prompt.length, Math.floor(selection.end)));
  const needsLeadingSpace = !isBoundaryWhitespace(prompt[start - 1]);
  return {
    start,
    end: prompt[end] === " " ? end + 1 : end,
    text: `${needsLeadingSpace ? " " : ""}${references.map(formatInlineContextReference).join(" ")} `,
  };
}

export function insertInlineContextReference(
  prompt: string,
  cursorInput: number,
  reference: ComposerContextReference,
) {
  const edit = inlineContextReferenceReplacement(prompt, { start: cursorInput, end: cursorInput }, [
    reference,
  ]);
  return {
    prompt: `${prompt.slice(0, edit.start)}${edit.text}${prompt.slice(edit.end)}`,
    cursor: edit.start + edit.text.length,
  };
}

export function appendInlineContextReference(prompt: string, reference: ComposerContextReference) {
  return insertInlineContextReference(prompt, prompt.length, reference).prompt;
}

export function removeInlineContextReference(prompt: string, contextId: string) {
  const occurrences = collectComposerContextReferences(prompt).filter(
    (candidate) => candidate.contextId === contextId,
  );
  if (occurrences.length === 0) return { prompt, cursor: prompt.length };
  let result = prompt;
  let cursor = prompt.length;
  for (const occurrence of occurrences.toReversed()) {
    let { start, end } = occurrence;
    if (result[end] === " ") end += 1;
    else if (result[start - 1] === " ") start -= 1;
    result = `${result.slice(0, start)}${result.slice(end)}`;
    cursor = start;
  }
  if (cursor >= result.length) {
    result = result.trimEnd();
    cursor = result.length;
  }
  return { prompt: result, cursor };
}

export function ensureInlineContextReferences(
  prompt: string,
  references: ReadonlyArray<ComposerContextReference>,
): string;
export function ensureInlineContextReferences(
  prompt: string,
  references: ReadonlyArray<ComposerContextReference>,
) {
  const referenced = new Set(collectInlineContextIds(prompt));
  let result = prompt;
  for (const reference of references) {
    if (referenced.has(reference.contextId)) continue;
    referenced.add(reference.contextId);
    result = appendInlineContextReference(result, reference);
  }
  return result satisfies string;
}
