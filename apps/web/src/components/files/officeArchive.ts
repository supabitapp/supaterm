import { OFFICE_PREVIEW_MAX_BYTES, type OfficeWorkerRequest } from "./officePreviewProtocol";
import { readOfficeArchiveEntries, readOfficeParts } from "./office/archiveReader";
import { assembleWordDocument, prepareWordArchive } from "./office/wordArchive";
import { prepareWorkbookArchive } from "./office/workbookArchive";

export async function boundedArchive(input: Extract<OfficeWorkerRequest, { type: "open" }>) {
  const entries = await readOfficeArchiveEntries(input.bytes);
  if (input.kind === "docx") {
    const result = await prepareWordArchive(entries);
    return { ...result, truncatedSheets: [] };
  }
  if (input.kind === "xlsx") {
    const result = await prepareWorkbookArchive(entries, input.bytes.byteLength);
    return { ...result, word: null };
  }
  const archive = await readOfficeParts(entries, {
    expandedBytes: OFFICE_PREVIEW_MAX_BYTES,
    xmlEntryBytes: 8 * 1024 * 1024,
  });
  return { archive, word: null, truncatedSheets: [] };
}

export async function prepareOffice(
  bytes: ArrayBuffer,
  kind: Extract<OfficeWorkerRequest, { type: "open" }>["kind"],
) {
  const result = await boundedArchive({ type: "open", kind, bytes });
  const root =
    kind === "docx"
      ? "word/document.xml"
      : kind === "xlsx"
        ? "xl/workbook.xml"
        : "ppt/presentation.xml";
  if (!result.archive.file(root))
    throw new Error("This is not a valid Office Open XML file. Encrypted files are not supported.");
  if (result.word) await assembleWordDocument(result.archive, result.word);
  return {
    bytes: await result.archive.generateAsync({ type: "arraybuffer", compression: "STORE" }),
    truncated: result.word?.truncated || result.truncatedSheets.some(Boolean) || false,
  };
}
