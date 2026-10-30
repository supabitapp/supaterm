import type JSZip from "jszip";
import { checkZipDirectory, zipEntryPath, type ZipDirectoryEntry } from "./zipDirectory.ts";

export const ARCHIVE_MAX_BYTES = 50 * 1024 * 1024;
export const ARCHIVE_ENTRY_MAX_BYTES = 10 * 1024 * 1024;
export const ARCHIVE_MAX_ENTRIES = 2048;
export const ARCHIVE_MAX_RATIO = 200;

export interface BoundedZipLimits {
  readonly totalLimit?: number;
  readonly xmlLimit?: number;
  readonly ratioFloor?: number;
  readonly markupLimit?: number;
  readonly signal?: AbortSignal;
}

export interface BoundedZipFile {
  readonly bytes: Uint8Array<ArrayBuffer>;
  readonly date: Date;
  readonly directory: boolean;
}

export interface BoundedZipArchive {
  readonly entries: ReadonlyArray<ZipDirectoryEntry>;
  readonly read: (
    path: string,
    options?: { readonly signal?: AbortSignal },
  ) => Promise<BoundedZipFile>;
  readonly close: () => void;
}

function cancelled(signal: AbortSignal): unknown {
  return signal.reason ?? new Error("Archive reading was cancelled.");
}

function checkAborted(signal?: AbortSignal): void {
  if (signal?.aborted) throw cancelled(signal);
}

const limitError = () =>
  new Error("The expanded archive exceeds the preview size or compression ratio limit.");

