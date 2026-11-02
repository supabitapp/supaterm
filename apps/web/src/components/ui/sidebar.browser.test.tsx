import { page, userEvent } from "vite-plus/test/browser";
import { describe, expect, it, vi } from "vite-plus/test";

import { render } from "../../../test/render";
import { Sidebar, SidebarProvider, SidebarTrigger, useSidebar } from "./sidebar";

// Listens natively, like the shortcut dispatcher, so the collapse runs outside React's event batching.
function CollapseFromInside() {
  const { setOpen } = useSidebar();
  const listen = (button: HTMLButtonElement) => {
    const collapse = () => setOpen(false);
    button.addEventListener("click", collapse);
    return () => button.removeEventListener("click", collapse);
  };
  return (
    <button type="button" ref={listen}>
      Collapse
    </button>
  );
}

function CollapsedOnlyTrigger() {
  const { open } = useSidebar();
  return (
    <div style={open ? { display: "none" } : undefined}>
      <SidebarTrigger aria-label="Show sidebar" />
    </div>
  );
}

function Harness() {
  return (
    <SidebarProvider defaultOpen>
      <Sidebar>
        <SidebarTrigger aria-label="Hide sidebar" />
        <CollapseFromInside />
      </Sidebar>
      <CollapsedOnlyTrigger />
    </SidebarProvider>
  );
}

describe("Sidebar", () => {
  it("hands focus to the outside trigger when it collapses around the focused control", async () => {
    await page.viewport(1280, 800);
    await using screen = await render(<Harness />, { router: false /* no routes involved */ });

    await userEvent.click(screen.getByRole("button", { name: "Collapse" }));

    const sidebar = screen.container.querySelector<HTMLElement>('[data-slot="sidebar"]')!;
    await vi.waitFor(() => expect(sidebar.inert).toBe(true));
    await expect.element(screen.getByRole("button", { name: "Show sidebar" })).toHaveFocus();
  });

  it("toggles from the trigger and reopens without inert", async () => {
    await page.viewport(1280, 800);
    await using screen = await render(<Harness />, { router: false /* no routes involved */ });
    const sidebar = screen.container.querySelector<HTMLElement>('[data-slot="sidebar"]')!;

    await userEvent.click(screen.getByRole("button", { name: "Hide sidebar" }));
    await vi.waitFor(() => expect(sidebar.inert).toBe(true));
    await expect.element(screen.getByRole("button", { name: "Show sidebar" })).toHaveFocus();
    await userEvent.click(screen.getByRole("button", { name: "Show sidebar" }));
    await vi.waitFor(() => expect(sidebar.inert).toBe(false));
    await expect.element(screen.getByRole("button", { name: "Hide sidebar" })).toHaveFocus();
  });
});
