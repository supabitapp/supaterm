/// <reference lib="dom" />
// The DOM lib types the function this scenario runs in the page.
import { expect } from "e2e";

import { test, WEB } from "./supaterm.ts";

const MESSAGE = "Type \\*word\\* and \\[label](https://example.com) literally.";
const SHOWN = "Type *word* and [label](https://example.com) literally.";

test(
  "A copied message with literal Markdown characters sends as it was shown",
  WEB,
  async ({ supaterm, app, browser, screen }) => {
    const project = await supaterm.project("demo");
    const thread = await supaterm.thread({ project, title: "Literal", messages: [MESSAGE] });
    await supaterm.open(thread);
    // A message sent through the CLI shows collapsed under its sender.
    await screen.getByRole("button", /^Agent Type/).tap();
    await expect(screen.getByText(SHOWN)).toBeVisible();

    // Select the rendered paragraph as a drag across it would.
    await browser.evaluate(() => {
      const paragraph = document.querySelector("[data-user-message-body] p");
      if (!paragraph) throw new Error("No rendered user message");
      const range = document.createRange();
      range.selectNodeContents(paragraph);
      window.getSelection()?.removeAllRanges();
      window.getSelection()?.addRange(range);
      return null;
    });
    await browser.keyboard.press("ControlOrMeta+C");

    const composer = screen.getByRole("textbox");
    await composer.tap();
    await browser.keyboard.press("ControlOrMeta+V");
    await browser.keyboard.press("Enter");
    await expect(screen.getByText("second fixture turn complete")).toBeVisible();
    await app.screenshot("sent");
    await expect(screen.getByText(SHOWN)).toHaveCount(2);
  },
);
