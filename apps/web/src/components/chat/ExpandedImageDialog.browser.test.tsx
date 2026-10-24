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

const host = (threadKey: string) => (
  <AppAtomRegistryProvider>
    <ExpandedImageDialogHost threadKey={threadKey} />
  </AppAtomRegistryProvider>
);

const dialog = () => document.querySelector('[role="dialog"]');

describe("ExpandedImageDialogHost", () => {
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
});
