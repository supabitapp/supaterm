import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vite-plus/test";

import { pressAgain } from "~/test/inlineConfirm";
import type { PromptStashEntry } from "../../promptStashStore";
import { ComposerStashMenu } from "./ComposerStashMenu";

const entry: PromptStashEntry = {
  id: "entry",
  createdAt: new Date(0).toISOString(),
  prompt: "Keep this prompt",
  attachments: [],
  droppedImageNames: [],
};

function renderMenu(props: Partial<Parameters<typeof ComposerStashMenu>[0]> = {}) {
  return act(async () =>
    root.render(
      <ComposerStashMenu
        entries={[entry]}
        stashShortcutLabel={null}
        sendAllBlockedReason={null}
        onRestore={() => {}}
        onDelete={() => {}}
        onSendAll={() => {}}
        onClose={() => {}}
        {...props}
      />,
    ),
  );
}

const escape = () =>
  act(async () => {
    window.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape", cancelable: true }));
  });

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
    await renderMenu({ onDelete, onClose });
    const deleteButton = () =>
      container.querySelector<HTMLButtonElement>(
        'button[aria-label="Delete stashed prompt"], button[aria-label="Confirm delete"]',
      )!;

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

describe("sending all", () => {
  const sendAllButton = () =>
    [...container.querySelectorAll("button")].find((button) =>
      button.textContent?.includes("Send all"),
    )!;

  it("sends on a second press and lets Escape cancel it before closing", async () => {
    const onSendAll = vi.fn();
    const onClose = vi.fn();
    await renderMenu({ onSendAll, onClose });

    await act(async () => sendAllButton().click());
    expect(onSendAll).not.toHaveBeenCalled();
    await escape();
    expect(onClose).not.toHaveBeenCalled();
    await escape();
    expect(onClose).toHaveBeenCalledOnce();

    await act(async () => sendAllButton().click());
    await pressAgain(sendAllButton());
    expect(onSendAll).toHaveBeenCalledOnce();
  });

  it("keeps Enter on a focused Send all from restoring the highlighted prompt", async () => {
    const onRestore = vi.fn();
    await renderMenu({ onRestore });

    const button = sendAllButton();
    button.focus();
    await act(async () => {
      button.dispatchEvent(
        new KeyboardEvent("keydown", { key: "Enter", bubbles: true, cancelable: true }),
      );
    });
    expect(onRestore).not.toHaveBeenCalled();
  });
});
