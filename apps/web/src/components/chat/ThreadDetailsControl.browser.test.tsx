import { act } from "react";
import { createRoot } from "react-dom/client";
import { expect, it, vi } from "vite-plus/test";

import { Menu, MenuItem, MenuPopup, MenuTrigger } from "../ui/menu";
import { ThreadDetailsControl } from "./ThreadDetailsControl";

it("opens the menu and preserves the row label when used as its trigger", async () => {
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
  const container = document.createElement("div");
  document.body.append(container);
  const root = createRoot(container);
  try {
    await act(async () => {
      root.render(
        <Menu>
          <MenuTrigger render={<ThreadDetailsControl part="select" />}>
            Run on this machine
          </MenuTrigger>
          <MenuPopup>
            <MenuItem>New worktree</MenuItem>
          </MenuPopup>
        </Menu>,
      );
    });
    const trigger = container.querySelector("button")!;
    expect(trigger.textContent).toBe("Run on this machine");
    await act(async () => trigger.click());
    expect(document.querySelector('[role="menuitem"]')?.textContent).toBe("New worktree");
  } finally {
    await act(async () => root.unmount());
    container.remove();
    vi.unstubAllGlobals();
  }
});
