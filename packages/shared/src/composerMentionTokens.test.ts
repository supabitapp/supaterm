import { describe, expect, it } from "vite-plus/test";

import { composerFileLinksToPlainText } from "./composerMentionTokens.ts";
import { serializeComposerFileLink } from "./composerTrigger.ts";

describe("composerFileLinksToPlainText", () => {
  it("shows file mentions by name and leaves other links as written", () => {
    const mentions = ["src/foo.ts", ".gitignore", "pkg/__init__.py", "docs/My File (draft).md"]
      .map(serializeComposerFileLink)
      .join(" ");
    expect(composerFileLinksToPlainText(`Review ${mentions}`)).toBe(
      "Review foo.ts .gitignore __init__.py My File (draft).md",
    );
    const links = "See [docs](https://example.com) and [the config](src/config.ts)";
    expect(composerFileLinksToPlainText(links)).toBe(links);
  });
});
