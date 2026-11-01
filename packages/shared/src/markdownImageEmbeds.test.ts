import { describe, expect, it } from "vite-plus/test";
import { appendMissingImageEmbeds } from "./markdownImageEmbeds.ts";

describe("appendMissingImageEmbeds", () => {
  it.each(["/tmp/dog.png", "</tmp/dog.png>", "file:///tmp/dog.png"])(
    "preserves an existing image with destination %s",
    (destination) => {
      const text = `![Dog](${destination})`;
      expect(appendMissingImageEmbeds(text, ["/tmp/dog.png"])).toBe(text);
    },
  );

  it("recognizes encoded destinations, titles, and reference images", () => {
    for (const text of [
      '![Dog](</tmp/a%20dog.png> "Portrait")',
      '![Dog][portrait]\n\n[portrait]: </tmp/a dog.png> "Portrait"',
    ]) {
      expect(appendMissingImageEmbeds(text, ["/tmp/a dog.png"])).toBe(text);
    }
  });

  it.each([
    "Saved to /tmp/dog.png",
    "[Download](/tmp/dog.png)",
    "`![Dog](/tmp/dog.png)`",
    "````md\n```\n![Dog](/tmp/dog.png)\n````",
    "\\![Dog](/tmp/dog.png)",
    "<!-- ![Dog](/tmp/dog.png) -->",
  ])("adds an image when the reply only contains %s", (text) => {
    expect(appendMissingImageEmbeds(text, ["/tmp/dog.png"])).toBe(`${text}\n\n![](</tmp/dog.png>)`);
  });

  it.each([
    {
      name: "fence",
      text: 'Created.\n\n~~~js\nconsole.log("done");',
      expected: 'Created.\n\n~~~js\nconsole.log("done");\n~~~\n\n![](</tmp/a.png>)',
    },
    {
      name: "HTML comment",
      text: "<!--\n![](</tmp/a.png>)",
      expected: "<!--\n![](</tmp/a.png>)\n-->\n\n![](</tmp/a.png>)",
    },
    {
      name: "raw HTML block",
      text: "<pre>\nlog",
      expected: "<pre>\nlog\n</pre>\n\n![](</tmp/a.png>)",
    },
  ])("closes an unclosed trailing $name before appending", ({ text, expected }) => {
    const result = appendMissingImageEmbeds(text, ["/tmp/a.png"]);
    expect(result).toBe(expected);
    expect(appendMissingImageEmbeds(result, ["/tmp/a.png"])).toBe(result);
  });

  it("appends multiple images once and supports an image-only reply", () => {
    expect(appendMissingImageEmbeds("", ["/tmp/dog.png", "/tmp/cat.png", "/tmp/dog.png"])).toBe(
      "![](</tmp/dog.png>)\n\n![](</tmp/cat.png>)",
    );
  });

  it("normalizes Windows drives and UNC shares without changing POSIX backslashes", () => {
    expect(appendMissingImageEmbeds("", ["C:\\Users\\me\\.codex\\a dog.png"])).toBe(
      "![](<C:/Users/me/.codex/a%20dog.png>)",
    );
    expect(appendMissingImageEmbeds("", ["\\\\host\\share\\a dog.png"])).toBe(
      "![](<file://host/share/a%20dog.png>)",
    );
    expect(appendMissingImageEmbeds("", ["/tmp/a\\dog.png"])).toBe("![](</tmp/a%5Cdog.png>)");
  });

  it("compares Windows image paths across separators, case and file URLs", () => {
    for (const text of [
      "![Dog](<c:/users/me/.codex/dog.png>)",
      "![Dog](<file:///C:/Users/me/.codex/dog.png>)",
      "![Dog](<C:\\Users\\me\\.codex\\dog.png>)",
    ]) {
      expect(appendMissingImageEmbeds(text, ["C:\\Users\\me\\.codex\\dog.png"])).toBe(text);
    }
    const unc = "![Dog](file://host/share/dog.png)";
    expect(appendMissingImageEmbeds(unc, ["\\\\host\\share\\dog.png"])).toBe(unc);
  });

  it("escapes path characters that Markdown or the asset URL would interpret", () => {
    const path = "/tmp/dog <1>#?&%20.png";
    const expected = "![](</tmp/dog%20%3C1%3E%23%3F%26%2520.png>)";
    expect(appendMissingImageEmbeds("", [path])).toBe(expected);
    expect(appendMissingImageEmbeds(expected, [path])).toBe(expected);
  });

  it("leaves replies without generated paths unchanged", () => {
    expect(appendMissingImageEmbeds("Done.\n", [])).toBe("Done.\n");
  });
});
