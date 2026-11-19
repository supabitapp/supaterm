import type { EnvironmentId } from "@supaterm/contracts";

let latestCopy: { environmentId: EnvironmentId; files: ReadonlyMap<string, File> } | null = null;

export function rememberCopiedComposerAttachments(
  environmentId: EnvironmentId,
  files: ReadonlyMap<string, File>,
) {
  latestCopy = files.size > 0 ? { environmentId, files } : null;
}

export function copiedComposerAttachmentFile(environmentId: EnvironmentId, attachmentId: string) {
  return latestCopy?.environmentId === environmentId
    ? latestCopy.files.get(attachmentId)
    : undefined;
}
