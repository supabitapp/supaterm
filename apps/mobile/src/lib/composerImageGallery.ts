import { imageMimeType } from "@supaterm/shared/image";
import type { EnvironmentId } from "@supaterm/contracts";
import type { FilePreviewItem } from "../components/ui/FilePreviewModal.types";
import { isFileBackedComposerAttachment, type DraftComposerAttachment } from "./composerImages";

export function composerImageGallery(
  attachments: readonly DraftComposerAttachment[],
  environmentId?: EnvironmentId,
) {
  return attachments.flatMap((attachment) => {
    if (attachment.type !== "image" && imageMimeType(attachment) === null)
      return [] satisfies FilePreviewItem[] as FilePreviewItem[];
    if (environmentId !== undefined && attachment.uploadedAttachmentId) {
      return [
        {
          kind: "image",
          name: attachment.name,
          environmentId,
          resource: {
            _tag: "attachment",
            attachmentId: attachment.uploadedAttachmentId,
            fileName: attachment.name,
            mimeType: attachment.mimeType,
          },
        },
      ] satisfies FilePreviewItem[] as FilePreviewItem[];
    }
    if (isFileBackedComposerAttachment(attachment)) {
      return [
        { kind: "image", name: attachment.name, attachment },
      ] satisfies FilePreviewItem[] as FilePreviewItem[];
    }
    return (attachment.type === "image"
      ? [{ kind: "image", name: attachment.name, uri: attachment.dataUrl ?? attachment.previewUri }]
      : []) satisfies FilePreviewItem[] as FilePreviewItem[];
  }) satisfies FilePreviewItem[];
}
