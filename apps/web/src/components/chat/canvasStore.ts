import type { ScopedThreadRef } from "@supaterm/contracts";
import { createStore } from "zustand";
import type { ThreadPanelPresentation } from "../../rightPanelLayout";
import type { DetailsCardMeasurement } from "./ChatCanvasContext";
import {
  resolveChatCanvasLayout,
  type ChatCanvasFindBar,
  type ChatCanvasPreview,
} from "./chatCanvasLayout";
import { resolveThreadDetailsCardLayout } from "./threadDetailsCardLayout";

export interface ChatCanvasMeasurements {
  readonly width: number;
  readonly height: number;
  readonly padding: number;
  readonly maxChatWidth: number;
  readonly minChatWidth: number;
  readonly composerHeight: number;
  readonly timelineGutter: number;
  readonly findBar: ChatCanvasFindBar | null;
}

interface ChatCanvasStoreState {
  readonly measurements: ChatCanvasMeasurements;
  readonly detailsCardMeasurement: DetailsCardMeasurement | null;
  readonly setMeasurements: (next: ChatCanvasMeasurements) => void;
  readonly measureDetailsCard: (next: DetailsCardMeasurement) => void;
}

const INITIAL_MEASUREMENTS: ChatCanvasMeasurements = {
  width: 0,
  height: 0,
  padding: 48,
  maxChatWidth: 768,
  minChatWidth: 640,
  composerHeight: 0,
  timelineGutter: 0,
  findBar: null,
};

const sameFindBar = (a: ChatCanvasFindBar | null, b: ChatCanvasFindBar | null) =>
  a === b || (a !== null && b !== null && a.width === b.width && a.bottom === b.bottom);

const sameMeasurements = (a: ChatCanvasMeasurements, b: ChatCanvasMeasurements) =>
  a.width === b.width &&
  a.height === b.height &&
  a.padding === b.padding &&
  a.maxChatWidth === b.maxChatWidth &&
  a.minChatWidth === b.minChatWidth &&
  a.composerHeight === b.composerHeight &&
  a.timelineGutter === b.timelineGutter &&
  sameFindBar(a.findBar, b.findBar);

/**
 * One store per chat view: the canvas measures into it, and the chat view's
 * header controls derive the details card presentation from the same inputs.
 */
export const createChatCanvasStore = () =>
  createStore<ChatCanvasStoreState>()((set) => ({
    measurements: INITIAL_MEASUREMENTS,
    detailsCardMeasurement: null,
    setMeasurements: (next) =>
      set((state) => (sameMeasurements(state.measurements, next) ? state : { measurements: next })),
    measureDetailsCard: (next) =>
      set((state) => {
        const current = state.detailsCardMeasurement;
        return current?.threadRef.environmentId === next.threadRef.environmentId &&
          current.threadRef.threadId === next.threadRef.threadId &&
          current.width === next.width &&
          current.fullContentHeight === next.fullContentHeight
          ? state
          : { detailsCardMeasurement: next };
      }),
  }));

export type ChatCanvasStore = ReturnType<typeof createChatCanvasStore>;

export function resolveChatCanvasModel({
  measurements,
  detailsCardMeasurement,
  threadRef,
  preview,
  detailsCardInlineOpen,
}: {
  measurements: ChatCanvasMeasurements;
  detailsCardMeasurement: DetailsCardMeasurement | null;
  /** The thread whose details card sits on the canvas; other threads' measurements are stale. */
  threadRef: ScopedThreadRef | null;
  preview: ChatCanvasPreview | null;
  detailsCardInlineOpen: boolean;
}) {
  const container = { width: measurements.width, height: measurements.height };
  const { findBar } = measurements;
  const detailsPopoverSideOffset = findBar?.bottom ?? 0;
  const lane = { padding: measurements.padding, minChatWidth: measurements.minChatWidth };
  // The preview avoids where an open inline card would sit, whether or not a
  // preview overlap has pushed the card itself into popover mode.
  const preferredDetailsCard = resolveThreadDetailsCardLayout({
    container,
    lane,
    frame: null,
  });
  // The canvas outlives thread switches, so a measurement only counts for the
  // thread whose card is shown now.
  const detailsCardMeasured =
    threadRef !== null &&
    detailsCardMeasurement !== null &&
    detailsCardMeasurement.threadRef.environmentId === threadRef.environmentId &&
    detailsCardMeasurement.threadRef.threadId === threadRef.threadId
      ? detailsCardMeasurement
      : null;
  const detailsCard =
    detailsCardInlineOpen &&
    preferredDetailsCard &&
    detailsCardMeasured?.width === preferredDetailsCard.width &&
    detailsCardMeasured.fullContentHeight > 0
      ? {
          left: preferredDetailsCard.x,
          right: preferredDetailsCard.x + preferredDetailsCard.width,
          bottom:
            preferredDetailsCard.y +
            Math.min(detailsCardMeasured.fullContentHeight, preferredDetailsCard.height),
        }
      : null;
  const layout = resolveChatCanvasLayout({
    container,
    preview,
    padding: measurements.padding,
    maxChatWidth: measurements.maxChatWidth,
    minChatWidth: measurements.minChatWidth,
    composerHeight: measurements.composerHeight,
    detailsCard,
    findBar,
  });
  const detailsCardPlacement = resolveThreadDetailsCardLayout({
    container,
    lane,
    frame: layout.frame,
    overlapsDetailsCard: layout.overlapsDetailsCard,
  });
  const detailsCardMode: ThreadPanelPresentation = detailsCardPlacement ? "inline" : "popover";
  return {
    container,
    lane,
    layout,
    detailsPopoverSideOffset,
    preferredDetailsCard,
    detailsCardPlacement,
    detailsCardMode,
  };
}
