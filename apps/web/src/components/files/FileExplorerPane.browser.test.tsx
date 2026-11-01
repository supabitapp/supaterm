import { useState } from "react";
import { page, userEvent } from "vite-plus/test/browser";
import { describe, expect, it, vi } from "vite-plus/test";

import "~/index.css";

import { render } from "../../../test/render";
import {
  CHANGES_FILE_TREE_SIZING,
  FilePreviewSplit,
  PR_CODE_FILE_TREE_SIZING,
} from "./FileExplorerPane";

const STORAGE_KEY = "supaterm.fileExplorerWidth";
const STORAGE_KEYS = [
  STORAGE_KEY,
  CHANGES_FILE_TREE_SIZING.storageKey,
  PR_CODE_FILE_TREE_SIZING.storageKey,
];

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
  const clear = () => STORAGE_KEYS.forEach((key) => localStorage.removeItem(key));
  clear();
  return { [Symbol.dispose]: clear };
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

  it.each([
    { surface: "Changes", sizing: CHANGES_FILE_TREE_SIZING },
    { surface: "PR Code", sizing: PR_CODE_FILE_TREE_SIZING },
  ])("resizes the $surface file tree under its own saved width", async ({ sizing }) => {
    using _storage = freshStoredWidth();
    await page.viewport(1280, 800);
    await using screen = await render(
      <div style={{ display: "flex", flexDirection: "column", width: 1000, height: 400 }}>
        <FilePreviewSplit
          showContent
          showExplorer
          sizing={sizing}
          content={<p>Diff</p>}
          explorer={<p>Files</p>}
        />
      </div>,
      { router: false /* no routes involved */ },
    );
    await vi.waitFor(() => expect(explorerWidth()).toBeCloseTo(sizing.defaultWidth, 0));

    screen.getByRole("separator", { name: sizing.resizeLabel }).element().focus();
    await userEvent.keyboard("{ArrowLeft}");

    await vi.waitFor(() => expect(explorerWidth()).toBeGreaterThan(sizing.defaultWidth));
    await vi.waitFor(() =>
      expect(Number(localStorage.getItem(sizing.storageKey))).toBeCloseTo(explorerWidth(), 0),
    );
    for (const key of STORAGE_KEYS) {
      if (key !== sizing.storageKey) expect(localStorage.getItem(key)).toBeNull();
    }
  });
});
