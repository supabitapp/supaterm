import {
  type EnvironmentId,
  isProviderSendTurnSupportedImageMimeType,
  PROVIDER_SEND_TURN_MAX_FILE_BYTES,
} from "@supaterm/contracts";
import {
  clampFileAttachmentUploadBytes,
  fileAttachmentTooLargeMessage,
} from "@supaterm/client-runtime/state/attachments";

import type { ComposerFileAttachment, ComposerImageAttachment } from "../../composerDraftStore";
import { isHeicImageFile } from "../../lib/imageCompression";
import { isVideoAttachment, videoMimeType } from "../../types";
import { isSvgAttachment } from "@supaterm/shared/image";
import { isWorkspaceImagePreviewPath } from "@supaterm/shared/mediaPreview";

interface FileAttachmentCapabilityState {
  readonly attachmentUploadsCapabilityKnown: boolean;
  readonly supportsAttachmentUploads: boolean;
  readonly maxFileAttachmentBytes: number | null;
}

const IMAGE_MIME_TYPE_BY_EXTENSION: Readonly<Record<string, string>> = {
  gif: "image/gif",
  jpeg: "image/jpeg",
  jpg: "image/jpeg",
  png: "image/png",
  webp: "image/webp",
};

function inferImageMimeTypeFromName(name: string) {
  const dotIndex = name.lastIndexOf(".");
  if (dotIndex <= 0) {
    return null;
  }
  return IMAGE_MIME_TYPE_BY_EXTENSION[name.slice(dotIndex + 1).toLowerCase()] ?? null;
}

function inferImageMimeTypeForUnknownFile(file: Pick<File, "name" | "type">) {
  const mimeType = file.type.toLowerCase();
  if (mimeType !== "" && mimeType !== "application/octet-stream") {
    return null;
  }
  return inferImageMimeTypeFromName(file.name);
}

export function normalizeComposerImageFileMimeType(file: File) {
  const inferredMimeType = inferImageMimeTypeForUnknownFile(file);
  if (!inferredMimeType) {
    return file;
  }
  return new File([file], file.name, {
    type: inferredMimeType,
    lastModified: file.lastModified,
  });
}

function composerImageSignature(
  image: Pick<ComposerImageAttachment, "mimeType" | "sizeBytes" | "name">,
) {
  return `${image.mimeType}\u0000${image.sizeBytes}\u0000${image.name}`;
}

const composerImageFingerprints = new WeakMap<File, string>();
let unreadComposerImageCount = 0;

function composerImageFingerprint(file: File) {
  let fingerprint = composerImageFingerprints.get(file);
  if (fingerprint === undefined) {
    fingerprint = `unread:${unreadComposerImageCount++}`;
    composerImageFingerprints.set(file, fingerprint);
  }
  return fingerprint;
}

/** Records the bytes behind an image file, so a draft drops it only as a byte-for-byte repeat. */
export function rememberComposerImageBytes(file: File, bytes: Uint8Array) {
  let first = 0xdeadbeef;
  let second = 0x41c6ce57;
  for (let index = 0; index < bytes.length; index++) {
    const byte = bytes[index]!;
    first = Math.imul(first ^ byte, 2654435761);
    second = Math.imul(second ^ byte, 1597334677);
  }
  first = Math.imul(first ^ (first >>> 16), 2246822507);
  first ^= Math.imul(second ^ (second >>> 13), 3266489909);
  second = Math.imul(second ^ (second >>> 16), 2246822507);
  second ^= Math.imul(first ^ (first >>> 13), 3266489909);
  composerImageFingerprints.set(file, `${second >>> 0}:${first >>> 0}`);
}

export async function readComposerImageBytes(file: File) {
  const bytes = await file.arrayBuffer().catch(() => null);
  if (bytes) rememberComposerImageBytes(file, new Uint8Array(bytes));
}

/**
 * Matches name, type, size and bytes; unread files match only themselves.
 * Producers must await readComposerImageBytes before publishing images to the draft.
 */
export function composerImageDedupKey(
  image: Pick<ComposerImageAttachment, "mimeType" | "sizeBytes" | "name" | "file">,
) {
  return `${composerImageSignature(image)}\u0000${composerImageFingerprint(image.file)}`;
}

const composerImageSourceKeys = new WeakMap<File, string>();

/** A pasted image's name, type and size: a guess, before its bytes are read, that the draft has it. */
export function composerImageSourceKey(file: File) {
  return (
    composerImageSourceKeys.get(file) ??
    composerImageSignature({
      mimeType: file.type,
      sizeBytes: file.size,
      name: file.name || "image",
    })
  );
}

