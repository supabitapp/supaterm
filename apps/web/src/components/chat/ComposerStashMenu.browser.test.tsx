import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vite-plus/test";

import { pressAgain } from "~/test/inlineConfirm";
import { ComposerStashMenu } from "./ComposerStashMenu";

let root: Root;
let container: HTMLDivElement;

beforeEach(() => {
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
  container = document.createElement("div");
  document.body.append(container);
  root = createRoot(container);
});

afterEach(async () => {
  await act(async () => root.unmount());
  container.remove();
  vi.unstubAllGlobals();
});

describe("deleting", () => {
  it("deletes on a second press and lets Escape cancel the delete before closing", async () => {
    const onDelete = vi.fn();
    const onClose = vi.fn();
    await act(async () =>
      root.render(
        <ComposerStashMenu
          entries={[
            {
              id: "entry",
              createdAt: new Date(0).toISOString(),
              prompt: "Keep this prompt",
              attachments: [],
              droppedImageNames: [],
            },
          ]}
          stashShortcutLabel={null}
          onRestore={() => {}}
          onDelete={onDelete}
          onClose={onClose}
        />,
      ),
    );
    const deleteButton = () =>
      container.querySelector<HTMLButtonElement>(
        'button[aria-label="Delete stashed prompt"], button[aria-label="Confirm delete"]',
      )!;
    const escape = () =>
      act(async () => {
        window.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape", cancelable: true }));
      });

    await act(async () => deleteButton().click());
    expect(deleteButton().getAttribute("aria-label")).toBe("Confirm delete");
    await escape();
    expect(onClose).not.toHaveBeenCalled();
    expect(deleteButton().getAttribute("aria-label")).toBe("Delete stashed prompt");
    await escape();
    expect(onClose).toHaveBeenCalledOnce();

    await act(async () => deleteButton().click());
    expect(onDelete).not.toHaveBeenCalled();
    await pressAgain(deleteButton());
    expect(onDelete).toHaveBeenCalledOnce();
  });
});
