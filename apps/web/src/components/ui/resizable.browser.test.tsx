import { expect, it, vi } from "vite-plus/test";
import { userEvent } from "vite-plus/test/browser";

import { act, render } from "../../../test/render";
import {
  ResizableHandle,
  ResizablePanel,
  ResizablePanelGroup,
  useCollapsiblePanel,
} from "./resizable";

function SidePanel({ storageKey, defaultWidth }: { storageKey: string; defaultWidth: number }) {
  const { panelProps, handleProps } = useCollapsiblePanel({
    storageKey,
    defaultWidth,
    minWidth: 100,
    open: true,
  });
  return (
    <>
      <ResizablePanel {...panelProps} id="side" data-testid="side">
        Side panel
      </ResizablePanel>
      <ResizableHandle {...handleProps} aria-label="Resize side panel" />
    </>
  );
}

function Layout(props: { storageKey: string; defaultWidth: number }) {
  return (
    <ResizablePanelGroup orientation="horizontal" style={{ width: 800, height: 100 }}>
      <SidePanel {...props} />
      <ResizablePanel id="main">Main panel</ResizablePanel>
    </ResizablePanelGroup>
  );
}

it("persists keyboard resizing to the current scope and resets to its current default", async () => {
  const first = "test:resizable:first";
  const second = "test:resizable:second";
  localStorage.setItem(first, "240");
  localStorage.setItem(second, "400");
  using _storage = {
    [Symbol.dispose]() {
      localStorage.removeItem(first);
      localStorage.removeItem(second);
    },
  };
  await using screen = await render(<Layout storageKey={first} defaultWidth={300} />, {
    router: false,
  });
  const width = () =>
    screen.container.querySelector("[data-testid=side]")!.getBoundingClientRect().width;
  await vi.waitFor(() => expect(width()).toBeCloseTo(240, 0));

  await userEvent.keyboard("{Tab}");
  await expect.element(screen.getByRole("separator")).toHaveFocus();
  await userEvent.keyboard("{ArrowRight}");
  const resizedFirst = localStorage.getItem(first);
  expect(Number(resizedFirst)).toBeGreaterThan(240);

  await screen.rerender(<Layout storageKey={second} defaultWidth={340} />);
  await vi.waitFor(() => expect(width()).toBeCloseTo(400, 0));
  await userEvent.keyboard("{ArrowRight}");
  expect(Number(localStorage.getItem(second))).toBeGreaterThan(400);
  expect(localStorage.getItem(first)).toBe(resizedFirst);

  await act(() =>
    screen.container
      .querySelector('[role="separator"]')!
      .dispatchEvent(new MouseEvent("dblclick", { bubbles: true })),
  );
  await vi.waitFor(() => expect(width()).toBeCloseTo(340, 0));
  expect(localStorage.getItem(second)).toBeNull();
});
