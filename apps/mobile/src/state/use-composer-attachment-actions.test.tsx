import { abortComposerDraftOperations } from "./composerDraftOperations";
import { act, useLayoutEffect } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vite-plus/test";

const harness = vi.hoisted(() => ({
  resolvePick: null as
    | ((attachments: ReadonlyArray<{ id: string; fileUri: string }>) => void)
    | null,
  appended: [] as string[],
  removed: [] as string[],
}));

vi.mock("../components/ui/Dialog", () => ({ alert: () => {} }));
vi.mock("../lib/composerImages", () => ({
  pickComposerMedia: () =>
    new Promise((resolve) => {
      harness.resolvePick = (attachments) => resolve({ attachments, error: null });
    }),
  pickComposerFiles: async () => ({ files: [], error: null }),
  convertPastedImagesToAttachments: async () => [],
  createPastedTextComposerAttachment: async () => ({}),
  removePersistedComposerAttachmentFile: async (uri: string) => {
    harness.removed.push(uri);
  },
}));
vi.mock("./use-composer-drafts", () => ({
  captureComposerDraftInsertion: () => ({ text: "", start: 0, end: 0 }),
  countComposerDraftAttachmentsAfterSelection: () => 0,
  getComposerDraftSnapshot: () => ({ attachments: [] }),
  appendComposerDraftAttachments: (key: string) => {
    harness.appended.push(key);
    return 0;
  },
}));

import { useComposerAttachmentActions } from "./use-composer-attachment-actions";

let root: Root | null = null;
let latest: ReturnType<typeof useComposerAttachmentActions> | null = null;

function Probe(props: { readonly draftKey: string | null }) {
  const actions = useComposerAttachmentActions({ draftKey: props.draftKey, serverConfig: null });
  useLayoutEffect(() => {
    latest = actions;
  });
  return null;
}

function render(draftKey: string | null) {
  (globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
  root ??= createRoot(document.createElement("div"));
  act(() => root!.render(<Probe draftKey={draftKey} />));
}

beforeEach(() => {
  harness.resolvePick = null;
  harness.appended = [];
  harness.removed = [];
});

afterEach(() => {
  act(() => root?.unmount());
  root = null;
  latest = null;
});

describe("useComposerAttachmentActions", () => {
  it("appends a picked file to the draft that is still open", async () => {
    render("draft-a");
    const pick = latest!.onPickDraftMedia();
    harness.resolvePick!([{ id: "photo", fileUri: "file:///photo.jpg" }]);
    await act(() => pick);
    expect(harness.appended).toEqual(["draft-a"]);
    expect(harness.removed).toEqual([]);
  });

  it("keeps a pending picker attached to its original draft after navigation", async () => {
    render("draft-a");
    const pick = latest!.onPickDraftMedia();
    render("draft-b");
    harness.resolvePick!([{ id: "photo", fileUri: "file:///photo.jpg" }]);
    await act(() => pick);
    expect(harness.appended).toEqual(["draft-a"]);
    expect(harness.removed).toEqual([]);
  });
  it("discards the file after the owning draft is cleared", async () => {
    render("draft-a");
    const pick = latest!.onPickDraftMedia();
    abortComposerDraftOperations("draft-a");
    harness.resolvePick!([{ id: "photo", fileUri: "file:///photo.jpg" }]);
    await act(() => pick);
    expect(harness.appended).toEqual([]);
    expect(harness.removed).toEqual(["file:///photo.jpg"]);
  });

  it("finishes into the original draft after its composer unmounts", async () => {
    render("draft-a");
    const pick = latest!.onPickDraftMedia();
    act(() => root!.unmount());
    root = null;
    harness.resolvePick!([{ id: "photo", fileUri: "file:///photo.jpg" }]);
    await act(() => pick);
    expect(harness.appended).toEqual(["draft-a"]);
    expect(harness.removed).toEqual([]);
  });
});
