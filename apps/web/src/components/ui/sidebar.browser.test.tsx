import { page, userEvent } from "vite-plus/test/browser";
import { describe, expect, it, vi } from "vite-plus/test";

import { render, stubGlobal } from "../../../test/render";
import { Sidebar, SidebarInsetPanel, SidebarProvider, SidebarTrigger, useSidebar } from "./sidebar";

function CollapseFromInside() {
  const { setOpen } = useSidebar();
  return (
    <button type="button" onClick={() => setOpen(false)}>
      Collapse
    </button>
  );
}

function Harness() {
  return (
    <SidebarProvider defaultOpen>
      <Sidebar>
        <CollapseFromInside />
      </Sidebar>
      <SidebarTrigger />
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
    const trigger = screen.container.querySelector('[data-slot="sidebar-trigger"]');
    await vi.waitFor(() => expect(document.activeElement).toBe(trigger));
  });

  it("toggles from the trigger and reopens without inert", async () => {
    await page.viewport(1280, 800);
    await using screen = await render(<Harness />, { router: false /* no routes involved */ });
    const sidebar = screen.container.querySelector<HTMLElement>('[data-slot="sidebar"]')!;
    const trigger = screen.container.querySelector<HTMLElement>('[data-slot="sidebar-trigger"]')!;

    await userEvent.click(trigger);
    await vi.waitFor(() => expect(sidebar.inert).toBe(true));
    await userEvent.click(trigger);
    await vi.waitFor(() => expect(sidebar.inert).toBe(false));
  });

  it("ticks the haptic when a drag snaps the sidebar closed or open, not when it toggles", async () => {
    await page.viewport(1280, 800);
    const performAlignmentHaptic = vi.fn();
    using _desktop = stubGlobal("desktopBridge", { performAlignmentHaptic });
    await using screen = await render(
      <SidebarProvider defaultOpen style={{ height: 600 }}>
        <Sidebar resizable={{}} />
        <SidebarInsetPanel>
          <SidebarTrigger />
        </SidebarInsetPanel>
      </SidebarProvider>,
      { router: false /* no routes involved */ },
    );
    const sidebar = screen.container.querySelector<HTMLElement>('[data-slot="sidebar"]')!;
    const trigger = screen.container.querySelector<HTMLElement>('[data-slot="sidebar-trigger"]')!;
    const handle = screen.container.querySelector<HTMLElement>('[data-slot="resizable-handle"]')!;
    const { x, y } = handle.getBoundingClientRect();
    const pointer = (type: string, clientX: number) =>
      (type === "pointerdown" ? handle : document).dispatchEvent(
        new PointerEvent(type, {
          bubbles: true,
          buttons: type === "pointerup" ? 0 : 1,
          clientX,
          clientY: y + 100,
          pointerId: 1,
          pointerType: "mouse",
        }),
      );

    pointer("pointerdown", x);
    await vi.waitFor(() => expect(handle.dataset.separator).toBe("active"));
    pointer("pointermove", 10);
    await vi.waitFor(() => expect(performAlignmentHaptic).toHaveBeenCalledTimes(1));
    pointer("pointermove", x);
    await vi.waitFor(() => expect(performAlignmentHaptic).toHaveBeenCalledTimes(2));
    pointer("pointerup", x);

    await userEvent.click(trigger);
    await vi.waitFor(() => expect(sidebar.inert).toBe(true));
    await userEvent.click(trigger);
    await vi.waitFor(() => expect(sidebar.inert).toBe(false));
    expect(performAlignmentHaptic).toHaveBeenCalledTimes(2);
  });
});

it("restores collapsed and expanded desktop state after remounting", async () => {
  await page.viewport(1280, 800);
  const storageKey = "sidebar_persistence_test";
  localStorage.removeItem(storageKey);
  const layout = () => (
    <SidebarProvider storageKey={storageKey}>
      <SidebarTrigger />
    </SidebarProvider>
  );
  {
    await using screen = await render(layout(), { router: false /* no routes involved */ });
    const trigger = screen.getByRole("button", { name: "Toggle Sidebar" });
    await expect.element(trigger).toHaveAttribute("aria-pressed", "true");
    await userEvent.click(trigger);
    await expect.element(trigger).toHaveAttribute("aria-pressed", "false");
  }
  {
    await using screen = await render(layout(), { router: false /* no routes involved */ });
    const trigger = screen.getByRole("button", { name: "Toggle Sidebar" });
    await expect.element(trigger).toHaveAttribute("aria-pressed", "false");
    await userEvent.click(trigger);
  }
  await using screen = await render(layout(), { router: false /* no routes involved */ });
  await expect
    .element(screen.getByRole("button", { name: "Toggle Sidebar" }))
    .toHaveAttribute("aria-pressed", "true");
  localStorage.removeItem(storageKey);
});

it("keeps the mobile sheet closed and leaves the saved desktop state alone", async () => {
  await page.viewport(390, 844);
  const storageKey = "sidebar_mobile_persistence_test";
  localStorage.setItem(storageKey, "false");
  {
    await using screen = await render(
      <SidebarProvider storageKey={storageKey}>
        <SidebarTrigger />
      </SidebarProvider>,
      { router: false /* no routes involved */ },
    );
    const trigger = screen.getByRole("button", { name: "Toggle Sidebar" });
    await expect.element(trigger).toHaveAttribute("aria-pressed", "false");
    await userEvent.click(trigger);
    await expect.element(trigger).toHaveAttribute("aria-pressed", "true");
    expect(localStorage.getItem(storageKey)).toBe("false");
  }
  await using screen = await render(
    <SidebarProvider storageKey={storageKey}>
      <SidebarTrigger />
    </SidebarProvider>,
    { router: false /* no routes involved */ },
  );
  await expect
    .element(screen.getByRole("button", { name: "Toggle Sidebar" }))
    .toHaveAttribute("aria-pressed", "false");
  localStorage.removeItem(storageKey);
});
