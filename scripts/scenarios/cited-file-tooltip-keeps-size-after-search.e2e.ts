import { expect } from "e2e";

import { test, WEB } from "./supaterm.ts";

const FILE = "quarterly-figures.md";

test(
  "The file citation tooltip shows the size even after workspace search finds the file",
  WEB,
  async ({ supaterm, app, browser, screen }) => {
    const project = await supaterm.project("demo", { [FILE]: "x".repeat(2048) });
    const thread = await supaterm.thread({
      project,
      title: "Review figures",
      messages: [`See :codex-file-citation{path="${FILE}" line_range_start="1"}`],
    });
    await supaterm.open(thread);

    await screen.getByRole("textbox").pressSequentially(`@${FILE}`);
    await screen.getByRole("option", FILE, { exact: false }).hover();
    await browser.keyboard.press("Escape");
    await screen.getByRole("button", /^Agent See/).tap();
    await screen.getByRole("link", /^quarterly-figures\.md/).hover();

    try {
      await expect(
        browser.locator('[data-slot="tooltip-viewport"]:has-text("quarterly-figures.md")'),
      ).toContainText("2 KB");
    } finally {
      await app.screenshot("cited-file-tooltip");
    }
  },
);
