import {
  GUEST_MESSAGE_MAX_ATTACHMENT_BYTES,
  GUEST_MESSAGE_MAX_ATTACHMENTS,
  isProviderSendTurnSupportedImageMimeType,
} from "@supaterm/contracts";
import { markdownDestinationHostPath } from "@supaterm/shared/markdownLinks";
import { chatMarkdownImageSources } from "@supaterm/shared/markdownPipeline";
import { isAbsolutePath, isNetworkPath } from "@supaterm/shared/path";

export interface GuestUpload {
  readonly name: string;
  readonly contentType: string;
  readonly path: string;
}

export interface InspectedGuestUpload {
  readonly name: string;
  readonly contentType: string;
  readonly sizeBytes: number;
  readonly header: Uint8Array;
}

export type GuestUploadRejection = "too_many_files" | "too_large" | "unsupported_file";

export interface GuestAttachmentDraft {
  readonly type: "image" | "file";
  readonly name: string;
  readonly mimeType: string;
  readonly sizeBytes: number;
}

export const GUEST_UPLOAD_HEADER_BYTES = 12;

const startsWith = (header: Uint8Array, bytes: ReadonlyArray<number>, offset = 0) =>
  bytes.every((byte, index) => header[offset + index] === byte);
const ascii = (text: string) => Array.from(text, (character) => character.charCodeAt(0));

const IMAGE_SIGNATURES: Readonly<Record<string, (header: Uint8Array) => boolean>> = {
  "image/png": (header) => startsWith(header, [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
  "image/jpeg": (header) => startsWith(header, [0xff, 0xd8, 0xff]),
  "image/gif": (header) => startsWith(header, ascii("GIF8")),
  "image/webp": (header) =>
    startsWith(header, ascii("RIFF")) && startsWith(header, ascii("WEBP"), 8),
};

export const matchesImageSignature = (mimeType: string, header: Uint8Array) =>
  IMAGE_SIGNATURES[mimeType]?.(header) === true;

const IMAGE_TYPE_BY_EXTENSION: ReadonlyMap<string, string> = new Map([
  ["png", "image/png"],
  ["jpg", "image/jpeg"],
  ["jpeg", "image/jpeg"],
  ["gif", "image/gif"],
  ["webp", "image/webp"],
]);

export function guestHostImageType(path: string): string | null {
  if (!isAbsolutePath(path) || isNetworkPath(path)) return null;
  return IMAGE_TYPE_BY_EXTENSION.get(path.split(".").at(-1)!.toLowerCase()) ?? null;
}

export function repliesShowImage<Reply extends { readonly text: string }>(
  path: string,
  replies: ReadonlyArray<Reply>,
  imageSources: (reply: Reply) => ReadonlyArray<string> = (reply) =>
    chatMarkdownImageSources(reply.text),
) {
  return replies.some(
    (reply) =>
      (reply.text.includes("![") || /<img/i.test(reply.text)) &&
      imageSources(reply).some((source) => markdownDestinationHostPath(source) === path),
  );
}

const safeName = (name: string, fallback: string) =>
  name
    .replace(/[\p{Cc}\\/\u061C\u200E\u200F\u202A-\u202E\u2066-\u2069]/gu, "_")
    .trim()
    .slice(0, 255) || fallback;

export function classifyGuestUploads(
  uploads: ReadonlyArray<InspectedGuestUpload>,
):
  | { readonly ok: true; readonly attachments: ReadonlyArray<GuestAttachmentDraft> }
  | { readonly ok: false; readonly reason: GuestUploadRejection } {
  if (uploads.length > GUEST_MESSAGE_MAX_ATTACHMENTS)
    return { ok: false, reason: "too_many_files" };
  const total = uploads.reduce((sum, upload) => sum + upload.sizeBytes, 0);
  if (total > GUEST_MESSAGE_MAX_ATTACHMENT_BYTES) return { ok: false, reason: "too_large" };
  const attachments: Array<GuestAttachmentDraft> = [];
  for (const upload of uploads) {
    const mimeType =
      upload.contentType.split(";", 1)[0]!.trim().toLowerCase() || "application/octet-stream";
    if (upload.sizeBytes === 0) return { ok: false, reason: "unsupported_file" };
    if (mimeType.startsWith("image/")) {
      if (
        !isProviderSendTurnSupportedImageMimeType(mimeType) ||
        !matchesImageSignature(mimeType, upload.header)
      ) {
        return { ok: false, reason: "unsupported_file" };
      }
      attachments.push({
        type: "image",
        name: safeName(upload.name, "image"),
        mimeType,
        sizeBytes: upload.sizeBytes,
      });
      continue;
    }
    attachments.push({
      type: "file",
      name: safeName(upload.name, "file"),
      mimeType: mimeType.length <= 100 ? mimeType : "application/octet-stream",
      sizeBytes: upload.sizeBytes,
    });
  }
  return { ok: true, attachments };
}
