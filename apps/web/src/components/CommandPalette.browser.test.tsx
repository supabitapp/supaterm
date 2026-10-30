import { describe, expect, it } from "vite-plus/test";
import { page, userEvent } from "vite-plus/test/browser";

import { act, render } from "../../test/render";
import { openCommandPalette } from "../commandPaletteBus";
import { useCommandPaletteStore } from "../commandPaletteStore";
import { queueWorkspaceFocusFromPalette, startWorkspaceFocus } from "../lib/workspaceFocus";
import { CommandPalette } from "./CommandPalette";

function setup() {
  useCommandPaletteStore.setState(useCommandPaletteStore.getInitialState(), true);
}

describe("CommandPalette open intents", () => {
  it("opens New thread in... with focus in the search input, not the Back button", async () => {
    setup();
    await using _screen = await render(<CommandPalette>{null}</CommandPalette>);

    openCommandPalette({ open: "new-thread-in" });

    await expect.element(page.getByPlaceholder("Search...")).toHaveFocus();
  });

  it("opens a search intent with its query in the focused input", async () => {
    setup();
    await using _screen = await render(<CommandPalette>{null}</CommandPalette>);

    openCommandPalette({ query: "acme" });

    const input = page.getByPlaceholder("Search commands, projects, and threads...");
    await expect.element(input).toHaveFocus();
    await expect.element(input).toHaveValue("acme");
  });

  it("returns focus to the opener after the workspace was inert", async () => {
    setup();
    await using screen = await render(
      <CommandPalette>
        <button onClick={() => openCommandPalette()}>Open commands</button>
      </CommandPalette>,
    );
    const opener = screen.getByRole("button", { name: "Open commands" });
    await userEvent.click(opener);
    await expect.element(page.getByRole("dialog", { name: "Command palette" })).toBeVisible();

    await userEvent.keyboard("{Escape}");

    await expect.element(opener).toHaveFocus();
  });

  it("moves to the queued workspace area when the palette closes", async () => {
    setup();
    await using screen = await render(
      <CommandPalette>
        <section data-workspace-area="sidebar" data-workspace-order="0">
          <button onClick={() => openCommandPalette()}>Open commands</button>
        </section>
        <section data-workspace-area="composer" data-workspace-order="1">
          <button>Composer</button>
        </section>
      </CommandPalette>,
    );
    const stopFocus = startWorkspaceFocus(screen.router!);
    using _focus = { [Symbol.dispose]: stopFocus };
    const opener = screen.getByRole("button", { name: "Open commands" });
    await act(() => opener.element().focus());
    await expect.element(opener).toHaveFocus();
    await userEvent.click(opener);
    await expect.element(page.getByRole("dialog", { name: "Command palette" })).toBeVisible();
    await act(() => queueWorkspaceFocusFromPalette(1));

    await userEvent.keyboard("{Escape}");

    await expect.element(screen.getByRole("button", { name: "Composer" })).toHaveFocus();
  });
});
