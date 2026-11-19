import {
  COMPOSER_CONTEXT_CLIPBOARD_MIME,
  encodeComposerContextClipboardHtml,
} from "@supaterm/shared/composerContextClipboard";

import { readMediaPng } from "../media/mediaContent";

export async function copySnapshot(src: string, text: string, fragment: string): Promise<void> {
  if (!navigator.clipboard?.write || typeof ClipboardItem === "undefined") {
    throw new Error("Snapshot copying requires a secure browser connection.");
  }
  const formats = {
    "image/png": readMediaPng(src),
    "text/plain": new Blob([text], { type: "text/plain" }),
    "text/html": new Blob([encodeComposerContextClipboardHtml(text, fragment)], {
      type: "text/html",
    }),
  };
  try {
    await navigator.clipboard.write([
      new ClipboardItem({
        ...formats,
        [COMPOSER_CONTEXT_CLIPBOARD_MIME]: new Blob([fragment], {
          type: COMPOSER_CONTEXT_CLIPBOARD_MIME,
        }),
      }),
    ]);
  } catch {
    await navigator.clipboard.write([new ClipboardItem(formats)]);
  }
}
