import { DEFAULT_RESOLVED_KEYBINDINGS } from "@supaterm/shared/keybindings";
import { type ComponentProps } from "react";
import { render as renderUi, type Screen } from "../../../test/render";
import { describe, expect, it, vi } from "vite-plus/test";
import { userEvent } from "vite-plus/test/browser";

import { ComposerPrimaryActions } from "./ComposerPrimaryActions";

type Props = ComponentProps<typeof ComposerPrimaryActions>;

const baseProps = {
  compact: true,
  keybindings: DEFAULT_RESOLVED_KEYBINDINGS,
  canOperateThread: true,
  canQueueMessage: true,
  pendingAction: null,
  isRunning: false,
  canInterrupt: false,
  isSendBusy: false,
  sendDisabledReason: null,
  isConnecting: false,
  isEnvironmentUnavailable: false,
  isPreparingWorktree: false,
  hasSendableContent: true,
  onPreviousPendingQuestion: () => {},
  onInterrupt: () => {},
} satisfies Props;

let screen: Screen;

async function setupTest() {
  await using resources = new AsyncDisposableStack();

  screen = resources.use(await renderUi(null, { router: false }));

  return resources.move();
}

const render = (overrides: Partial<Props> = {}) =>
  screen.rerender(<ComposerPrimaryActions {...baseProps} {...overrides} />);
const button = (label: string) =>
  screen.container.querySelector<HTMLButtonElement>(`button[aria-label="${label}"]`);

describe("ComposerPrimaryActions", () => {
  it("renders a queue action alongside stop while running with a sendable draft", async () => {
    await using _test = await setupTest();
    await render({ isRunning: true, canInterrupt: true, followUpBehavior: "queue" });

    expect(button("Stop generation")).not.toBeNull();
    expect(button("Queue message")?.type).toBe("submit");
  });

  it("keeps stop as the only action while running with an empty composer", async () => {
    await using _test = await setupTest();
    await render({
      isRunning: true,
      canInterrupt: true,
      followUpBehavior: "queue",
      hasSendableContent: false,
    });

    expect(button("Stop generation")).not.toBeNull();
    expect(button("Queue message")).toBeNull();
    expect(screen.container.querySelectorAll("button")).toHaveLength(1);
  });

  async function expectSendTooltip(overrides: Partial<Props>, backgroundLabel: string) {
    await render(overrides);
    await userEvent.hover(button("Submit message")!);
    await vi.waitFor(() => {
      const popup = document.querySelector('[data-slot="tooltip-popup"]')?.textContent;
      expect(popup).toContain(backgroundLabel);
      expect(popup).toContain("New line");
    });
  }

  it("lists the background send for a new thread", async () => {
    await using _test = await setupTest();
    await expectSendTooltip({ isDraftThread: true }, "Send in background");
  });

  it("lists sending into a new thread from an existing thread", async () => {
    await using _test = await setupTest();
    await expectSendTooltip({ sendShortcut: "mod-enter" }, "Send and start new thread");
  });
});
