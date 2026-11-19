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

export function readPastedPlainText(clipboardData: Pick<DataTransfer, "getData">) {
  return clipboardData.getData("text/plain").replace(/\r\n?/g, "\n");
}

export function readPastedComposerContext(clipboardData: Pick<DataTransfer, "getData">) {
  const pastedText = clipboardData.getData("text/plain");
  const decodedFragment =
    decodeComposerContextFragment(clipboardData.getData(COMPOSER_CONTEXT_CLIPBOARD_MIME)) ??
    decodeComposerContextClipboardHtml(clipboardData.getData("text/html"));
  if (decodedFragment === null) return null;
  const pastedIds = new Set<string>(
    collectComposerContextReferences(pastedText).map((occurrence) => occurrence.contextId),
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
  return {
    ...decodedFragment,
    records: decodedFragment.records.filter((record) => pastedIds.has(record.contextId)),
  };
}

export function importPastedComposerText(
  clipboardData: Pick<DataTransfer, "getData">,
  importContextFragment?: (
    fragment: ComposerContextClipboardFragment,
  ) => ReadonlyMap<string, string>,
) {
  const pastedText = readPastedPlainText(clipboardData);
  const fragment = importContextFragment ? readPastedComposerContext(clipboardData) : null;
  const rewrittenIds =
    fragment && fragment.records.length > 0 ? importContextFragment!(fragment) : null;
  const text =
    rewrittenIds && rewrittenIds.size > 0
      ? replaceComposerContextReferences(pastedText, (occurrence) => {
          const nextId = rewrittenIds.get(occurrence.contextId);
          return nextId
            ? formatComposerContextReference({
                ...occurrence,
                contextId: ComposerContextId.make(nextId),
                kind: occurrence.kind === "element" ? "preview-annotation" : occurrence.kind,
              })
            : occurrence.source;
        })
      : pastedText;
  return text;
}
