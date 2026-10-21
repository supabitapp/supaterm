import { act, render as renderUi, type Screen } from "../../../test/render";
import "~/index.css";

import { describe, expect, it, vi } from "vite-plus/test";

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
    fixtureScreen.rerender(
      <ComposerStashMenu
        composerFormRef={{ current: null }}
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
    container
      .querySelector("button")!
      .dispatchEvent(
        new KeyboardEvent("keydown", { key: "Escape", cancelable: true, bubbles: true }),
      );
  });

let fixtureScreen: Screen;
let container: HTMLDivElement;

describe("deleting", () => {
  it("deletes on a second press and lets Escape cancel the delete before closing", async () => {
    await using _fixture = await setup();

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
    await using _fixture = await setup();

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
    await using _fixture = await setup();

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

  it("keeps the send button in place while confirming", async () => {
    await using _fixture = await setup();

    await renderMenu();
    const before = sendAllButton().getBoundingClientRect();

    await act(async () => sendAllButton().click());

    const after = sendAllButton().getBoundingClientRect();
    expect(after.x).toBe(before.x);
    expect(after.width).toBe(before.width);
  });

  it("blocks sending when a draft appears after arming", async () => {
    await using _fixture = await setup();

    const onSendAll = vi.fn();
    await renderMenu({ onSendAll });
    await act(async () => sendAllButton().click());

    await renderMenu({ onSendAll, sendAllBlockedReason: "Send or stash your draft first" });
    await pressAgain(sendAllButton());
    expect(onSendAll).not.toHaveBeenCalled();

    await renderMenu({ onSendAll });
    await act(async () => sendAllButton().click());
    expect(onSendAll).not.toHaveBeenCalled();
    await pressAgain(sendAllButton());
    expect(onSendAll).toHaveBeenCalledOnce();
  });
});

async function setup() {
  container = document.createElement("div");
  document.body.append(container);
  fixtureScreen = await renderUi(null, { container });

  const ownedScreen = fixtureScreen;
  return {
    async [Symbol.asyncDispose]() {
      await ownedScreen[Symbol.asyncDispose]();

      vi.unstubAllGlobals();
    },
  };
}
