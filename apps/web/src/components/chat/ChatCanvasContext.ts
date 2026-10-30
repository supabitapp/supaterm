import { createContext, useContext } from "react";
import type { ChatCanvasPreview, resolveChatCanvasLayout } from "./chatCanvasLayout";
import type { DetailsCardMeasurement, resolveChatCanvasModel } from "./canvasStore";

export const ChatCanvasContext = createContext<{
  container: { width: number; height: number };
  lane: { padding: number; minChatWidth: number };
  layout: ReturnType<typeof resolveChatCanvasLayout>;
  previewKey: string | null;
  reportPreview: (preview: ChatCanvasPreview) => void;
  clearPreview: (key: string) => void;
  registerTimeline: (element: HTMLElement | null) => void;
  measureDetailsCard: (card: DetailsCardMeasurement) => void;
  preferredDetailsCard: ReturnType<typeof resolveChatCanvasModel>["preferredDetailsCard"];
  detailsCardPlacement: ReturnType<typeof resolveChatCanvasModel>["detailsCardPlacement"];
  detailsCardMode: ReturnType<typeof resolveChatCanvasModel>["detailsCardMode"];

  detailsCardTopInset: number;
} | null>(null);

export const useChatCanvas = () => useContext(ChatCanvasContext);
