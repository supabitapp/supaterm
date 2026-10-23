import { describe, expect, it } from "vite-plus/test";

import {
  detectComposerTrigger,
  extendReplacementRangeForTrailingSpace,
  replaceTextRange,
  serializeComposerFileLink,
} from "./composerTrigger.ts";

describe("detectComposerTrigger", () => {
  it("detects @path trigger at cursor", () => {
    const text = "Please check @src/com";
    const trigger = detectComposerTrigger(text, text.length);

    expect(trigger).toEqual({
      kind: "path",
      query: "src/com",
      rangeStart: "Please check ".length,
      rangeEnd: text.length,
    });
  });

  it.each(["/mo", "/model", "/pl", "/rev"])("detects %j as a slash command", (text) => {
    expect(detectComposerTrigger(text, text.length)).toEqual({
      kind: "slash-command",
      query: text.slice(1),
      rangeStart: 0,
      rangeEnd: text.length,
    });
  });

  it("does not keep a subcommand trigger active after /model arguments", () => {
    expect(detectComposerTrigger("/model spark", "/model spark".length)).toBeNull();
  });

  it.each([" /rev", "\n\n/rev"])(
    "detects a slash command after leading whitespace in %j",
    (text) => {
      expect(detectComposerTrigger(text, text.length)).toEqual({
        kind: "slash-command",
        query: "rev",
        rangeStart: text.length - 4,
        rangeEnd: text.length,
      });
    },
  );

  it.each(["Use /rev", "/plan then /rev", "Intro\n/rev"])(
    "detects a slash skill trigger after the prompt start in %j",
    (text) => {
      expect(detectComposerTrigger(text, text.length)).toEqual({
        kind: "slash-skill",
        query: "rev",
        rangeStart: text.length - 4,
        rangeEnd: text.length,
      });
    },
  );

  it.each([
    ["Use /", "Use /".length],
    ["and / or", "and /".length],
    ["Read /Users", "Read /".length],
  ])("opens slash skill completion from a bare slash in %j", (text, cursor) => {
    expect(detectComposerTrigger(text, cursor)).toEqual({
      kind: "slash-skill",
      query: "",
      rangeStart: cursor - 1,
      rangeEnd: cursor,
    });
  });

  it.each([
    ["Read /Users/khoi/notes", "Read /Users/khoi/notes".length],
    ["Read /Users/khoi/notes", "Read /Use".length],
    ["Read /Users/khoi/notes", "Read /".length],
    ["and / or", "and / ".length],
  ])("leaves %j alone with the caret at %i", (text, cursor) => {
    expect(detectComposerTrigger(text, cursor)).toBeNull();
  });

  it.each(["$", "€", "𑿝"])("detects %sskill trigger at cursor", (prefix) => {
    const text = `Use ${prefix}gh-fi`;
    const trigger = detectComposerTrigger(text, text.length);

    expect(trigger).toEqual({
      kind: "skill",
      query: "gh-fi",
      rangeStart: "Use ".length,
      rangeEnd: text.length,
    });
  });

  it("detects a pull request number at a token boundary", () => {
    const text = "Compare this with #8737";

    expect(detectComposerTrigger(text, text.length)).toEqual({
      kind: "pull-request",
      query: "8737",
      rangeStart: "Compare this with ".length,
      rangeEnd: text.length,
    });
  });

  it("opens pull request completion from a bare hash", () => {
    const text = "Compare with #";

    expect(detectComposerTrigger(text, text.length)).toEqual({
      kind: "pull-request",
      query: "",
      rangeStart: "Compare with ".length,
      rangeEnd: text.length,
    });
  });

  it("detects a one-word pull request search", () => {
    const text = "Compare with #composer";

    expect(detectComposerTrigger(text, text.length)).toEqual({
      kind: "pull-request",
      query: "composer",
      rangeStart: "Compare with ".length,
      rangeEnd: text.length,
    });
  });

  it("supports hyphenated pull request search terms", () => {
    const text = "Find #inline-context";

    expect(detectComposerTrigger(text, text.length)).toEqual({
      kind: "pull-request",
      query: "inline-context",
      rangeStart: "Find ".length,
      rangeEnd: text.length,
    });
  });

  it("does not keep pull request completion active for headings or embedded hashes", () => {
    expect(detectComposerTrigger("# Heading", "# Heading".length)).toBeNull();
    expect(detectComposerTrigger("issue#123", "issue#123".length)).toBeNull();
  });

  it("detects @path trigger in the middle of existing text", () => {
    const text = "Please inspect @in this sentence";
    const cursorAfterAt = "Please inspect @".length;

    const trigger = detectComposerTrigger(text, cursorAfterAt);
    expect(trigger).toEqual({
      kind: "path",
      query: "",
      rangeStart: "Please inspect ".length,
      rangeEnd: cursorAfterAt,
    });
  });

  it("detects @path trigger with query typed mid-text", () => {
    const text = "Please inspect @srin this sentence";
    const cursorAfterQuery = "Please inspect @sr".length;

    const trigger = detectComposerTrigger(text, cursorAfterQuery);
    expect(trigger).toEqual({
      kind: "path",
      query: "sr",
      rangeStart: "Please inspect ".length,
      rangeEnd: cursorAfterQuery,
    });
  });

  it.each([
    "It costs $5",
    "budget $9.99",
    "only $.99",
    "about €20",
    "raise $10k",
    "$1,000",
    "£2e6",
    "raise $10k.",
    "is it $5?",
    "(about $9.99)",
  ])("does not open the skill menu for the amount in %j", (text) =>
    expect(detectComposerTrigger(text, text.length)).toBeNull(),
  );

  it.each(["$", "$1password", "$2fa"])("still detects the skill prefix %j", (text) => {
    expect(detectComposerTrigger(text, text.length)).toMatchObject({
      kind: "skill",
      query: text.slice(1),
    });
  });
});

describe("replaceTextRange", () => {
  it("replaces a text range and returns new cursor", () => {
    const replaced = replaceTextRange("hello @src", 6, 10, "");
    expect(replaced).toEqual({
      text: "hello ",
      cursor: 6,
    });
  });
});

describe("extendReplacementRangeForTrailingSpace", () => {
  it("swallows one existing space after the range when the replacement ends with one", () => {
    expect(extendReplacementRangeForTrailingSpace("@fi rest", 3, "@file ")).toBe(4);
    expect(extendReplacementRangeForTrailingSpace("@firest", 3, "@file ")).toBe(3);
    expect(extendReplacementRangeForTrailingSpace("@fi rest", 3, "@file")).toBe(3);
    expect(extendReplacementRangeForTrailingSpace("@fi", 3, "@file ")).toBe(3);
  });
});

describe("serializeComposerFileLink", () => {
  it("uses the basename as the markdown label", () => {
    expect(serializeComposerFileLink("path/to/package.json")).toBe(
      "[package.json](path/to/package.json)",
    );
  });

  it("encodes markdown-sensitive destination characters", () => {
    expect(serializeComposerFileLink("docs/My File (draft).md")).toBe(
      "[My File (draft).md](docs/My%20File%20%28draft%29.md)",
    );
  });

  it("supports windows paths", () => {
    expect(serializeComposerFileLink("C:\\repo\\src\\index.ts")).toBe(
      "[index.ts](C:%5Crepo%5Csrc%5Cindex.ts)",
    );
  });

  it("preserves paths that legitimately start with an at sign", () => {
    expect(serializeComposerFileLink("@scope/package.json")).toBe(
      "[package.json](@scope/package.json)",
    );
  });
});
