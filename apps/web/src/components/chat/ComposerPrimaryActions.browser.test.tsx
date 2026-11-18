import { DEFAULT_RESOLVED_KEYBINDINGS } from "@supaterm/shared/keybindings";
import { type ComponentProps } from "react";
import { act, fakeTimers, render as renderUi, type Screen } from "../../../test/render";
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
  followUpBehavior: "steer",
  canSteer: true,
  canResume: false,
  isEditingQueuedMessage: false,
  isSendBusy: false,
  sendDisabledReason: null,
  isEnvironmentUnavailable: false,
  providerAvailability: "ready",
  isProjectSelectionRequired: false,
  isPreparingWorktree: false,
  hasSendableContent: true,
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

it.each(["resume", "draft"] as const)(
  "keeps repeat Stop clicks from reaching the action that replaces it (%s)",
  async (mode) => {
    const props = {
      ...baseProps,
      isRunning: true,
      canInterrupt: true,
      hasSendableContent: false,
      onInterrupt: vi.fn(),
      onResume: vi.fn(),
      onSubmitMessage: vi.fn((event: { preventDefault: () => void }) => event.preventDefault()),
    } satisfies Props;
    const view = (overrides: Partial<Props> = {}) => (
      <div style={{ display: "flex", justifyContent: "flex-end", width: "400px" }}>
        <ComposerPrimaryActions {...props} {...overrides} />
      </div>
    );
    await using screen = await renderUi(view(), { router: false });
    using _timers = fakeTimers();
    const stop = screen
      .getByRole("button", { name: "Stop generation" })
      .element() as HTMLButtonElement;
    const { x, y, width, height } = stop.getBoundingClientRect();
    const target = () =>
      document.elementFromPoint(x + width / 2, y + height / 2)?.closest("button");
    await act(() => stop.click());
    await act(() =>
      (
        screen.getByRole("button", { name: "Stopping", exact: true }).element() as HTMLButtonElement
      ).click(),
    );
    expect(screen.getByRole("button", { name: "Stopping", exact: true }).element()).toBeDisabled();
    expect(props.onInterrupt).toHaveBeenCalledTimes(1);
    await screen.rerender(
      view({
        isRunning: false,
        canInterrupt: false,
        canResume: true,
        hasSendableContent: mode === "draft",
      }),
    );
    const action = { resume: "Resume thread", draft: "Submit message" }[mode];
    expect(screen.getByRole("button", { name: "Stop generation" }).query()).toBeNull();
    expect(target()).toBe(screen.getByRole("button", { name: action, exact: true }).element());
    await act(() => {
      for (let i = 0; i < 20; i++) target()?.click();
    });
    await act(() => vi.advanceTimersByTime(499));
    await act(() => target()?.click());
    expect(props.onResume).not.toHaveBeenCalled();
    expect(props.onSubmitMessage).not.toHaveBeenCalled();
    await act(() => vi.advanceTimersByTime(1));
    await act(() => target()?.click());
    expect({ resume: props.onResume, draft: props.onSubmitMessage }[mode]).toHaveBeenCalledTimes(1);
    await screen.rerender(view());
    expect(screen.getByRole("button", { name: "Stop generation" }).element()).toBeEnabled();
  },
);
