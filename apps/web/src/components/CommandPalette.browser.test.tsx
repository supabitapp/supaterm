import { describe, expect, it } from "vite-plus/test";
import { page, userEvent } from "vite-plus/test/browser";

import { render } from "../../test/render";
import { openCommandPalette } from "../commandPaletteBus";
import { useCommandPaletteStore } from "../commandPaletteStore";
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

  it("keeps the row Enter runs highlighted while typing", async () => {
    setup();
    await using _screen = await render(<CommandPalette>{null}</CommandPalette>);

    openCommandPalette();
    const input = page.getByRole("combobox");
    await userEvent.type(input, "open");

    const options = page.getByRole("option");
    await expect.element(options.first()).toHaveAttribute("data-active");
    await userEvent.keyboard("{ArrowDown}");
    await expect.element(options.nth(1)).toHaveAttribute("data-active");

    await userEvent.fill(input, "settings");
    await expect
      .element(page.getByRole("option", { name: "Open settings" }))
      .toHaveAttribute("data-active");
    await userEvent.keyboard("{Enter}");
    await expect.element(input).not.toBeInTheDocument();
  });
});
