import JSZip from "jszip";
import { describe, expect, it, vi } from "vite-plus/test";
import {
  ARCHIVE_ENTRY_MAX_BYTES,
  ARCHIVE_MAX_BYTES,
  boundedZip,
  openBoundedZip,
} from "./boundedZip.ts";

const archive = (files: ReadonlyArray<readonly [string, string]>) => {
  const zip = new JSZip();
  for (const [name, content] of files) zip.file(name, content);
  return zip.generateAsync({ type: "arraybuffer", compression: "DEFLATE" });
};

describe("boundedZip", () => {
  it("reads nested entries and enforces the expanded entry budget", async () => {
    const bytes = await archive([["folder/readme.txt", "hello"]]);
    const entries = await boundedZip(bytes);
    expect(new TextDecoder().decode(entries.get("folder/readme.txt")?.bytes)).toBe("hello");
    await expect(boundedZip(bytes, 4)).rejects.toThrow("limit");
  });

  it("rejects traversal before a sanitized name hides it", async () => {
    const bytes = await archive([["../outside.txt", "secret"]]);
    await expect(boundedZip(bytes)).rejects.toThrow("path");
  });

  it("does not load an archive after its view was cancelled", async () => {
    const bytes = await archive([["inside.txt", "hello"]]);
    const controller = new AbortController();
    controller.abort();
    await expect(boundedZip(bytes, undefined, { signal: controller.signal })).rejects.toThrow();
  });
});

