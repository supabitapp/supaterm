import type { PreviewAnnotationPayload } from "@supaterm/contracts";

import { dataUrlToFile } from "./imageCompression";

export type PreviewAnnotationCapture =
  | { readonly status: "captured"; readonly file: File }
  | { readonly status: "none" }
  | { readonly status: "failed" };

const PNG_DATA_URL_PREFIX = "data:image/png;base64,";

/** Decode Electron's PNG crop locally; fetching a data URL violates desktop connect-src. */
export function capturePreviewAnnotationScreenshot(annotation: PreviewAnnotationPayload) {
  if (!annotation.screenshot) return { status: "none" } satisfies PreviewAnnotationCapture;
  try {
    const { dataUrl } = annotation.screenshot;
    if (!dataUrl.startsWith(PNG_DATA_URL_PREFIX)) {
      return { status: "failed" } satisfies PreviewAnnotationCapture;
    }
    const file = dataUrlToFile(dataUrl, `preview-annotation-${annotation.id}.png`, "image/png");
    return (
      file.size > 0 ? { status: "captured", file } : { status: "failed" }
    ) satisfies PreviewAnnotationCapture;
  } catch {
    return { status: "failed" } satisfies PreviewAnnotationCapture;
  }
}
