import { EnvironmentId, ThreadId } from "@supaterm/contracts";
import { describe, expect, it } from "vite-plus/test";
import {
  createChatCanvasStore,
  resolveChatCanvasModel,
  type ChatCanvasMeasurements,
} from "./canvasStore";

const threadRef = {
  environmentId: EnvironmentId.make("environment-1"),
  threadId: ThreadId.make("thread-1"),
};
const otherThreadRef = { ...threadRef, threadId: ThreadId.make("thread-2") };
const measurements = (width: number, height = 900): ChatCanvasMeasurements => ({
  width,
  height,
  padding: 48,
  maxChatWidth: 768,
  minChatWidth: 640,
  timelineGutter: 0,
  findBar: null,
});

describe("chat canvas model", () => {
  it("shows the details card inline only where the canvas fits it beside the chat", () => {
    const resolve = (width: number) =>
      resolveChatCanvasModel({
        measurements: measurements(width),
        detailsCardMeasurement: null,
        threadRef,
        detailsCardInlineOpen: true,
      }).detailsCardMode;
    expect(resolve(1400)).toBe("inline");
    expect(resolve(900)).toBe("popover");
  });

  it("makes room in the chat lane only for a card measured for the shown thread", () => {
    const chatLeft = (measuredFor: typeof threadRef) =>
      resolveChatCanvasModel({
        measurements: measurements(1100),
        detailsCardMeasurement: { threadRef: measuredFor, width: 264, fullContentHeight: 400 },
        threadRef,
        detailsCardInlineOpen: true,
      }).layout.chat.left;
    expect(chatLeft(threadRef)).toBe(48);
    expect(chatLeft(otherThreadRef)).toBe((1100 - 768) / 2);
  });

  it("keeps state identity when a measurement repeats", () => {
    const store = createChatCanvasStore();
    store.getState().setMeasurements(measurements(1400));
    const before = store.getState();
    store.getState().setMeasurements(measurements(1400));
    store.getState().measureDetailsCard({ threadRef, width: 264, fullContentHeight: 300 });
    const measured = store.getState();
    store.getState().measureDetailsCard({ threadRef, width: 264, fullContentHeight: 300 });
    expect(measured.measurements).toBe(before.measurements);
    expect(store.getState()).toBe(measured);
  });
});
