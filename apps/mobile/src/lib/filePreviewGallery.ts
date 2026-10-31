import type { FilePreviewItem, FilePreviewSource } from "../components/FilePreviewModal.types";

export function filePreviewKey(source: FilePreviewItem): string {
  if ("resource" in source)
    return JSON.stringify([
      source.environmentId,
      Object.entries(source.resource)
        .filter(([key]) => key !== "mimeType" && key !== "fileName")
        .sort(([a], [b]) => a.localeCompare(b)),
    ]);
  if ("attachment" in source) return `attachment:${source.attachment.id}`;
  return source.uri;
}

export function filePreviewGallery(source: FilePreviewSource, group: readonly FilePreviewItem[]) {
  if (source.kind !== "image") return [source];
  const selectedKey = filePreviewKey(source);
  const seen = new Set<string>();
  const items: FilePreviewItem[] = [];
  for (const item of source.gallery ?? group) {
    if (item.kind !== "image") continue;
    const key = filePreviewKey(item);
    if (seen.has(key)) continue;
    seen.add(key);
    items.push(key === selectedKey ? source : item);
  }
  if (!seen.has(selectedKey)) items.unshift(source);
  return items;
}

/**
 * The gallery once every item settled, without the siblings that failed to resolve.
 * Only the selected item failing rejects, and it does so without waiting for the rest.
 */
export async function settlePreviewGallery<Resolved extends object>(
  resolving: readonly Promise<Resolved | null>[],
  selectedIndex: number,
): Promise<{ readonly selected: Resolved; readonly gallery: readonly Resolved[] } | null> {
  const settled = Promise.allSettled(resolving);
  const selected = await resolving[selectedIndex];
  if (!selected) return null;
  const gallery = (await settled).flatMap((item) =>
    item.status === "fulfilled" && item.value !== null ? [item.value] : [],
  );
  return { selected, gallery };
}

export function filePreviewName(source: FilePreviewItem): string {
  const uriName = "uri" in source ? source.uri.split(/[?#]/)[0]?.split("/").pop() : undefined;
  const name =
    source.name ?? ("attachment" in source ? source.attachment.name : uriName) ?? "Preview";
  const extension = /\.(png|jpe?g|gif|webp|heic|heif|avif|svg|pdf|docx?|xlsx?|pptx?|txt|rtf)$/i;
  const filename =
    source.kind !== "image" || extension.test(name)
      ? name
      : uriName && extension.test(uriName)
        ? uriName
        : name.replace(/\./g, "_");
  return Array.from(filename, (character) =>
    character.charCodeAt(0) < 32 || "/:\\".includes(character) ? "_" : character,
  ).join("");
}
