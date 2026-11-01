import { describe, expect, it } from "vite-plus/test";
import { markdownForNativeRendering } from "./markdownDocument";
import { markdownMermaidMedia } from "./markdownMermaidMedia";

describe("markdownMermaidMedia", () => {
  it("replaces closed diagrams while preserving surrounding Markdown", () => {
    const result = markdownMermaidMedia("Before\n\n```mermaid\ngraph LR\nA --> B\n```\n\nAfter");
    expect(result.markdown).toBe("Before\n\n![Mermaid](<supaterm-mermaid://block/0>)\n\nAfter");
    expect([...result.sources.values()]).toEqual(["graph LR\nA --> B"]);
  });

  it("finds diagrams after an escaped Windows destination", () => {
    const native = markdownForNativeRendering(
      "![shot](C:\\work\\.supaterm\\shot.png)\n\n```mermaid\ngraph LR\nA --> B\n```",
      /$^/,
    );
    const result = markdownMermaidMedia(native);
    expect(result.markdown).toBe(
      "![shot](<C:\\\\work\\\\.supaterm\\\\shot.png>)\n\n![Mermaid](<supaterm-mermaid://block/0>)",
    );
  });

  it.each([
    "> ```mermaid\n> graph LR\n> A --> B\n> ```",
    "- ```mermaid\n  graph LR\n  A --> B\n  ```",
    "~~~mermaid\ngraph LR\nA --> B\n~~~~",
  ])("handles container prefixes and matching fence lengths", (markdown) => {
    const result = markdownMermaidMedia(markdown);
    expect([...result.sources.values()]).toEqual(["graph LR\nA --> B"]);
    expect(result.markdown).toContain("![Mermaid](<supaterm-mermaid://block/0>)");
  });

  it.each([
    "```mermaid\ngraph LR\nA --> B",
    "```mermaid\ngraph LR\nA --> B\n~~~",
    "````text\n```mermaid\ngraph LR\nA --> B\n```\n````",
    "    ```mermaid\n    graph LR\n    ```",
    "Plain `mermaid` text",
  ])("keeps unfinished and literal fences as code", (markdown) => {
    const result = markdownMermaidMedia(markdown);
    expect(result.markdown).toBe(markdown);
    expect(result.sources.size).toBe(0);
  });
});
