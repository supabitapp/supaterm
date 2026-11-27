import { expect } from "e2e";

import { test, WEB } from "./supaterm.ts";

test(
  "Tab moves from the add-project Git URL field to its submit button",
  WEB,
  async ({ supaterm, app, screen, browser }) => {
    await supaterm.project("demo");
    await supaterm.open();

    await screen.getByRole("button", "Add project", { exact: true }).tap();
    await screen.getByText("Git URL").tap();
    await screen.getByRole("combobox").fill("https://github.com/supabitapp/supaterm.git");
    const submit = screen.getByRole("button", "Continue (Enter)");
    await expect(submit).toBeEnabled();

    await browser.keyboard.press("Tab");
    await app.screenshot("after-tab");
    await expect(submit).toBeFocused();
  },
);