describe("openBoundedZip", () => {
  it("loads the parser only on the first read and owns its compressed input", async () => {
    const bytes = await archive([["a.txt", "hello"]]);
    const load = vi.spyOn(JSZip, "loadAsync");
    const reader = await openBoundedZip(bytes);
    try {
      expect(load).not.toHaveBeenCalled();
      new Uint8Array(bytes).fill(0);
      expect(new TextDecoder().decode((await reader.read("a.txt")).bytes)).toBe("hello");
      await reader.read("a.txt");
      expect(load).toHaveBeenCalledTimes(1);
    } finally {
      reader.close();
      load.mockRestore();
    }
  });

  it("lists entries without inflating them and reads only the selected file", async () => {
    const bytes = await archive([
      ["good.txt", "hello"],
      ["bad.txt", "broken payload"],
    ]);
    const view = new DataView(bytes);
    for (let offset = 0; offset + 30 < bytes.byteLength; offset++) {
      if (view.getUint32(offset, true) !== 0x04034b50) continue;
      const nameLength = view.getUint16(offset + 26, true);
      const name = new TextDecoder().decode(new Uint8Array(bytes, offset + 30, nameLength));
      if (name !== "bad.txt") continue;
      const start = offset + 30 + nameLength + view.getUint16(offset + 28, true);
      new Uint8Array(bytes, start, view.getUint32(offset + 18, true)).fill(0xff);
      break;
    }
    const reader = await openBoundedZip(bytes);
    try {
      expect(reader.entries.map(({ path, size }) => [path, size])).toEqual([
        ["good.txt", 5],
        ["bad.txt", 14],
      ]);
      expect(new TextDecoder().decode((await reader.read("good.txt")).bytes)).toBe("hello");
      await expect(reader.read("bad.txt")).rejects.toThrow();
    } finally {
      reader.close();
    }
  });

  it("does not charge repeated reads twice against the markup budget", async () => {
    const reader = await openBoundedZip(
      await archive([
        ["a.rels", "<<"],
        ["b.xml", "<<"],
      ]),
      10,
      { markupLimit: 3 },
    );
    try {
      const first = await reader.read("a.rels");
      const second = await reader.read("a.rels");
      expect(first.bytes).toEqual(second.bytes);
      expect(first.bytes).not.toBe(second.bytes);
      await expect(reader.read("b.xml")).rejects.toThrow("limit");
    } finally {
      reader.close();
    }
  });

  it("bounds advertised expansion before loading and selected entries before inflation", async () => {
    const bytes = await archive([
      ["large.txt", "12345"],
      ["small.txt", "ok"],
    ]);
    await expect(openBoundedZip(bytes, 10, { totalLimit: 6 })).rejects.toThrow("limit");
    const reader = await openBoundedZip(bytes, 4);
    try {
      expect(reader.entries.map((entry) => entry.size)).toEqual([5, 2]);
      await expect(reader.read("large.txt")).rejects.toThrow("limit");
      expect(new TextDecoder().decode((await reader.read("small.txt")).bytes)).toBe("ok");
    } finally {
      reader.close();
    }
    await expect(boundedZip(bytes, 4)).rejects.toThrow("limit");
  });

  it("rejects compression bombs, oversized input and invalid budget overrides", async () => {
    await expect(
      openBoundedZip(await archive([["bomb.txt", "x".repeat(1_000_000)]])),
    ).rejects.toThrow("limit");
    await expect(openBoundedZip(new ArrayBuffer(ARCHIVE_MAX_BYTES + 1))).rejects.toThrow("50 MB");
    const bytes = await archive([["a.txt", "hello"]]);
    await expect(openBoundedZip(bytes, Number.NaN)).rejects.toThrow("limits");
    await expect(openBoundedZip(bytes, 10, { totalLimit: Infinity })).rejects.toThrow("limits");
  });

  it("keeps whole-document XML and non-XML markup limits", async () => {
    const bytes = await archive([
      ["word/document.xml", "<doc/>"],
      ["word/links.rels", "<<"],
    ]);
    await expect(boundedZip(bytes, 100, { xmlLimit: 5 })).rejects.toThrow("limit");
    await expect(boundedZip(bytes, 100, { markupLimit: 2 })).rejects.toThrow("limit");
    const files = await boundedZip(bytes, 100, { xmlLimit: 6, markupLimit: 3 });
    expect(new TextDecoder().decode(files.get("word/document.xml")?.bytes)).toBe("<doc/>");
    expect(files.get("word/")?.directory).toBe(true);
  });

  it("cancels a queued read without poisoning the next read and closes idempotently", async () => {
    const controller = new AbortController();
    const reader = await openBoundedZip(
      await archive([
        ["a.txt", "a"],
        ["b.txt", "b"],
      ]),
    );
    const cancelled = reader.read("a.txt", { signal: controller.signal });
    controller.abort(new Error("selection changed"));
    const next = reader.read("b.txt");
    await expect(cancelled).rejects.toThrow("selection changed");
    expect(new TextDecoder().decode((await next).bytes)).toBe("b");
    reader.close();
    reader.close();
    await expect(reader.read("a.txt")).rejects.toThrow("closed");
  });

  it.each(["read", "archive", "close"] as const)(
    "cancels an active inflate through %s",
    async (scope) => {
      type Streamable = JSZip.JSZipObject & {
        internalStream(type: "uint8array"): JSZip.JSZipStreamHelper<Uint8Array<ArrayBuffer>>;
      };
      const prototype = Object.getPrototypeOf(new JSZip().file("x", "x").file("x")) as Streamable;
      const internalStream = prototype.internalStream;
      const controller = new AbortController();
      const stream = vi.spyOn(prototype, "internalStream").mockImplementation(function (
        this: Streamable,
        type,
      ) {
        const result = internalStream.call(this, type);
        if (this.name === "large.txt")
          result.on("data", () => {
            if (scope === "close") reader.close();
            else controller.abort(new Error("left entry"));
          });
        return result;
      });
      const reader = await openBoundedZip(
        await archive([
          ["large.txt", "x".repeat(65_536)],
          ["small.txt", "ok"],
        ]),
        100_000,
        { ratioFloor: 100_000, ...(scope === "archive" ? { signal: controller.signal } : {}) },
      );
      try {
        await expect(
          reader.read("large.txt", scope === "read" ? { signal: controller.signal } : {}),
        ).rejects.toThrow(scope === "close" ? "closed" : "left entry");
        if (scope === "read")
          expect(new TextDecoder().decode((await reader.read("small.txt")).bytes)).toBe("ok");
        else await expect(reader.read("small.txt")).rejects.toThrow();
      } finally {
        reader.close();
        stream.mockRestore();
      }
    },
  );

  it("uses the archive signal to cancel all pending reads", async () => {
    const controller = new AbortController();
    const reader = await openBoundedZip(await archive([["a.txt", "a"]]), 10, {
      signal: controller.signal,
    });
    const one = reader.read("a.txt");
    const two = reader.read("a.txt");
    controller.abort(new Error("archive navigation"));
    await expect(one).rejects.toThrow("archive navigation");
    await expect(two).rejects.toThrow("archive navigation");
    await expect(reader.read("a.txt")).rejects.toThrow("archive navigation");
  });

  it.each(["/absolute.txt", "../outside.txt", "folder/../../outside.txt", "C:\\absolute.txt"])(
    "rejects unsafe directory path %s before reading",
    async (name) => {
      await expect(openBoundedZip(await archive([[name, "x"]]))).rejects.toThrow("path");
    },
  );

  it("rejects colliding names and encrypted metadata", async () => {
    const duplicate = await new JSZip()
      .file("a.txt", "a", { createFolders: false })
      .file("./a.txt", "b", { createFolders: false })
      .generateAsync({ type: "arraybuffer" });
    await expect(openBoundedZip(duplicate)).rejects.toThrow("duplicate");
    const bytes = await archive([["a.txt", "a"]]);
    const view = new DataView(bytes);
    const end = bytes.byteLength - 22;
    const directory = view.getUint32(end + 16, true);
    view.setUint16(directory + 8, 1, true);
    await expect(openBoundedZip(bytes)).rejects.toThrow("Encrypted");
  });

  it("checks actual expansion against forged directory sizes", async () => {
    const bytes = await archive([["a.txt", "hello"]]);
    const view = new DataView(bytes);
    view.setUint32(view.getUint32(bytes.byteLength - 22 + 16, true) + 24, 1, true);
    const reader = await openBoundedZip(bytes);
    try {
      await expect(reader.read("a.txt")).rejects.toThrow();
    } finally {
      reader.close();
    }
  });

  it("keeps Unicode paths and dates aligned with the eager reader", async () => {
    const bytes = await archive([["資料/notes.txt", "hello"]]);
    const reader = await openBoundedZip(bytes);
    try {
      const eager = await boundedZip(bytes);
      expect(reader.entries.map((entry) => entry.path)).toEqual([...eager.keys()]);
      for (const entry of reader.entries)
        expect(await reader.read(entry.path)).toEqual(eager.get(entry.path));
    } finally {
      reader.close();
    }
  });

  it("validates local names and Unicode path extras before opening", async () => {
    const bytes = await archive([["a.txt", "hello"]]);
    new Uint8Array(bytes, 30, 5).set(new TextEncoder().encode("../xx"));
    await expect(openBoundedZip(bytes)).rejects.toThrow("path");
    const encoded = (name: string) => name.replace(/[^a-z.]/g, "x");
    const unicode = await new JSZip()
      .file("資料.txt", "hello")
      .generateAsync({ type: "arraybuffer", encodeFileName: encoded });
    const reader = await openBoundedZip(unicode);
    try {
      expect(new TextDecoder().decode((await reader.read("資料.txt")).bytes)).toBe("hello");
    } finally {
      reader.close();
    }
    const unsafe = await new JSZip()
      .file("../資料.txt", "hidden", { createFolders: false })
      .generateAsync({
        type: "arraybuffer",
        encodeFileName: () => "safe.txt",
      });
    await expect(openBoundedZip(unsafe)).rejects.toThrow("path");
  });

  it("enforces the entry-count boundary even when the declared count is understated", async () => {
    const zip = new JSZip();
    for (let index = 0; index < 2048; index++) zip.file(`entry-${index}`, "");
    const accepted = await openBoundedZip(await zip.generateAsync({ type: "arraybuffer" }));
    expect(accepted.entries).toHaveLength(2048);
    accepted.close();
    zip.file("one-too-many", "");
    const bytes = await zip.generateAsync({ type: "arraybuffer" });
    const view = new DataView(bytes);
    view.setUint16(bytes.byteLength - 22 + 8, 1, true);
    view.setUint16(bytes.byteLength - 22 + 10, 1, true);
    await expect(openBoundedZip(bytes)).rejects.toThrow("more than 2,048 entries");
  });

  it("keeps the 10 MiB selection boundary and the larger eager document limit", async () => {
    const bytes = await new JSZip()
      .file("at-limit.bin", new Uint8Array(ARCHIVE_ENTRY_MAX_BYTES))
      .file("over-limit.bin", new Uint8Array(ARCHIVE_ENTRY_MAX_BYTES + 1))
      .generateAsync({ type: "arraybuffer", compression: "DEFLATE" });
    const limits = { ratioFloor: ARCHIVE_MAX_BYTES };
    const reader = await openBoundedZip(bytes, undefined, limits);
    try {
      expect((await reader.read("at-limit.bin")).bytes.byteLength).toBe(ARCHIVE_ENTRY_MAX_BYTES);
      await expect(reader.read("over-limit.bin")).rejects.toThrow("limit");
    } finally {
      reader.close();
    }
    expect(
      (await boundedZip(bytes, undefined, limits)).get("over-limit.bin")?.bytes.byteLength,
    ).toBe(ARCHIVE_ENTRY_MAX_BYTES + 1);
  });

  it("reads small ZIP64 directories and rejects redirected directory locators", async () => {
    const bytes = new Uint8Array(await archive([["readme.txt", "hello"]]));
    const end = bytes.length - 22;
    const legacy = new DataView(bytes.buffer);
    const extended = new Uint8Array(bytes.length + 76);
    extended.set(bytes.subarray(0, end));
    extended.set(bytes.subarray(end), end + 76);
    const view = new DataView(extended.buffer);
    view.setUint32(end, 0x06064b50, true);
    view.setBigUint64(end + 4, 44n, true);
    view.setBigUint64(end + 24, 1n, true);
    view.setBigUint64(end + 32, 1n, true);
    view.setBigUint64(end + 40, BigInt(legacy.getUint32(end + 12, true)), true);
    view.setBigUint64(end + 48, BigInt(legacy.getUint32(end + 16, true)), true);
    view.setUint32(end + 56, 0x07064b50, true);
    view.setBigUint64(end + 64, BigInt(end), true);
    view.setUint32(end + 72, 1, true);
    view.setUint16(end + 76 + 10, 0xffff, true);
    const reader = await openBoundedZip(extended.buffer);
    try {
      expect(new TextDecoder().decode((await reader.read("readme.txt")).bytes)).toBe("hello");
    } finally {
      reader.close();
    }
    view.setBigUint64(end + 64, BigInt(end - 1), true);
    await expect(openBoundedZip(extended.buffer)).rejects.toThrow("Unsupported ZIP64");
  });
});
