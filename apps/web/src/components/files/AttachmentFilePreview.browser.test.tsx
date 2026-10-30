import { render, stubGlobal } from "../../../test/render";
import { EnvironmentId, ThreadId } from "@supaterm/contracts";
import { describe, expect, it, vi } from "vite-plus/test";

const { refresh } = vi.hoisted(() => ({ refresh: vi.fn<() => Promise<string | null>>() }));

vi.mock(import("~/assets/assetUrls"), async (original) => ({
  ...(await original()),
  useAssetUrlRefresh: () => refresh,
}));
// The real source view highlights through a worker pool; the text it receives is what matters here.
// Never load the original: its highlighter graph can outlast waitFor on a cold CI browser.
vi.mock(import("./ReadOnlySourcePreview"), () => ({
  default: ({ text }: { text: string }) => <pre>{text}</pre>,
}));

import { AttachmentFilePreview } from "./AttachmentFilePreview";

describe("binary workspace file", () => {
  it("offers a download instead of reading a text-named binary as text", async () => {
    refresh.mockReset().mockResolvedValue("data:application/octet-stream,a%00b");
    using _fetch = stubGlobal(
      "fetch",
      vi.fn(async () => new Response(new Uint8Array([0x61, 0x00, 0x62]))),
    );
    await using screen = await render(
      <AttachmentFilePreview
        name="export.csv"
        mimeType="application/octet-stream"
        sizeBytes={0}
        kind="unsupported"
        asset={{
          environmentId: EnvironmentId.make("test-environment"),
          resource: {
            _tag: "media-file",
            threadId: ThreadId.make("thread-1"),
            path: "/repo/export.csv",
            disposition: "attachment",
          },
        }}
        origin="File"
      />,
    );
    const { container } = screen;
    const saveButtons = () =>
      [...container.querySelectorAll("button")].filter(
        (button) =>
          button.textContent === "Save file" || button.getAttribute("aria-label") === "Save file",
      );
    await vi.waitFor(() => expect(saveButtons()).toHaveLength(1));
    expect(saveButtons()[0]?.textContent).toBe("Save file");
    expect(container.textContent).toContain("No preview for this file");
    expect(container.querySelector('[role="alert"]')).toBeNull();
    expect(container.querySelector('button[aria-label="Show table"]')).toBeNull();
    expect(fetch).not.toHaveBeenCalled();
  });
});
