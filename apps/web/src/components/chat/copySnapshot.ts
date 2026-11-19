import {
  COMPOSER_CONTEXT_CLIPBOARD_MIME,
  encodeComposerContextClipboardHtml,
} from "@supaterm/shared/composerContextClipboard";

import { readMediaPng } from "../media/mediaContent";

type ClipboardFormats = Record<string, Blob | Promise<Blob>>;

const browserClipboard = () =>
  typeof navigator.clipboard?.write === "function" && typeof ClipboardItem !== "undefined"
    ? {
        write: (formats: ClipboardFormats) =>
          navigator.clipboard.write([new ClipboardItem(formats)]),
      }
    : null;

export async function copySnapshot(
  src: string,
  text: string,
  fragment: string,
  clipboard = browserClipboard(),
): Promise<void> {
  if (!clipboard) {
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
    await clipboard.write({
      ...formats,
      [COMPOSER_CONTEXT_CLIPBOARD_MIME]: new Blob([fragment], {
        type: COMPOSER_CONTEXT_CLIPBOARD_MIME,
      }),
    });
  } catch {
    await clipboard.write(formats);
  }
}
