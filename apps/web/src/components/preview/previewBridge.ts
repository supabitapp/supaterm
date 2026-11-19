import { PreviewCaptureFailure, type PreviewCaptureFailureEncoded } from "@supaterm/contracts";
import * as Option from "effect/Option";
import * as Schema from "effect/Schema";

const decodeCaptureFailure = Schema.decodeUnknownOption(PreviewCaptureFailure);

function unwrapPreviewCaptureResult<A>(result: A | PreviewCaptureFailureEncoded) {
  const failure = decodeCaptureFailure(result);
  if (Option.isSome(failure)) throw failure.value;
  return result as A;
}

const nativePreviewBridge =
  typeof window === "undefined" ? null : (window.desktopBridge?.preview ?? null);

export const previewBridge = nativePreviewBridge
  ? {
      ...nativePreviewBridge,
      captureScreenshot: async (tabId: string) =>
        unwrapPreviewCaptureResult(await nativePreviewBridge.captureScreenshot(tabId)),
      recording: {
        ...nativePreviewBridge.recording,
        startScreencast: async (tabId: string) =>
          unwrapPreviewCaptureResult(await nativePreviewBridge.recording.startScreencast(tabId)),
      },
    }
  : null;
