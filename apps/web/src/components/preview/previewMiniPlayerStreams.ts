import type { PreviewStreamViewport } from "@supaterm/client-runtime/preview/server-browser-stream";
import { create } from "zustand";

/** What one floating player's stream reports: its size and the runtime tab whose first frame painted. */
interface PreviewMiniPlayerStream {
  readonly viewport: PreviewStreamViewport | null;
  readonly frameTabId: string | null;
}

type PreviewMiniPlayerStreams = Readonly<Record<string, PreviewMiniPlayerStream>>;

const NOT_REPORTED: PreviewMiniPlayerStream = { viewport: null, frameTabId: null };

export const usePreviewMiniPlayerStreams = create<PreviewMiniPlayerStreams>(() => ({}));

export const selectPreviewMiniPlayerStream = (
  streams: PreviewMiniPlayerStreams,
  key: string | null,
) => (key === null ? null : (streams[key] ?? null));

export const recordStreamViewport = (key: string, viewport: PreviewStreamViewport) =>
  usePreviewMiniPlayerStreams.setState((streams) => {
    const stream = streams[key] ?? NOT_REPORTED;
    return stream.viewport?.width === viewport.width && stream.viewport.height === viewport.height
      ? streams
      : { ...streams, [key]: { ...stream, viewport } };
  }, true);

export const recordStreamFrame = (key: string, frameTabId: string) =>
  usePreviewMiniPlayerStreams.setState((streams) => {
    const stream = streams[key] ?? NOT_REPORTED;
    return stream.frameTabId === frameTabId
      ? streams
      : { ...streams, [key]: { ...stream, frameTabId } };
  }, true);

export const forgetStream = (key: string) =>
  usePreviewMiniPlayerStreams.setState((streams) => {
    if (!(key in streams)) return streams;
    const { [key]: _forgotten, ...rest } = streams;
    return rest;
  }, true);
