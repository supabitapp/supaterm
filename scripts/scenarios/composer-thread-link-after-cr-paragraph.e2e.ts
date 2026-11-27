/// <reference lib="dom" />
import { expect } from "e2e";

import { test, WEB } from "./supaterm.ts";

test(
  "A pasted thread link after a carriage-return blank line becomes a chip",
  WEB,
  async ({ supaterm, app, browser, screen }) => {
    const project = await supaterm.project("demo");
    const linked = await supaterm.thread({
      project,
      title: "Release notes",
      messages: ["Draft the notes"],
    });
    const thread = await supaterm.thread({
      project,
      title: "Follow-up",
      messages: ["Start a follow-up"],
    });
    await supaterm.open(thread);
    const composer = screen.getByRole("textbox");
    await composer.tap();
    await browser.evaluate((threadId: string) => {
      const environmentId = decodeURIComponent(window.location.pathname.split("/")[1]!);
      const href = `supaterm-thread://v2/${environmentId}/${threadId}`;
      const clipboardData = new DataTransfer();
      clipboardData.setData("text/plain", `First paragraph \`\r\r<${href}>\rSecond paragraph \``);
      const editor = document.activeElement;
      if (!editor?.matches('[contenteditable="true"]')) throw new Error("Composer is not focused");
      return editor.dispatchEvent(
        new ClipboardEvent("paste", { clipboardData, bubbles: true, cancelable: true }),
      );
    }, linked.threadId);
    await composer.getByText("First paragraph", { exact: false }).waitFor();
    await app.screenshot("pasted-thread-link");
    await expect(composer.getByText("Release notes", { exact: true })).toBeVisible();
  },
);
