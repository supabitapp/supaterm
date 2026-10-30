import { describe, expect, it } from "vite-plus/test";
import {
  buildZipTree,
  flattenZipTree,
  zipEntryAttachmentName,
  type ZipEntry,
  type ZipTreeNode,
} from "./zipTree";

function entry(path: string): ZipEntry {
  return {
    path,
    name: path.split("/").at(-1)!,
    isDirectory: false,
    sizeBytes: 1,
    mimeType: "text/plain",
    bytes: new Uint8Array([1]),
  };
}

describe("ZIP tree", () => {
  it("collapses long directory chains and keeps searchable file paths", () => {
    const path = `${Array.from({ length: 5_000 }, (_, index) => `d${index}`).join("/")}/match.txt`;
    const nodes = buildZipTree([entry(path)]);
    expect(nodes).toHaveLength(1);
    expect(nodes[0]?.fileCount).toBe(1);
    expect(flattenZipTree(nodes, new Set(), "match.txt").at(-1)?.node.entry?.path).toBe(path);
  });

  it("flattens deep trees without recursive calls or unrelated search rows", () => {
    let node: ZipTreeNode = {
      path: "match.txt",
      label: "match.txt",
      entry: entry("match.txt"),
      children: [],
      fileCount: 1,
    };
    for (let depth = 0; depth < 20_000; depth++) {
      node = {
        path: String(depth),
        label: String(depth),
        entry: null,
        children: [node],
        fileCount: 1,
      };
    }
    const rows = flattenZipTree([node], new Set(), "match.txt");
    expect(rows).toHaveLength(20_001);
    expect(rows.at(-1)?.depth).toBe(20_000);
    expect(flattenZipTree([node], new Set(), "missing.txt")).toEqual([]);
  });

  it("retains sorted siblings and expands only matching search paths", () => {
    const nodes = buildZipTree([entry("b/other.txt"), entry("a/match.txt"), entry("a/other.txt")]);
    const paths = (query: string, collapsed = new Set<string>()) =>
      flattenZipTree(nodes, collapsed, query).map(({ node }) => node.path);
    expect(paths("match")).toEqual(["a", "a/match.txt"]);
    expect(paths("", new Set(["a"]))).toEqual(["a", "b", "b/other.txt"]);
  });
});

describe("ZIP entry attachment names", () => {
  it("keeps short names and retains extensions when shortening UTF-8 names", () => {
    expect(zipEntryAttachmentName("readme.txt")).toBe("readme.txt");
    const name = zipEntryAttachmentName(`${"🙂".repeat(100)}.txt`);
    expect(name.endsWith(".txt")).toBe(true);
    expect(
      new TextEncoder().encode(`00000000-0000-0000-0000-000000000000-${name}`).length,
    ).toBeLessThanOrEqual(255);
    expect(name).not.toContain("�");
  });
});
