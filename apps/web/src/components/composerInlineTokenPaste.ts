import { ComposerContextId } from "@supaterm/contracts";
import type { ComposerContextClipboardFragment } from "@supaterm/contracts";
import {
  COMPOSER_CONTEXT_CLIPBOARD_MIME,
  decodeComposerContextFragment,
  decodeComposerContextClipboardHtml,
} from "@supaterm/shared/composerContextClipboard";
import {
  collectComposerContextReferences,
  formatComposerContextReference,
  replaceComposerContextReferences,
} from "@supaterm/shared/composerContextReferences";

import { restorePastedMarkdownLinks } from "~/markdown-clipboard";

// Matches ProseMirror's default clipboard parser, which a custom handlePaste bypasses.
export function readPastedPlainText(clipboardData: Pick<DataTransfer, "getData">): string {
  return clipboardData.getData("text/plain").replace(/\r\n?/g, "\n");
}

export function readPastedComposerClipboard(
  clipboardData: Pick<DataTransfer, "getData">,
  plainTextOnly = false,
) {
  const plain = readPastedPlainText(clipboardData);
  if (plainTextOnly || !plain) return { text: plain, context: null };
  const html = clipboardData.getData("text/html");
  const text = restorePastedMarkdownLinks(plain, html);
  const decodedFragment =
    decodeComposerContextFragment(clipboardData.getData(COMPOSER_CONTEXT_CLIPBOARD_MIME)) ??
    decodeComposerContextClipboardHtml(html);
  if (decodedFragment === null) return { text, context: null };
  const pastedIds = new Set<string>(
    collectComposerContextReferences(text).map((occurrence) => occurrence.contextId),
  );
  for (const record of decodedFragment.records) {
    if (
      record.kind === "preview-annotation" &&
      !("payload" in record) &&
      pastedIds.has(record.contextId) &&
      record.screenshotContextId
    ) {
      pastedIds.add(record.screenshotContextId);
    }
  }
  const context: ComposerContextClipboardFragment = {
    ...decodedFragment,
    records: decodedFragment.records.filter((record) => pastedIds.has(record.contextId)),
  };
  return { text, context };
}

export type PastedComposerClipboard = ReturnType<typeof readPastedComposerClipboard>;

export function importPastedComposerText(
  { text: pastedText, context: fragment }: PastedComposerClipboard,
  importContextFragment?: (
    fragment: ComposerContextClipboardFragment,
  ) => ReadonlyMap<string, string>,
): string {
  const rewrittenIds =
    fragment && fragment.records.length > 0 ? importContextFragment?.(fragment) : null;
  if (!rewrittenIds || rewrittenIds.size === 0) return pastedText;
  return replaceComposerContextReferences(pastedText, (occurrence) => {
    const nextId = rewrittenIds.get(occurrence.contextId);
    return nextId
      ? formatComposerContextReference({
          ...occurrence,
          contextId: ComposerContextId.make(nextId),
          kind: occurrence.kind === "element" ? "preview-annotation" : occurrence.kind,
        })
      : occurrence.source;
  });
}
