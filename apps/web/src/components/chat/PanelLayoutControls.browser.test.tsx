import { useState } from "react";
import { expect, it } from "vite-plus/test";
import { page, userEvent } from "vite-plus/test/browser";

import { render } from "../../../test/render";
import type { ThreadPanelPresentation } from "../../rightPanelLayout";
import { Popover, PopoverCreateHandle, PopoverPopup, PopoverTitle } from "../ui/popover";
import { TooltipProvider } from "../ui/tooltip";
import { PanelLayoutControls } from "./PanelLayoutControls";

function DetailsControl({ presentation }: { presentation: ThreadPanelPresentation }) {
  const [open, setOpen] = useState(false);
  const [handle] = useState(PopoverCreateHandle);
  return (
    <TooltipProvider delay={0}>
      <PanelLayoutControls
        showTerminalControl={false}
        showRightPanelControl={false}
        terminalAvailable={false}
        terminalOpen={false}
        terminalShortcutLabel={null}
        threadPanelOpen={open}
        threadPanelPresentation={presentation}
        threadPanelPopoverHandle={handle}
        threadPanelShortcutLabel="Ctrl+D"
        threadPanelHasAttention
        rightPanelAvailable={false}
        rightPanelOpen={false}
        rightPanelShortcutLabel={null}
        onToggleTerminal={() => {}}
        onToggleThreadPanel={() => setOpen((previous) => !previous)}
        onToggleRightPanel={() => {}}
      />
      {presentation === "popover" ? (
        <Popover handle={handle} open={open} onOpenChange={setOpen}>
          <PopoverPopup>
            <PopoverTitle>Thread details</PopoverTitle>
            Panel content
          </PopoverPopup>
        </Popover>
      ) : open ? (
        <aside aria-label="Thread details">Panel content</aside>
      ) : null}
    </TooltipProvider>
  );
}

it.each(["inline", "popover"] as const)(
  "%s details show their shortcut on hover and toggle exactly once per click",
  async (presentation) => {
    await using screen = await render(<DetailsControl presentation={presentation} />);
    const toggle = screen.getByRole("button", { name: "Toggle thread details panel" });
    const details = page.getByRole(presentation === "inline" ? "complementary" : "dialog", {
      name: "Thread details",
    });
    await userEvent.hover(toggle);
    await expect.element(page.getByText("Toggle thread details", { exact: true })).toBeVisible();
    await expect.element(page.getByText("Ctrl+D", { exact: true })).toBeVisible();
    await toggle.click();
    await expect.element(details).toBeVisible();
    await expect.element(toggle).toHaveAttribute("aria-pressed", "true");
    await toggle.click();
    await expect.element(details).not.toBeInTheDocument();
    await expect.element(toggle).toHaveAttribute("aria-pressed", "false");
  },
);

it.each(["inline", "popover"] as const)(
  "%s details remain keyboard operable with Enter and Space",
  async (presentation) => {
    await using screen = await render(<DetailsControl presentation={presentation} />);
    const toggle = screen.getByRole("button", { name: "Toggle thread details panel" });
    const details = page.getByRole(presentation === "inline" ? "complementary" : "dialog", {
      name: "Thread details",
    });
    await userEvent.tab();
    await expect.element(toggle).toHaveFocus();
    await userEvent.keyboard("{Enter}");
    await expect.element(details).toBeVisible();
    if (presentation === "popover") {
      await userEvent.keyboard("{Escape}");
      await expect.element(details).not.toBeInTheDocument();
      await expect.element(toggle).toHaveFocus();
      await userEvent.keyboard(" ");
      await expect.element(details).toBeVisible();
      await userEvent.keyboard("{Escape}");
    } else {
      await userEvent.keyboard(" ");
    }
    await expect.element(details).not.toBeInTheDocument();
    await expect.element(toggle).toHaveAttribute("aria-pressed", "false");
  },
);
