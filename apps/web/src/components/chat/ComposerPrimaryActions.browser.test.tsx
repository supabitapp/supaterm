import { DEFAULT_RESOLVED_KEYBINDINGS } from "@supaterm/shared/keybindings";
import { act, type ComponentProps } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vite-plus/test";
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

const render = (overrides: Partial<Props> = {}) =>
  act(async () => root.render(<ComposerPrimaryActions {...baseProps} {...overrides} />));
const button = (label: string) =>
  container.querySelector<HTMLButtonElement>(`button[aria-label="${label}"]`);

describe("ComposerPrimaryActions", () => {
  it("renders a queue action alongside stop while running with a sendable draft", async () => {
    await render({ isRunning: true, canInterrupt: true, followUpBehavior: "queue" });

    expect(button("Stop generation")).not.toBeNull();
    expect(button("Queue message")?.type).toBe("submit");
  });

  it("keeps stop as the only action while running with an empty composer", async () => {
    await render({
      isRunning: true,
      canInterrupt: true,
      followUpBehavior: "queue",
      hasSendableContent: false,
    });

    expect(button("Stop generation")).not.toBeNull();
    expect(button("Queue message")).toBeNull();
    expect(container.querySelectorAll("button")).toHaveLength(1);
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
    await expectSendTooltip({ isDraftThread: true }, "Send in background");
  });

  it("lists sending into a new thread from an existing thread", async () => {
    await expectSendTooltip({ sendShortcut: "mod-enter" }, "Send and start new thread");
  });
});
