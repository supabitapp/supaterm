import JSZip from "jszip";
import { afterEach, describe, expect, it, vi } from "vite-plus/test";

import type { BinaryWorkerRequest, BinaryWorkerResult } from "./binaryPreviewProtocol";

afterEach(() => {
  vi.unstubAllGlobals();
  vi.resetModules();
});

async function worker() {
  let receive: (event: MessageEvent<BinaryWorkerRequest>) => void = () => {};
  const replies: BinaryWorkerResult[] = [];
  const waiting: Array<(result: BinaryWorkerResult) => void> = [];
  vi.stubGlobal("self", {
    addEventListener(_event: string, listener: typeof receive) {
      receive = listener;
    },
    postMessage(result: BinaryWorkerResult) {
      const resolve = waiting.shift();
      const copied = structuredClone(result);
      if (resolve) resolve(copied);
      else replies.push(copied);
    },
  });
  await import("./binaryPreview.worker");
  return {
    send(data: BinaryWorkerRequest) {
      receive({ data } as MessageEvent<BinaryWorkerRequest>);
    },
    next() {
      const reply = replies.shift();
      return reply
        ? Promise.resolve(reply)
        : new Promise<BinaryWorkerResult>((resolve) => waiting.push(resolve));
    },
  };
}

async function zip(path: string, contents: string) {
  return new JSZip()
    .file(path, contents)
    .generateAsync({ type: "arraybuffer", compression: "DEFLATE" });
}

describe("binary preview worker", () => {
  it("continues to list and read gzip contents", async () => {
    const content = "compressed text";
    const compressed = new Blob([content]).stream().pipeThrough(new CompressionStream("gzip"));
    const bytes = await new Response(compressed).arrayBuffer();
    const preview = await worker();
    preview.send({ type: "open", kind: "archive", name: "plain.txt.gz", bytes });
    expect(await preview.next()).toMatchObject({
      type: "archive",
      entries: [{ path: "plain.txt", size: content.length }],
    });
    preview.send({ type: "entry", path: "plain.txt" });
    expect(await preview.next()).toMatchObject({
      type: "entry",
      bytes: new TextEncoder().encode(content),
    });
  });

  it("continues to list and read TAR contents", async () => {
    const content = new TextEncoder().encode("tar text");
    const bytes = new Uint8Array(1536);
    const write = (offset: number, text: string) =>
      bytes.set(new TextEncoder().encode(text), offset);
    write(0, "plain.txt");
    write(124, content.length.toString(8).padStart(11, "0") + "\0");
    bytes.fill(32, 148, 156);
    write(156, "0");
    write(
      148,
      bytes
        .subarray(0, 512)
        .reduce((sum, byte) => sum + byte, 0)
        .toString(8)
        .padStart(6, "0") + "\0 ",
    );
    bytes.set(content, 512);
    const preview = await worker();
    preview.send({ type: "open", kind: "archive", name: "files.tar", bytes: bytes.buffer });
    expect(await preview.next()).toMatchObject({
      type: "archive",
      entries: [{ path: "plain.txt", size: content.length }],
    });
    preview.send({ type: "entry", path: "plain.txt" });
    expect(await preview.next()).toMatchObject({ type: "entry", bytes: content });
  });

  it("lists a ZIP with a damaged unselected member and reads only the selected entry", async () => {
    const bytes = await new JSZip()
      .file("good.txt", "selected text")
      .file("bad.txt", "damaged payload".repeat(20))
      .generateAsync({ type: "arraybuffer", compression: "DEFLATE" });
    const view = new DataView(bytes);
    for (let offset = 0; offset + 30 < bytes.byteLength; offset++) {
      if (view.getUint32(offset, true) !== 0x04034b50) continue;
      const nameLength = view.getUint16(offset + 26, true);
      const name = new TextDecoder().decode(new Uint8Array(bytes, offset + 30, nameLength));
      if (name !== "bad.txt") continue;
      const start = offset + 30 + nameLength + view.getUint16(offset + 28, true);
      new Uint8Array(bytes).fill(255, start, start + view.getUint32(offset + 18, true));
      break;
    }
    const preview = await worker();
    preview.send({ type: "open", kind: "archive", name: "files.zip", bytes });
    expect(await preview.next()).toMatchObject({
      type: "archive",
      entries: [
        { path: "good.txt", size: 13 },
        { path: "bad.txt", size: 300 },
      ],
    });
    preview.send({ type: "entry", path: "good.txt" });
    expect(await preview.next()).toMatchObject({
      type: "entry",
      bytes: new TextEncoder().encode("selected text"),
    });
    preview.send({ type: "entry", path: "bad.txt" });
    expect(await preview.next()).toMatchObject({ type: "error" });
  });

  it("drops an in-flight entry when another archive replaces it", async () => {
    const preview = await worker();
    preview.send({
      type: "open",
      kind: "archive",
      name: "old.zip",
      bytes: await zip("old.txt", "old"),
    });
    expect(await preview.next()).toMatchObject({ type: "archive" });
    const replacement = await zip("new.txt", "new");
    preview.send({ type: "entry", path: "old.txt" });
    preview.send({ type: "open", kind: "archive", name: "new.zip", bytes: replacement });
    expect(await preview.next()).toMatchObject({ type: "archive", entries: [{ path: "new.txt" }] });
    preview.send({ type: "entry", path: "old.txt" });
    expect(await preview.next()).toMatchObject({ type: "error" });
    preview.send({ type: "entry", path: "new.txt" });
    expect(await preview.next()).toMatchObject({
      type: "entry",
      bytes: new TextEncoder().encode("new"),
    });
  });

  it("returns independent bytes and rejects entry reads after disposal", async () => {
    const preview = await worker();
    preview.send({
      type: "open",
      kind: "archive",
      name: "file.zip",
      bytes: await zip("file.txt", "original"),
    });
    expect(await preview.next()).toMatchObject({ type: "archive" });
    preview.send({ type: "entry", path: "file.txt" });
    const first = await preview.next();
    if (first.type !== "entry") throw new Error("Expected an entry");
    first.bytes.fill(0);
    preview.send({ type: "entry", path: "file.txt" });
    expect(await preview.next()).toMatchObject({
      type: "entry",
      bytes: new TextEncoder().encode("original"),
    });
    preview.send({ type: "dispose" });
    preview.send({ type: "entry", path: "file.txt" });
    expect(await preview.next()).toMatchObject({ type: "error" });
  });
});
