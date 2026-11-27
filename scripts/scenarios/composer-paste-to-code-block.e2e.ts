/// <reference lib="dom" />
import { expect } from "e2e";

import { test, WEB } from "./supaterm.ts";

test(
  "Pasting into an unfocused composer appends literal text inside its last code block",
  WEB,
  async ({ supaterm, app, browser, screen }) => {
    const project = await supaterm.project("demo");
    const thread = await supaterm.thread({
      project,
      title: "Paste into code",
      messages: ["first"],
    });
    await supaterm.open(thread);
    const composer = screen.getByRole("textbox");
    await composer.tap();

    await browser.evaluate(() => {
      const editor = document.activeElement;
      if (!(editor instanceof HTMLElement) || !editor.isContentEditable) {
        throw new Error("The composer is not focused");
      }
      const clipboardData = new DataTransfer();
      clipboardData.setData("text/plain", "```text\nprefix \n```");
      editor.dispatchEvent(
        new ClipboardEvent("paste", { clipboardData, bubbles: true, cancelable: true }),
      );
      editor.blur();
      clipboardData.setData("text/plain", "Setup guide");
      clipboardData.setData("text/html", '<a href="https://example.com/setup">Setup guide</a>');
      document.body.dispatchEvent(
        new ClipboardEvent("paste", { clipboardData, bubbles: true, cancelable: true }),
      );
      return null;
    });

    await app.screenshot("pasted-into-code-block");
    const code = await browser.evaluate(() => {
      return (
        document.querySelector('[data-testid="composer-editor"] pre code')?.textContent ?? null
      );
    });
    expect(code).toBe("prefix Setup guide");
  },
);
