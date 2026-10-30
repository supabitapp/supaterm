import * as DateTime from "effect/DateTime";

export interface ZipDirectoryEntry {
  readonly path: string;
  readonly size: number;
  readonly compressedSize: number;
  readonly date: Date;
  readonly directory: boolean;
}

const decoder = new TextDecoder();

function crc32(bytes: Uint8Array): number {
  let result = -1;
  for (const byte of bytes) {
    result ^= byte;
    for (let bit = 0; bit < 8; bit++) result = (result >>> 1) ^ (-(result & 1) & 0xedb88320);
  }
  return (result ^ -1) >>> 0;
}

export function zipEntryPath(name: string): string {
  if (/^[\\/]|^[a-z]:/i.test(name) || name.includes("\0") || name.split(/[\\/]/).includes(".."))
    throw new Error("An archive path leaves its directory.");
  if (name.length > 1024) throw new Error("An archive path is too long to preview.");
  const path = name
    .split(/[\\/]/)
    .filter((part) => part !== "" && part !== ".")
    .join("/");
  if (path === "") throw new Error("An archive path is empty.");
  return /[\\/]$/.test(name) ? `${path}/` : path;
}

export function checkZipDirectory(
  bytes: ArrayBuffer,
  entryLimit = 2048,
): ReadonlyArray<ZipDirectoryEntry> {
  const view = new DataView(bytes);
  let directoryEnd = -1;
  let directorySize = 0;
  let zipStart = 0;
  let expectedCount = 0;
  for (
    let offset = bytes.byteLength - 22;
    offset >= Math.max(0, bytes.byteLength - 65557);
    offset--
  ) {
    if (view.getUint32(offset, true) !== 0x06054b50) continue;
    if (offset + 22 + view.getUint16(offset + 20, true) !== bytes.byteLength)
      throw new Error("This is not a readable ZIP archive.");
    let count = view.getUint16(offset + 10, true);
    directorySize = view.getUint32(offset + 12, true);
    let directoryOffset = view.getUint32(offset + 16, true);
    directoryEnd = offset;
    if (
      [4, 6, 8, 10].some((field) => view.getUint16(offset + field, true) === 0xffff) ||
      directorySize === 0xffffffff ||
      directoryOffset === 0xffffffff
    ) {
      const locator = offset - 20;
      const record = locator - 56;

      for (let candidate = bytes.byteLength - 4; candidate > locator; candidate--)
        if (view.getUint32(candidate, true) === 0x07064b50)
          throw new Error("Unsupported ZIP64 directory.");
      if (
        record < 0 ||
        view.getUint32(locator, true) !== 0x07064b50 ||
        view.getUint32(record, true) !== 0x06064b50 ||
        view.getBigUint64(record + 4, true) !== 44n ||
        view.getUint32(record + 16, true) !== 0 ||
        view.getUint32(record + 20, true) !== 0 ||
        view.getUint32(locator + 4, true) !== 0 ||
        view.getUint32(locator + 16, true) !== 1 ||
        view.getBigUint64(locator + 8, true) !== BigInt(record)
      )
        throw new Error("Unsupported ZIP64 directory.");
      const records = view.getBigUint64(record + 32, true);
      const size = view.getBigUint64(record + 40, true);
      const start = view.getBigUint64(record + 48, true);
      if (
        records > BigInt(entryLimit) ||
        size > BigInt(record) ||
        start > BigInt(record) ||
        view.getBigUint64(locator + 8, true) !== start + size ||
        view.getBigUint64(record + 24, true) !== records
      )
        throw new Error("This ZIP64 directory is too large or damaged.");
      count = Number(records);
      directorySize = Number(size);
      directoryOffset = Number(start);
      directoryEnd = record;
    }
    if (count > entryLimit) throw new Error("This archive contains more than 2,048 entries.");
    if (directoryOffset > directoryEnd - directorySize)
      throw new Error("This ZIP directory is damaged.");
    if (
      view.getUint16(offset + 4, true) !== 0 ||
      view.getUint16(offset + 6, true) !== 0 ||
      (view.getUint16(offset + 8, true) !== 0xffff && view.getUint16(offset + 8, true) !== count)
    )
      throw new Error("Multi-volume archives cannot be previewed.");
    zipStart = directoryEnd - directorySize - directoryOffset;
    expectedCount = count;
    break;
  }
  if (directoryEnd < 0 || directorySize > directoryEnd)
    throw new Error("This is not a readable ZIP archive.");
  const records: ZipDirectoryEntry[] = [];
  const paths = new Set<string>();
  for (let offset = directoryEnd - directorySize; offset < directoryEnd;) {
    if (offset + 46 > directoryEnd || view.getUint32(offset, true) !== 0x02014b50)
      throw new Error("This ZIP directory is damaged.");
    if (records.length >= entryLimit)
      throw new Error("This archive contains more than 2,048 entries.");
    const nameLength = view.getUint16(offset + 28, true);
    if ((view.getUint16(offset + 8, true) & 1) !== 0)
      throw new Error("Encrypted archives cannot be previewed.");
    const nameEnd = offset + 46 + nameLength;
    const extraEnd = nameEnd + view.getUint16(offset + 30, true);
    const recordEnd = extraEnd + view.getUint16(offset + 32, true);
    if (recordEnd > directoryEnd) throw new Error("This ZIP directory is damaged.");
    zipEntryPath(decoder.decode(new Uint8Array(bytes, offset + 46, nameLength)));
    if (nameLength > 1024) throw new Error("An archive path is too long to preview.");
    let compressedSize = view.getUint32(offset + 20, true);
    let size = view.getUint32(offset + 24, true);
    let localOffset = view.getUint32(offset + 42, true);
    let unicodePath: Uint8Array | undefined;
    for (let extra = nameEnd; extra < extraEnd;) {
      if (extra + 4 > extraEnd) throw new Error("This ZIP directory is damaged.");
      const type = view.getUint16(extra, true);
      const end = extra + 4 + view.getUint16(extra + 2, true);
      if (end > extraEnd) throw new Error("This ZIP directory is damaged.");
      if (type === 0x0001) {
        let field = extra + 4;
        const readSize = () => {
          if (field + 8 > end) throw new Error("Unsupported ZIP64 directory.");
          const value = view.getBigUint64(field, true);
          field += 8;
          if (value > BigInt(Number.MAX_SAFE_INTEGER))
            throw new Error("Unsupported ZIP64 directory.");
          return Number(value);
        };
        if (size === 0xffffffff) size = readSize();
        if (compressedSize === 0xffffffff) compressedSize = readSize();
        if (localOffset === 0xffffffff) localOffset = readSize();
      } else if (type === 0x7075) unicodePath = new Uint8Array(bytes, extra + 4, end - extra - 4);
      extra = end;
    }
    const local = zipStart + localOffset;
    const directoryStart = directoryEnd - directorySize;
    if (local + 30 > directoryStart || view.getUint32(local, true) !== 0x04034b50)
      throw new Error("This ZIP directory is damaged.");
    if ((view.getUint16(local + 6, true) & 1) !== 0)
      throw new Error("Encrypted archives cannot be previewed.");
    const localNameLength = view.getUint16(local + 26, true);
    const dataStart = local + 30 + localNameLength + view.getUint16(local + 28, true);
    if (dataStart > directoryStart || compressedSize > directoryStart - dataStart)
      throw new Error("This ZIP directory is damaged.");
    const localName = new Uint8Array(bytes, local + 30, localNameLength);
    let name = decoder.decode(localName);
    zipEntryPath(name);
    if (
      (view.getUint16(offset + 8, true) & 0x0800) === 0 &&
      unicodePath &&
      unicodePath.length >= 5 &&
      unicodePath[0] === 1 &&
      new DataView(unicodePath.buffer, unicodePath.byteOffset).getUint32(1, true) ===
        crc32(localName)
    )
      name = decoder.decode(unicodePath.subarray(5));
    const directory = (view.getUint32(offset + 38, true) & 0x10) !== 0 || /[\\/]$/.test(name);
    const path = zipEntryPath(directory && !/[\\/]$/.test(name) ? `${name}/` : name);
    if (paths.has(path)) throw new Error("This archive contains duplicate paths.");
    paths.add(path);
    const date = view.getUint32(offset + 12, true);
    records.push({
      path,
      size,
      compressedSize,
      directory,
      date: DateTime.toDateUtc(
        DateTime.makeUnsafe({
          year: ((date >>> 25) & 0x7f) + 1980,
          month: (date >>> 21) & 0x0f,
          day: (date >>> 16) & 0x1f,
          hours: (date >>> 11) & 0x1f,
          minutes: (date >>> 5) & 0x3f,
          seconds: (date & 0x1f) * 2,
        }),
      ),
    });
    offset = recordEnd;
  }
  if (records.length !== expectedCount) throw new Error("This ZIP directory is damaged.");
  return records;
}
