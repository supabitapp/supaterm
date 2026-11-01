import { useState } from "react";
import { page, userEvent } from "vite-plus/test/browser";
import { describe, expect, it, vi } from "vite-plus/test";

import "~/index.css";

import { render } from "../../../test/render";
import { FilePreviewSplit } from "./FileExplorerPane";

const STORAGE_KEY = "supaterm.fileExplorerWidth";

function Explorer() {
  const [clicks, setClicks] = useState(0);
  return (
    <button type="button" onClick={() => setClicks((value) => value + 1)}>
      Explorer clicks {clicks}
    </button>
  );
}

function Harness() {
  const [showContent, setShowContent] = useState(false);
  return (
    <div style={{ display: "flex", flexDirection: "column", width: 1000, height: 400 }}>
      <button type="button" onClick={() => setShowContent((value) => !value)}>
        Toggle file
      </button>
      <FilePreviewSplit
        showContent={showContent}
        showExplorer
        content={<p>File contents</p>}
        explorer={<Explorer />}
      />
    </div>
  );
}

function freshStoredWidth(): Disposable {
  localStorage.removeItem(STORAGE_KEY);
  return { [Symbol.dispose]: () => localStorage.removeItem(STORAGE_KEY) };
}

const explorerWidth = () =>
  document.querySelector<HTMLElement>("[data-file-explorer]")!.getBoundingClientRect().width;

describe("FilePreviewSplit", () => {
  it("fills the row with the explorer until a file opens, then keeps the explorer state", async () => {
    using _storage = freshStoredWidth();
    await page.viewport(1280, 800);
    await using screen = await render(<Harness />, { router: false /* no routes involved */ });

    await vi.waitFor(() => expect(explorerWidth()).toBeCloseTo(1000, 0));
    await userEvent.click(screen.getByRole("button", { name: "Explorer clicks 0" }));

    await userEvent.click(screen.getByRole("button", { name: "Toggle file" }));
    await vi.waitFor(() => expect(explorerWidth()).toBeCloseTo(256, 0));
    await expect.element(screen.getByRole("button", { name: "Explorer clicks 1" })).toBeVisible();

    await userEvent.click(screen.getByRole("button", { name: "Toggle file" }));
    await vi.waitFor(() => expect(explorerWidth()).toBeCloseTo(1000, 0));
  });

  it("resizes from the keyboard and remembers the width", async () => {
    using _storage = freshStoredWidth();
    await page.viewport(1280, 800);
    await using screen = await render(<Harness />, { router: false /* no routes involved */ });
    await userEvent.click(screen.getByRole("button", { name: "Toggle file" }));
    await vi.waitFor(() => expect(explorerWidth()).toBeCloseTo(256, 0));

    screen.getByRole("separator", { name: "Resize file explorer" }).element().focus();
    await userEvent.keyboard("{ArrowLeft}");

    await vi.waitFor(() => expect(explorerWidth()).toBeGreaterThan(256));
    await vi.waitFor(() =>
      expect(Number(localStorage.getItem(STORAGE_KEY))).toBeCloseTo(explorerWidth(), 0),
    );
  });
});
