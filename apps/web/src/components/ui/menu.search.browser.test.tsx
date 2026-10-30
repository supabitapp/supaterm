import { useState } from "react";
import { expect, it } from "vite-plus/test";
import { userEvent } from "vite-plus/test/browser";

import { render } from "../../../test/render";
import { Menu, MenuItem, MenuPopup, MenuSearchInput, MenuTrigger } from "./menu";

function FilterMenu() {
  const [query, setQuery] = useState("");
  return (
    <Menu>
      <MenuTrigger>Authors</MenuTrigger>
      <MenuPopup>
        <MenuSearchInput
          autoFocus
          aria-label="Search authors"
          value={query}
          onChange={(event) => setQuery(event.currentTarget.value)}
        />
        {["Alpha", "Bravo"].flatMap((name) =>
          name.toLowerCase().includes(query.toLowerCase())
            ? [<MenuItem key={name}>{name}</MenuItem>]
            : [],
        )}
      </MenuPopup>
    </Menu>
  );
}

it("keeps filter text in the input and lets arrows and Escape reach the menu", async () => {
  await using screen = await render(<FilterMenu />, { router: false });
  await userEvent.click(screen.getByRole("button", { name: "Authors" }));
  const input = screen.getByRole("textbox", { name: "Search authors" });
  await userEvent.fill(input, "bravo");
  await expect.element(input).toHaveValue("bravo");
  await expect.element(screen.getByRole("menuitem", { name: "Bravo" })).toBeInTheDocument();
  await expect.element(screen.getByRole("menuitem", { name: "Alpha" })).not.toBeInTheDocument();
  await userEvent.keyboard("{ArrowDown}");
  await expect.element(screen.getByRole("menuitem", { name: "Bravo" })).toHaveFocus();
  await userEvent.keyboard("{Escape}");
  await expect.element(input).not.toBeInTheDocument();
  await expect.element(screen.getByRole("button", { name: "Authors" })).toHaveFocus();
});
