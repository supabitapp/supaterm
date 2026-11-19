import type { FileBackedComposerAttachment } from "./composerImages";
import { retainComposerAttachmentFile } from "./composerAttachmentFiles";

/** State owns files but cannot be imported here; it registers cleanup when draft owners load. */
type UnusedAttachmentHandler = (attachment: FileBackedComposerAttachment) => void;

let onAttachmentUnused: UnusedAttachmentHandler | null = null;

export function registerComposerAttachmentUnusedHandler(handler: UnusedAttachmentHandler) {
  onAttachmentUnused = handler;
}

export function retainComposerAttachmentFileForPreview(
  attachment: FileBackedComposerAttachment,
): () => void;
export function retainComposerAttachmentFileForPreview(attachment: FileBackedComposerAttachment) {
  return retainComposerAttachmentFile(attachment.fileUri, () => {
    onAttachmentUnused?.(attachment);
  }) satisfies () => void;
}
