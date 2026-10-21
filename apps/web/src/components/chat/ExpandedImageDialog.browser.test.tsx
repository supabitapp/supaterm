import { describe, expect, it, vi } from "vite-plus/test";

import { EnvironmentId, ThreadId, TurnItemId } from "@supaterm/contracts";

import { AppAtomRegistryProvider } from "~/rpc/atomRegistry";
import { act, render as renderUi } from "../../../test/render";
import { ExpandedImageDialogHost, openExpandedImagePreview } from "./ExpandedImageDialog";

const RESOLVED_ASSET_SRC =
  "data:image/gif;base64,R0lGODlhAQABAIAAAAAAAP///yH5BAEAAAAALAAAAAABAAEAAAIBRAA7";

vi.mock(import("../../assets/assetUrls"), async (original) => ({
  ...(await original()),
  useAssetUrlState: (_environmentId, resource) =>
    resource === null
      ? { _tag: "Loading" }
      : { _tag: "Success", url: RESOLVED_ASSET_SRC, expiresAt: Number.POSITIVE_INFINITY },
}));

const preview = {
  images: [
    { src: "data:image/gif;base64,R0lGODlhAQABAAAAACw=", name: "one.png" },
    { src: "data:image/gif;base64,R0lGODlhAQABAAAAACw=", name: "two.png" },
  ],
  index: 0,
};

const host = (threadKey: string) => (
  <AppAtomRegistryProvider>
    <ExpandedImageDialogHost threadKey={threadKey} />
  </AppAtomRegistryProvider>
);

const dialog = () => document.querySelector('[role="dialog"]');

describe("ExpandedImageDialogHost", () => {
  it("opens for its thread, steps with arrows, and closes on Escape with focus back on the opener", async () => {
    const opener = document.createElement("button");
    document.body.append(opener);
    using _opener = { [Symbol.dispose]: () => opener.remove() };
    await using _screen = await renderUi(host("env:a"));
    opener.focus();

    await act(() => openExpandedImagePreview("env:a", preview));
    expect(dialog()?.textContent).toContain("one.png (1/2)");

    await act(() => {
      dialog()?.dispatchEvent(new KeyboardEvent("keydown", { key: "ArrowRight", bubbles: true }));
    });
    expect(dialog()?.textContent).toContain("two.png (2/2)");

    await act(() => {
      window.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape", bubbles: true }));
    });
    await vi.waitFor(() => expect(dialog()).toBeNull());
    expect(document.activeElement).toBe(opener);
  });

  it("loads a gallery image that was never rendered on the page from its asset", async () => {
    await using _screen = await renderUi(host("env:a"));
    const resource = {
      _tag: "tool-output-image" as const,
      threadId: ThreadId.make("thread"),
      itemId: TurnItemId.make("screenshot"),
      index: 0,
    };
    await act(() =>
      openExpandedImagePreview("env:a", {
        images: [
          {
            src: null,
            name: "screenshot",
            actionsSource: {
              kind: "image",
              name: "screenshot",
              src: null,
              asset: { environmentId: EnvironmentId.make("env"), resource },
            },
          },
        ],
        index: 0,
      }),
    );
    expect(dialog()?.querySelector("img")?.getAttribute("src")).toBe(RESOLVED_ASSET_SRC);
  });

  it("ignores another thread's preview and drops its own when the thread changes", async () => {
    await using screen = await renderUi(host("env:a"));
    await act(() => openExpandedImagePreview("env:b", preview));
    expect(dialog()).toBeNull();

    await act(() => openExpandedImagePreview("env:a", preview));
    expect(dialog()).not.toBeNull();

    await screen.rerender(host("env:b"));
    await vi.waitFor(() => expect(dialog()).toBeNull());
  });
});
