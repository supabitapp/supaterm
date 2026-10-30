import JSZip from "jszip";
import { checkZipDirectory } from "@supaterm/client-runtime/zip/directory";
import { SaxesParser } from "saxes";
import { OFFICE_PREVIEW_MAX_BYTES } from "../officePreviewProtocol";

export type OfficeArchiveEntry = JSZip.JSZipObject;

interface ArchiveReadBudget {
  readonly expandedBytes: number;
  readonly entryBytes?: number;
  readonly xmlEntryBytes?: number;
}

export async function readOfficeArchiveEntries(bytes: ArrayBuffer) {
  if (bytes.byteLength > OFFICE_PREVIEW_MAX_BYTES)
    throw new Error("Preview limited to files under 50 MB.");
  checkZipDirectory(bytes);
  const source = await JSZip.loadAsync(bytes).catch(() => {
    throw new Error("This file is damaged, encrypted, or not a valid Office document.");
  });
  const entries = Object.values(source.files);
  if (entries.length > 2048)
    throw new Error("This file contains too many archive entries to preview.");
  return entries.filter((entry) => !entry.dir);
}

export async function readOfficeEntry(
  entry: OfficeArchiveEntry,
  limits: {
    readonly remainingExpandedBytes: number;
    readonly entryBytes?: number;
    readonly retainedBytes?: number;
    readonly onChunk?: (chunk: Uint8Array, expandedBytes: number) => void;
  },
) {
  const chunks: Uint8Array[] = [];
  let expandedBytes = 0;
  await new Promise<void>((resolve, reject) => {
    const stream = (
      entry as JSZip.JSZipObject & {
        internalStream(type: "uint8array"): JSZip.JSZipStreamHelper<Uint8Array>;
      }
    ).internalStream("uint8array");
    stream
      .on("data", (chunk: Uint8Array) => {
        expandedBytes += chunk.length;
        try {
          if (expandedBytes > limits.remainingExpandedBytes)
            throw new Error("The expanded document is too large to preview safely.");
          limits.onChunk?.(chunk, expandedBytes);
          if (expandedBytes > (limits.entryBytes ?? Infinity))
            throw new Error("The expanded document is too large to preview safely.");
          const keep = Math.max(
            0,
            Math.min(
              chunk.length,
              (limits.retainedBytes ?? Infinity) - (expandedBytes - chunk.length),
            ),
          );
          if (keep) chunks.push(keep === chunk.length ? chunk : chunk.subarray(0, keep));
        } catch (cause) {
          stream.pause();
          reject(cause);
        }
      })
      .on("error", reject)
      .on("end", resolve)
      .resume();
  });
  const bytes = new Uint8Array(Math.min(expandedBytes, limits.retainedBytes ?? Infinity));
  let offset = 0;
  for (const chunk of chunks) {
    bytes.set(chunk, offset);
    offset += chunk.length;
  }
  return { bytes, expandedBytes };
}

export async function readOfficeParts(
  entries: readonly OfficeArchiveEntry[],
  budget: ArchiveReadBudget,
) {
  const archive = new JSZip();
  let expandedBytes = 0;
  for (const entry of entries) {
    const content = await readOfficeEntry(entry, {
      remainingExpandedBytes: budget.expandedBytes - expandedBytes,
      entryBytes: Math.min(
        budget.entryBytes ?? Infinity,
        entry.name.endsWith(".xml") ? (budget.xmlEntryBytes ?? Infinity) : Infinity,
      ),
    });
    expandedBytes += content.expandedBytes;
    archive.file(
      entry.name,
      /\.(?:xml|rels)$/i.test(entry.name) ? officeXml(content.bytes) : content.bytes,
    );
  }
  return archive;
}

export function xmlParser() {
  const parser = new SaxesParser({ xmlns: true });
  parser.on("doctype", () => {
    throw new Error("This document contains unsupported XML declarations.");
  });
  return parser;
}

export function officeXmlDecoder(bytes: Uint8Array) {
  if ((bytes[0] === 0xff && bytes[1] === 0xfe) || (bytes[0] === 0x3c && bytes[1] === 0))
    return new TextDecoder("utf-16le");
  if ((bytes[0] === 0xfe && bytes[1] === 0xff) || (bytes[0] === 0 && bytes[1] === 0x3c))
    return new TextDecoder("utf-16be");
  const declaration = new TextDecoder().decode(bytes.subarray(0, 256));
  return new TextDecoder(/^<\?xml\s[^?]*\bencoding\s*=\s*["']([^"']+)["']/i.exec(declaration)?.[1]);
}

export function officeXml(bytes: Uint8Array) {
  return officeXmlDecoder(bytes)
    .decode(bytes)
    .replace(/^(<\?xml\s[^?]*\bencoding\s*=\s*)["'][^"']+["']/i, '$1"UTF-8"');
}
