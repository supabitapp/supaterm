import { expect } from "e2e";

import { test, WEB } from "./supaterm.ts";

test(
  "A Markdown preview uses the first reference destination",
  WEB,
  async ({ supaterm, app, screen }) => {
    const markdown =
      "[Release notes][release]\n\n" +
      "[release]:\n  https://example.com/current\n\n" +
      "Background for this release. ".repeat(180) +
      "\n\n## Appendix\n\n[release]: https://example.com/previous\n";
    const project = await supaterm.project("documentation", { "release.md": markdown });
    const thread = await supaterm.thread({
      project,
      title: "Release",
      messages: ['See :codex-file-citation{path="release.md"}'],
    });
    await supaterm.open(thread);

    await screen.getByRole("button", /^Agent See/).tap();
    await screen.getByRole("link", /^release\.md/).tap();
    await screen.getByRole("button", "Show rendered markdown").tap();
    const link = screen.getByRole("link", "Release notes");
    await link.waitFor();
    await app.screenshot("first-reference");
    await expect(link).toHaveAttribute("href", "https://example.com/current");
  },
);