export async function openBoundedZip(
  bytes: ArrayBuffer,
  entryLimit = ARCHIVE_ENTRY_MAX_BYTES,
  limits: BoundedZipLimits = {},
): Promise<BoundedZipArchive> {
  checkAborted(limits.signal);
  if (
    [entryLimit, limits.totalLimit, limits.xmlLimit, limits.ratioFloor, limits.markupLimit].some(
      (value) => value !== undefined && (!Number.isSafeInteger(value) || value < 0),
    )
  )
    throw new Error("Archive limits must be non-negative safe integers.");
  if (bytes.byteLength > ARCHIVE_MAX_BYTES)
    throw new Error("Preview limited to files under 50 MB.");
  const entries = checkZipDirectory(bytes, ARCHIVE_MAX_ENTRIES);
  const totalLimit = Math.min(
    limits.totalLimit ?? ARCHIVE_MAX_BYTES,
    ARCHIVE_MAX_BYTES,
    Math.max(limits.ratioFloor ?? 0, Math.max(1, bytes.byteLength) * ARCHIVE_MAX_RATIO),
  );
  if (entries.reduce((sum, entry) => sum + entry.size, 0) > totalLimit) throw limitError();

  const byPath = new Map(entries.map((entry) => [entry.path, entry]));
  const verified = new Map<string, { size: number; markup: number }>();
  const lifetime = new AbortController();
  let source: ArrayBuffer | undefined = bytes.slice(0);
  let loaded: Promise<Map<string, JSZip.JSZipObject>> | undefined;
  let pending: Promise<void> = Promise.resolve();
  let total = 0;
  let markup = 0;

  const dispose = (reason: unknown) => {
    if (!lifetime.signal.aborted) lifetime.abort(reason);
    limits.signal?.removeEventListener("abort", abortArchive);
    source = undefined;
    loaded = undefined;
    verified.clear();
  };
  const close = () => dispose(new Error("This archive is closed."));
  const abortArchive = () => dispose(cancelled(limits.signal!));
  limits.signal?.addEventListener("abort", abortArchive, { once: true });

  const load = () => {
    checkAborted(lifetime.signal);
    loaded ??= (async () => {
      const { default: Zip } = await import("jszip");
      checkAborted(lifetime.signal);
      const zip = await Zip.loadAsync(source!);
      checkAborted(lifetime.signal);
      const files = new Map(
        Object.values(zip.files).map((entry) => [zipEntryPath(entry.name), entry]),
      );
      if (files.size !== byPath.size || [...byPath.keys()].some((path) => !files.has(path)))
        throw new Error("This ZIP directory is damaged.");
      return files;
    })();
    return loaded;
  };

  const inflate = (entry: ZipDirectoryEntry, file: JSZip.JSZipObject, signal: AbortSignal) => {
    const previous = verified.get(entry.path);
    const baseTotal = total - (previous?.size ?? 0);
    const baseMarkup = markup - (previous?.markup ?? 0);
    return new Promise<BoundedZipFile>((resolve, reject) => {
      const chunks: Uint8Array<ArrayBuffer>[] = [];
      let length = 0;
      let partMarkup = 0;
      let settled = false;
      const stream = (
        file as JSZip.JSZipObject & {
          internalStream(type: "uint8array"): JSZip.JSZipStreamHelper<Uint8Array<ArrayBuffer>>;
        }
      ).internalStream("uint8array");
      const cleanup = () => signal.removeEventListener("abort", abort);
      const fail = (error: unknown) => {
        if (settled) return;
        settled = true;
        stream.pause();
        chunks.length = 0;
        cleanup();
        reject(error);
      };
      const abort = () => fail(cancelled(signal));
      signal.addEventListener("abort", abort, { once: true });
      stream
        .on("data", (chunk) => {
          if (settled) return;
          length += chunk.length;
          if (limits.markupLimit !== undefined)
            for (const byte of chunk) if (byte === 0x3c) partMarkup++;
          if (
            length > entry.size ||
            length > entryLimit ||
            baseTotal + length > totalLimit ||
            baseMarkup + partMarkup > (limits.markupLimit ?? Infinity) ||
            (entry.path.toLowerCase().endsWith(".xml") &&
              length > (limits.xmlLimit ?? 8 * 1024 * 1024))
          ) {
            fail(limitError());
          } else chunks.push(chunk);
        })
        .on("error", fail)
        .on("end", () => {
          if (settled) return;
          if (length !== entry.size) {
            fail(new Error("This ZIP entry has an invalid expanded size."));
            return;
          }
          settled = true;
          cleanup();
          const content = new Uint8Array(length);
          let offset = 0;
          for (const chunk of chunks) {
            content.set(chunk, offset);
            offset += chunk.length;
          }
          chunks.length = 0;
          verified.set(entry.path, { size: length, markup: partMarkup });
          total = baseTotal + length;
          markup = baseMarkup + partMarkup;
          resolve({ bytes: content, date: entry.date, directory: entry.directory });
        });
      if (signal.aborted) abort();
      else stream.resume();
    });
  };

  const read: BoundedZipArchive["read"] = (path, options = {}) => {
    const controller = new AbortController();
    const abortArchive = () => controller.abort(cancelled(lifetime.signal));
    const abortRead = () => controller.abort(cancelled(options.signal!));
    lifetime.signal.addEventListener("abort", abortArchive, { once: true });
    options.signal?.addEventListener("abort", abortRead, { once: true });
    if (lifetime.signal.aborted) abortArchive();
    else if (options.signal?.aborted) abortRead();
    let rejectCancelled: (reason: unknown) => void;
    const cancellation = new Promise<never>((_resolve, reject) => {
      rejectCancelled = reject;
    });
    const abort = () => rejectCancelled(cancelled(controller.signal));
    controller.signal.addEventListener("abort", abort, { once: true });
    if (controller.signal.aborted) abort();
    const task = pending.then(async () => {
      checkAborted(controller.signal);
      const entry = byPath.get(path);
      if (!entry) throw new Error("This file is not in the archive.");
      if (
        entry.size > entryLimit ||
        (entry.path.toLowerCase().endsWith(".xml") &&
          entry.size > (limits.xmlLimit ?? 8 * 1024 * 1024))
      )
        throw limitError();
      const files = await load();
      checkAborted(controller.signal);
      return inflate(entry, files.get(path)!, controller.signal);
    });
    pending = task.then(
      () => {},
      () => {},
    );
    return Promise.race([task, cancellation]).finally(() => {
      lifetime.signal.removeEventListener("abort", abortArchive);
      options.signal?.removeEventListener("abort", abortRead);
      controller.signal.removeEventListener("abort", abort);
    });
  };

  if (limits.signal?.aborted) abortArchive();
  checkAborted(lifetime.signal);
  return { entries, read, close };
}

export async function boundedZip(
  bytes: ArrayBuffer,
  entryLimit = ARCHIVE_MAX_BYTES,
  limits: BoundedZipLimits = {},
) {
  const archive = await openBoundedZip(bytes, entryLimit, limits);
  try {
    const files = new Map<string, BoundedZipFile>();
    for (const entry of archive.entries) files.set(entry.path, await archive.read(entry.path));
    return files;
  } finally {
    archive.close();
  }
}
