import { EnvironmentId, ThreadId } from "@supaterm/contracts";
import { describe, expect, it } from "vite-plus/test";
import { createChatCanvasStore, resolveChatCanvasModel } from "./canvasStore";

const threadRef = { environmentId: EnvironmentId.make("one"), threadId: ThreadId.make("first") };
const nextThreadRef = { ...threadRef, threadId: ThreadId.make("second") };

describe("pane canvas measurements", () => {
  it("retains store identity for repeated measurements", () => {
    const store = createChatCanvasStore();
    const before = store.getState();
    before.setMeasurements({ ...before.measurements });
    expect(store.getState()).toBe(before);
    before.measureDetailsCard({ threadRef, width: 240, fullContentHeight: 400 });
    const measured = store.getState();
    measured.measureDetailsCard({ threadRef, width: 240, fullContentHeight: 400 });
    expect(store.getState()).toBe(measured);
  });

  it("ignores a previous thread's card measurements", () => {
    const store = createChatCanvasStore();
    store.getState().setMeasurements({
      ...store.getState().measurements,
      width: 1440,
      height: 900,
      composerHeight: 180,
    });
    store.getState().measureDetailsCard({ threadRef, width: 240, fullContentHeight: 600 });
    const current = { ...store.getState(), threadRef: nextThreadRef, detailsCardInlineOpen: true };
    expect(resolveChatCanvasModel(current)).toEqual(
      resolveChatCanvasModel({ ...current, detailsCardMeasurement: null }),
    );
  });

  it("keeps pane measurements and preview cleanup independent", () => {
    const left = createChatCanvasStore();
    const right = createChatCanvasStore();
    const preview = {
      key: "current",
      width: 320,
      position: null,
      source: { width: 1600, height: 900 },
    };
    left.getState().reportPreview(preview);
    left.getState().clearPreview("old");
    expect(left.getState().preview).toEqual(preview);
    expect(right.getState().preview).toBeNull();
    left.getState().clearPreview("current");
    expect(left.getState().preview).toBeNull();
  });
});
