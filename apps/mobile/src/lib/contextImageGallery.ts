import type { ComposerContextRecord, EnvironmentId } from "@supaterm/contracts";
import { imageMimeType } from "@supaterm/shared/image";
import type { FilePreviewItem } from "../components/ui/FilePreviewModal.types";
import { composerImageGallery } from "./composerImageGallery";
import type { DraftComposerAttachment } from "./composerImages";

export function contextImageGallery(
  records: readonly ComposerContextRecord[],
  attachments: readonly DraftComposerAttachment[],
  environmentId?: EnvironmentId,
) {
  return records.flatMap((record) => {
    if (!("attachmentId" in record) || (record.kind !== "image" && imageMimeType(record) === null))
      return [] satisfies FilePreviewItem[];
    const local = attachments.find((item) => item.id === record.attachmentId);
    if (local) return composerImageGallery([local]) satisfies FilePreviewItem[];
    return (
      environmentId
        ? [
            {
              kind: "image",
              name: record.name,
              environmentId,
              resource: {
                _tag: "attachment",
                attachmentId: record.attachmentId,
                fileName: record.name,
                mimeType: record.mimeType,
              },
            },
          ]
        : []
    ) satisfies FilePreviewItem[];
  }) satisfies FilePreviewItem[];
}
