import JSZip from "jszip";
import { describe, expect, it } from "vite-plus/test";
import { boundedZip } from "./boundedZip.ts";

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
