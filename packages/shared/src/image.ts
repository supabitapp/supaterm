const IMAGE_MIME_TYPE_BY_EXTENSION = new Map([
  ["gif", "image/gif"],
  ["jpeg", "image/jpeg"],
  ["jpg", "image/jpeg"],
  ["png", "image/png"],
  ["webp", "image/webp"],
]);

const SUPPORTED_IMAGE_MIME_TYPES = new Set(IMAGE_MIME_TYPE_BY_EXTENSION.values());

export const GENERIC_MIME_TYPES = new Set([
  "application/octet-stream",
  "binary/octet-stream",
  "application/unknown",
  "video/mp2t",
  "video/vnd.dlna.mpeg-tts",
]);

export function isSvgAttachment(attachment: { readonly name: string; readonly mimeType: string }) {
  const mimeType = attachment.mimeType.split(";", 1)[0]?.trim().toLowerCase() ?? "";
  return (
    mimeType === "image/svg+xml" ||
    ((mimeType === "" || GENERIC_MIME_TYPES.has(mimeType)) && /\.svg$/i.test(attachment.name))
  );
}

export function imageMimeType(attachment: {
  readonly name: string;
  readonly mimeType: string;
}): string | null;
export function imageMimeType(attachment: { readonly name: string; readonly mimeType: string }) {
  const mimeType = attachment.mimeType.split(";", 1)[0]?.trim().toLowerCase() ?? "";
  if (SUPPORTED_IMAGE_MIME_TYPES.has(mimeType)) return mimeType satisfies string | null;
  if (mimeType.startsWith("image/")) return null satisfies string | null;
  if (mimeType !== "" && !GENERIC_MIME_TYPES.has(mimeType)) return null satisfies string | null;
  const dotIndex = attachment.name.lastIndexOf(".");
  return (
    dotIndex < 0
      ? null
      : (IMAGE_MIME_TYPE_BY_EXTENSION.get(
          attachment.name
            .slice(dotIndex + 1)
            .trim()
            .toLowerCase(),
        ) ?? null)
  ) satisfies string | null;
}