export function rememberComposerImageSource(source: File, prepared: File) {
  if (prepared !== source) composerImageSourceKeys.set(prepared, composerImageSourceKey(source));
}

function isDngFile(file: Pick<File, "name" | "type">) {
  const mimeType = file.type.split(";", 1)[0]?.trim().toLowerCase();
  return (
    file.name.toLowerCase().endsWith(".dng") ||
    mimeType === "image/dng" ||
    mimeType === "image/x-dng" ||
    mimeType === "image/x-adobe-dng"
  );
}

export function composerFileAttachmentMimeType(file: Pick<File, "name" | "type">) {
  if (isDngFile(file)) return "image/x-adobe-dng";
  if (isSvgAttachment({ name: file.name, mimeType: file.type })) return "image/svg+xml";
  return (
    videoMimeType({ name: file.name, mimeType: file.type }) ??
    (file.type || "application/octet-stream")
  );
}

export function classifyComposerAttachmentFile(file: Pick<File, "name" | "type">) {
  if (isSvgAttachment({ name: file.name, mimeType: file.type })) return "file";
  if (isDngFile(file)) return "file";
  if (isHeicImageFile(file)) {
    return "image";
  }
  if (inferImageMimeTypeForUnknownFile(file)) {
    return "image";
  }
  if (!file.type.toLowerCase().startsWith("image/")) {
    return "file";
  }
  if (isProviderSendTurnSupportedImageMimeType(file.type)) return "image";
  return isWorkspaceImagePreviewPath(file.name) ? "file" : "unsupported-image";
}

export function isPreviewableComposerVideo(
  file: ComposerFileAttachment,
  environmentId: EnvironmentId,
) {
  return (
    isVideoAttachment(file) &&
    (file.file !== null ||
      (file.uploadedAttachmentId !== undefined && file.uploadEnvironmentId === environmentId))
  );
}

export function composerOtherFilesForPresentation(
  files: ReadonlyArray<ComposerFileAttachment>,
  environmentId: EnvironmentId,
  inlineFileIds: ReadonlySet<string>,
) {
  return files.filter(
    (file) => !isPreviewableComposerVideo(file, environmentId) && !inlineFileIds.has(file.id),
  );
}

export function fileAttachmentStagingLimit(input: FileAttachmentCapabilityState) {
  if (!input.attachmentUploadsCapabilityKnown) {
    return PROVIDER_SEND_TURN_MAX_FILE_BYTES;
  }
  if (!input.supportsAttachmentUploads || input.maxFileAttachmentBytes === null) {
    return null;
  }
  return clampFileAttachmentUploadBytes(input.maxFileAttachmentBytes);
}

export function fileAttachmentCapabilityBlockReason(
  input: FileAttachmentCapabilityState & {
    readonly files: ReadonlyArray<{ readonly name: string; readonly sizeBytes: number }>;
  },
) {
  if (input.files.length === 0) {
    return null;
  }
  if (!input.attachmentUploadsCapabilityKnown) {
    return "Waiting for the server before file attachments can send";
  }
  const maxFileAttachmentBytes = fileAttachmentStagingLimit(input);
  if (maxFileAttachmentBytes === null) {
    return "This server does not accept file attachments right now. Remove the files to send.";
  }
  const oversizedFile = input.files.find((file) => file.sizeBytes > maxFileAttachmentBytes);
  if (oversizedFile) {
    return fileAttachmentTooLargeMessage(oversizedFile.name, maxFileAttachmentBytes);
  }
  return null;
}

/** Release only unpersisted uploads; hydrated files still need their server copies. */
export function attachmentsToReleaseOnUploadCapabilityLoss(
  attachments: ReadonlyArray<ComposerImageAttachment | ComposerFileAttachment>,
) {
  return attachments.filter(
    (attachment) => !(attachment.type === "file" && attachment.uploadedAttachmentId !== undefined),
  );
}

export function shouldHandleComposerAttachmentPaste(input: {
  readonly files: ReadonlyArray<File>;
  readonly plainText: string;
}) {
  if (
    input.files.some((file) => {
      if (isDngFile(file)) return true;
      const classification = classifyComposerAttachmentFile(file);
      return (
        classification === "image" ||
        classification === "unsupported-image" ||
        isSvgAttachment({ name: file.name, mimeType: file.type })
      );
    })
  ) {
    return true;
  }

  if (input.plainText.length > 0) {
    return false;
  }

  return input.files.some((file) => classifyComposerAttachmentFile(file) === "file");
}
